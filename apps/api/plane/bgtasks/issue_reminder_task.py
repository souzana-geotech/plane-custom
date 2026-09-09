# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Scheduled due-date reminders and overdue notifications for tasks.

Runs from Celery Beat (see ``plane/celery.py``). For every non-archived project the
task computes "today" in the project's timezone and notifies the *current* active
assignees of open tasks that are

* due today or tomorrow  -> ``due_reminder`` (sent once per target date, normally the
  day before the due date), and
* past their target date -> ``overdue`` (sent once per target date, on the first run
  after the due date has passed).

Delivery reuses the existing infrastructure: an in-app ``Notification`` row (same
shape as activity notifications, ``entity_name="issue"``) and, when the receiver's
``property_change`` email preference is on, an ``EmailNotificationLog`` row that the
5-minute ``stack_email_notification`` job turns into an email.

Idempotency: an ``IssueReminderLog`` row keyed on (issue, receiver, kind, target_date)
is written in the same transaction as the notification, under a unique constraint.
Repeated or concurrent runs therefore never create duplicates, a changed target date
re-arms the reminder, and assignees added later are picked up on the next run.
"""

# Python imports
import logging
from datetime import datetime, timedelta

import pytz

# Third party imports
from celery import shared_task

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

# Module imports
from plane.db.models import (
    EmailNotificationLog,
    Issue,
    IssueAssignee,
    IssueReminderLog,
    Notification,
    Project,
    ProjectMember,
    UserNotificationPreference,
)
from plane.db.models.state import StateGroup
from plane.utils.exception_logger import log_exception

logger = logging.getLogger("plane.worker")

# Values stored in ``Notification.data.issue_activity.field`` and rendered by the
# web inbox (``BASE_NOTIFICATION_CONTENT_MAP``) and the email template.
DUE_REMINDER_FIELD = IssueReminderLog.Kind.DUE_REMINDER.value
OVERDUE_FIELD = IssueReminderLog.Kind.OVERDUE.value
REMINDER_FIELDS = (DUE_REMINDER_FIELD, OVERDUE_FIELD)

REMINDER_SENDER_PREFIX = "in_app:issue_reminders:"
REMINDER_VERB = "reminded"

# Reminder window: notify when the target date is within this many days (inclusive).
DUE_REMINDER_DAYS_BEFORE = 1

CLOSED_STATE_GROUPS = [StateGroup.COMPLETED.value, StateGroup.CANCELLED.value]


def _project_today(project, now):
    """Return the calendar date of ``now`` in the project's timezone (UTC fallback)."""
    try:
        tz = pytz.timezone(project.timezone or "UTC")
    except pytz.UnknownTimeZoneError:
        tz = pytz.utc
    return now.astimezone(tz).date()


def reminder_message(kind, days):
    """Human readable sentence for a reminder; ``days`` is the distance to the due date."""
    if kind == OVERDUE_FIELD:
        return f"This task is overdue by {days} {'day' if days == 1 else 'days'}."
    if days <= 0:
        return "This task is due today."
    if days == 1:
        return "This task is due tomorrow."
    return f"This task is due in {days} days."


def _issue_payload(issue, include_urls=False):
    payload = {
        "id": str(issue.id),
        "name": str(issue.name),
        "identifier": str(issue.project.identifier),
        "sequence_id": issue.sequence_id,
        "state_name": issue.state.name if issue.state else "",
        "state_group": issue.state.group if issue.state else "",
    }
    if include_urls:
        payload["project_id"] = str(issue.project_id)
        payload["workspace_slug"] = str(issue.project.workspace.slug)
    return payload


def _activity_payload(kind, target_date, days, receiver_id, log_id, now):
    return {
        "id": str(log_id),
        "verb": REMINDER_VERB,
        "field": kind,
        "actor": str(receiver_id),
        "new_value": target_date.isoformat(),
        "old_value": str(days),
        "issue_comment": "",
        "old_identifier": None,
        "new_identifier": None,
        "activity_time": now.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
    }


def _email_enabled(receiver_id):
    # Reminders piggy-back on the existing "property changes" email preference.
    # Users without a preference row (never the case for regular users) default to on.
    preference = UserNotificationPreference.objects.filter(user_id=receiver_id).values_list(
        "property_change", flat=True
    )
    value = preference.first()
    return True if value is None else bool(value)


def _create_reminder(issue, receiver_id, kind, target_date, days, now):
    """
    Create the reminder log, the in-app notification and (optionally) the email log
    atomically. Returns True when a new reminder was created, False when the unique
    constraint reports that it already exists.
    """
    project = issue.project
    title = reminder_message(kind, days)
    try:
        with transaction.atomic():
            log = IssueReminderLog.objects.create(
                workspace_id=project.workspace_id,
                project_id=project.id,
                issue_id=issue.id,
                receiver_id=receiver_id,
                kind=kind,
                target_date=target_date,
            )
            notification = Notification.objects.create(
                workspace_id=project.workspace_id,
                project_id=project.id,
                sender=f"{REMINDER_SENDER_PREFIX}{kind}",
                triggered_by=None,
                receiver_id=receiver_id,
                entity_identifier=issue.id,
                entity_name="issue",
                title=title,
                message=title,
                data={
                    "issue": _issue_payload(issue),
                    "issue_activity": _activity_payload(kind, target_date, days, receiver_id, log.id, now),
                },
            )
            log.notification = notification
            log.save(update_fields=["notification"])

            if _email_enabled(receiver_id):
                # ``triggered_by`` is required by the email log and is used by the
                # email batcher to group changes per actor; using the receiver keeps
                # reminders in their own bucket, separate from real activity actors.
                EmailNotificationLog.objects.create(
                    triggered_by_id=receiver_id,
                    receiver_id=receiver_id,
                    entity_identifier=issue.id,
                    entity_name="issue",
                    data={
                        "issue": _issue_payload(issue, include_urls=True),
                        "issue_activity": _activity_payload(kind, target_date, days, receiver_id, log.id, now),
                    },
                )
        return True
    except IntegrityError:
        # Another run (or worker) created this reminder concurrently.
        return False


def process_project_reminders(project, now):
    """Create reminders for one project. Returns a dict with per-kind counts."""
    created = {DUE_REMINDER_FIELD: 0, OVERDUE_FIELD: 0}

    today = _project_today(project, now)
    due_window_end = today + timedelta(days=DUE_REMINDER_DAYS_BEFORE)

    # ``issue_objects`` already excludes archived, draft, triage and archived-project issues.
    issues = list(
        Issue.issue_objects.filter(project_id=project.id, target_date__isnull=False)
        .filter(Q(target_date__lt=today) | Q(target_date__gte=today, target_date__lte=due_window_end))
        .exclude(state__group__in=CLOSED_STATE_GROUPS)
        .select_related("state", "project", "project__workspace")
    )
    if not issues:
        return created

    issue_ids = [issue.id for issue in issues]

    # Only current, active assignees who are still active project members are notified.
    active_members = set(
        ProjectMember.objects.filter(project_id=project.id, is_active=True).values_list("member_id", flat=True)
    )
    assignees_by_issue = {}
    for issue_id, assignee_id in IssueAssignee.objects.filter(
        issue_id__in=issue_ids, assignee__is_active=True
    ).values_list("issue_id", "assignee_id"):
        if assignee_id in active_members:
            assignees_by_issue.setdefault(issue_id, set()).add(assignee_id)

    # Pre-load already sent reminders to avoid relying on IntegrityError for the common case.
    already_sent = set(
        IssueReminderLog.objects.filter(issue_id__in=issue_ids).values_list(
            "issue_id", "receiver_id", "kind", "target_date"
        )
    )

    for issue in issues:
        target_date = issue.target_date
        if target_date < today:
            kind = OVERDUE_FIELD
            days = (today - target_date).days
        else:
            kind = DUE_REMINDER_FIELD
            days = (target_date - today).days

        for receiver_id in assignees_by_issue.get(issue.id, ()):
            if (issue.id, receiver_id, kind, target_date) in already_sent:
                continue
            if _create_reminder(issue, receiver_id, kind, target_date, days, now):
                created[kind] += 1

    return created


@shared_task
def issue_due_date_reminders(now=None):
    """
    Celery Beat entry point. ``now`` is optional (ISO string or datetime) and exists
    for deterministic tests; production runs use the current time.
    """
    if now is None:
        now = timezone.now()
    elif isinstance(now, str):
        now = datetime.fromisoformat(now)
    if timezone.is_naive(now):
        now = timezone.make_aware(now, timezone=pytz.utc)

    summary = {DUE_REMINDER_FIELD: 0, OVERDUE_FIELD: 0, "projects": 0}

    for project in Project.objects.filter(archived_at__isnull=True).select_related("workspace").iterator():
        try:
            created = process_project_reminders(project, now)
        except Exception as e:  # keep one broken project from blocking the others
            log_exception(e)
            continue
        summary["projects"] += 1
        summary[DUE_REMINDER_FIELD] += created[DUE_REMINDER_FIELD]
        summary[OVERDUE_FIELD] += created[OVERDUE_FIELD]

    logger.info("Issue due-date reminders processed", extra={"data": summary})
    return summary
