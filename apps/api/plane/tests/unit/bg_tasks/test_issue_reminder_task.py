# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Unit tests for the scheduled due-date reminder / overdue task.

Covers: due reminders, overdue notifications, multiple assignees, completed /
cancelled / archived exclusion, missing target dates, target-date changes,
assignee changes, project-timezone day boundaries, email preference gating and
duplicate prevention across repeated runs.
"""

from datetime import date, datetime, timedelta, timezone as dt_timezone
from uuid import uuid4

import pytest
from django.template.loader import render_to_string
from django.utils import timezone

from plane.bgtasks.email_notification_task import build_reminder_context
from plane.bgtasks.issue_reminder_task import (
    DUE_REMINDER_FIELD,
    OVERDUE_FIELD,
    REMINDER_SENDER_PREFIX,
    issue_due_date_reminders,
    reminder_message,
)
from plane.db.models import (
    EmailNotificationLog,
    Issue,
    IssueAssignee,
    IssueReminderLog,
    Notification,
    State,
    UserNotificationPreference,
)
from plane.tests.factories import ProjectFactory, ProjectMemberFactory, UserFactory, WorkspaceFactory

NOW = datetime(2026, 9, 10, 9, 0, tzinfo=dt_timezone.utc)
TODAY = date(2026, 9, 10)
TOMORROW = TODAY + timedelta(days=1)
YESTERDAY = TODAY - timedelta(days=1)


class Env:
    """Small container for the fixtures a test needs."""

    def __init__(self, project, states, users):
        self.project = project
        self.states = states
        self.users = users

    def issue(self, target_date=None, state="open", assignees=(), **kwargs):
        issue = Issue.objects.create(
            project=self.project,
            name=kwargs.pop("name", "Site Access & Flight Preparation"),
            state=self.states[state],
            target_date=target_date,
            **kwargs,
        )
        for user in assignees:
            IssueAssignee.objects.create(issue=issue, assignee=user, project=self.project)
        return issue


def _user():
    # ``User.username`` is unique and the factory does not populate it.
    return UserFactory(username=f"reminder_user_{uuid4().hex[:8]}")


def _make_env(timezone_name="UTC", members=2):
    workspace = WorkspaceFactory(owner=_user())
    project = ProjectFactory(workspace=workspace, timezone=timezone_name)
    states = {
        "open": State.objects.create(project=project, name="In Progress", group="started", color="#000"),
        "completed": State.objects.create(project=project, name="Done", group="completed", color="#000"),
        "cancelled": State.objects.create(project=project, name="Cancelled", group="cancelled", color="#000"),
    }
    users = []
    for _ in range(members):
        user = _user()
        ProjectMemberFactory(project=project, member=user)
        users.append(user)
    return Env(project, states, users)


@pytest.fixture
def env(db):
    return _make_env()


def _notifications(user, kind=None):
    qs = Notification.objects.filter(receiver=user, sender__startswith=REMINDER_SENDER_PREFIX)
    if kind:
        qs = qs.filter(sender=f"{REMINDER_SENDER_PREFIX}{kind}")
    return qs


@pytest.mark.unit
class TestIssueDueDateReminders:
    def test_due_reminder_is_created_the_day_before(self, env):
        user = env.users[0]
        issue = env.issue(target_date=TOMORROW, assignees=[user])

        summary = issue_due_date_reminders(now=NOW)

        assert summary[DUE_REMINDER_FIELD] == 1
        assert summary[OVERDUE_FIELD] == 0
        notification = _notifications(user, DUE_REMINDER_FIELD).get()
        assert notification.entity_name == "issue"
        assert notification.entity_identifier == issue.id
        assert notification.triggered_by is None
        assert notification.project_id == env.project.id
        assert notification.data["issue"]["id"] == str(issue.id)
        assert notification.data["issue_activity"]["field"] == DUE_REMINDER_FIELD
        assert notification.data["issue_activity"]["new_value"] == TOMORROW.isoformat()
        assert notification.data["issue_activity"]["old_value"] == "1"
        assert notification.title == "This work item is due tomorrow."

        log = IssueReminderLog.objects.get(issue=issue, receiver=user)
        assert log.kind == DUE_REMINDER_FIELD
        assert log.target_date == TOMORROW
        assert log.notification_id == notification.id

        email = EmailNotificationLog.objects.get(receiver=user, entity_identifier=issue.id)
        assert email.triggered_by_id == user.id
        assert email.data["issue_activity"]["field"] == DUE_REMINDER_FIELD
        assert email.data["issue"]["workspace_slug"] == env.project.workspace.slug
        assert email.processed_at is None

    def test_overdue_notification_is_created_after_the_due_date(self, env):
        user = env.users[0]
        issue = env.issue(target_date=YESTERDAY, assignees=[user])

        summary = issue_due_date_reminders(now=NOW)

        assert summary == {DUE_REMINDER_FIELD: 0, OVERDUE_FIELD: 1, "projects": 1}
        notification = _notifications(user, OVERDUE_FIELD).get()
        assert notification.data["issue_activity"]["field"] == OVERDUE_FIELD
        assert notification.data["issue_activity"]["old_value"] == "1"
        assert notification.title == "This work item is overdue by 1 day."
        assert IssueReminderLog.objects.filter(issue=issue, kind=OVERDUE_FIELD).count() == 1
        assert not _notifications(user, DUE_REMINDER_FIELD).exists()

    def test_multiple_assignees_are_each_notified_once(self, env):
        first, second = env.users
        issue = env.issue(target_date=TOMORROW, assignees=[first, second])

        summary = issue_due_date_reminders(now=NOW)

        assert summary[DUE_REMINDER_FIELD] == 2
        assert _notifications(first).count() == 1
        assert _notifications(second).count() == 1
        assert IssueReminderLog.objects.filter(issue=issue).count() == 2
        assert EmailNotificationLog.objects.filter(entity_identifier=issue.id).count() == 2

    def test_completed_cancelled_and_archived_issues_are_skipped(self, env):
        user = env.users[0]
        env.issue(target_date=YESTERDAY, state="completed", assignees=[user], name="done")
        env.issue(target_date=YESTERDAY, state="cancelled", assignees=[user], name="cancelled")
        archived = env.issue(target_date=YESTERDAY, assignees=[user], name="archived")
        Issue.objects.filter(pk=archived.pk).update(archived_at=YESTERDAY)
        env.issue(target_date=TOMORROW, state="completed", assignees=[user], name="done-soon")

        summary = issue_due_date_reminders(now=NOW)

        assert summary == {DUE_REMINDER_FIELD: 0, OVERDUE_FIELD: 0, "projects": 1}
        assert not _notifications(user).exists()
        assert not IssueReminderLog.objects.exists()

    def test_issues_without_target_date_or_outside_the_window_are_skipped(self, env):
        user = env.users[0]
        env.issue(target_date=None, assignees=[user], name="no-date")
        env.issue(target_date=TODAY + timedelta(days=2), assignees=[user], name="later")

        summary = issue_due_date_reminders(now=NOW)

        assert summary[DUE_REMINDER_FIELD] == 0 and summary[OVERDUE_FIELD] == 0
        assert not _notifications(user).exists()

    def test_unassigned_issue_creates_nothing(self, env):
        env.issue(target_date=YESTERDAY)

        summary = issue_due_date_reminders(now=NOW)

        assert summary[OVERDUE_FIELD] == 0
        assert not Notification.objects.exists()

    def test_repeated_runs_never_duplicate(self, env):
        user = env.users[0]
        env.issue(target_date=TOMORROW, assignees=[user], name="due")
        env.issue(target_date=YESTERDAY, assignees=[user], name="late")

        first = issue_due_date_reminders(now=NOW)
        second = issue_due_date_reminders(now=NOW + timedelta(hours=1))
        # The overdue item stays overdue on later days and the due item becomes "due today":
        # both already have a log row for this target date, so nothing new is created.
        third = issue_due_date_reminders(now=NOW + timedelta(days=1))

        assert first == {DUE_REMINDER_FIELD: 1, OVERDUE_FIELD: 1, "projects": 1}
        assert second[DUE_REMINDER_FIELD] == 0 and second[OVERDUE_FIELD] == 0
        assert third[DUE_REMINDER_FIELD] == 0
        assert _notifications(user).count() == 2
        assert IssueReminderLog.objects.count() == 2
        assert EmailNotificationLog.objects.count() == 2

    def test_run_two_days_later_turns_the_due_item_into_a_single_overdue(self, env):
        user = env.users[0]
        env.issue(target_date=TOMORROW, assignees=[user])

        issue_due_date_reminders(now=NOW)
        issue_due_date_reminders(now=NOW + timedelta(days=2))
        issue_due_date_reminders(now=NOW + timedelta(days=3))

        assert _notifications(user, DUE_REMINDER_FIELD).count() == 1
        overdue = _notifications(user, OVERDUE_FIELD).get()
        assert overdue.data["issue_activity"]["old_value"] == "1"

    def test_changed_target_date_re_arms_the_reminder(self, env):
        user = env.users[0]
        issue = env.issue(target_date=TOMORROW, assignees=[user])

        issue_due_date_reminders(now=NOW)
        assert _notifications(user).count() == 1

        # Moved out by a week: nothing until the new date approaches...
        new_date = TODAY + timedelta(days=8)
        Issue.objects.filter(pk=issue.pk).update(target_date=new_date)
        issue_due_date_reminders(now=NOW + timedelta(days=1))
        assert _notifications(user).count() == 1

        # ...then a fresh reminder for the new date, and nothing for the old key.
        issue_due_date_reminders(now=NOW + timedelta(days=7))
        reminders = _notifications(user, DUE_REMINDER_FIELD).order_by("created_at")
        assert reminders.count() == 2
        assert reminders.last().data["issue_activity"]["new_value"] == new_date.isoformat()
        assert set(IssueReminderLog.objects.values_list("target_date", flat=True)) == {TOMORROW, new_date}

        # Removing the date stops everything.
        Issue.objects.filter(pk=issue.pk).update(target_date=None)
        issue_due_date_reminders(now=NOW + timedelta(days=30))
        assert _notifications(user).count() == 2

    def test_completion_after_a_reminder_stops_the_overdue_notification(self, env):
        user = env.users[0]
        issue = env.issue(target_date=TOMORROW, assignees=[user])

        issue_due_date_reminders(now=NOW)
        issue.state = env.states["completed"]
        issue.save()
        issue_due_date_reminders(now=NOW + timedelta(days=3))

        assert _notifications(user).count() == 1
        assert not _notifications(user, OVERDUE_FIELD).exists()

    def test_assignee_changes_use_current_assignees(self, env):
        first, second = env.users
        issue = env.issue(target_date=YESTERDAY, assignees=[first])

        issue_due_date_reminders(now=NOW)
        assert _notifications(first).count() == 1
        assert not _notifications(second).exists()

        # Reassign: the removed assignee is not notified again, the new one is picked up.
        IssueAssignee.objects.get(issue=issue, assignee=first).delete()
        IssueAssignee.objects.create(issue=issue, assignee=second, project=env.project)
        Issue.objects.filter(pk=issue.pk).update(target_date=YESTERDAY - timedelta(days=1))

        issue_due_date_reminders(now=NOW + timedelta(hours=2))
        assert _notifications(first).count() == 1
        assert _notifications(second, OVERDUE_FIELD).count() == 1

    def test_assignee_who_left_the_project_is_not_notified(self, env):
        user = env.users[0]
        env.issue(target_date=YESTERDAY, assignees=[user])
        env.project.project_projectmember.filter(member=user).update(is_active=False)

        issue_due_date_reminders(now=NOW)

        assert not _notifications(user).exists()

    def test_email_log_respects_property_change_preference(self, env):
        user = env.users[0]
        UserNotificationPreference.objects.filter(user=user).update(property_change=False)
        issue = env.issue(target_date=TOMORROW, assignees=[user])

        issue_due_date_reminders(now=NOW)

        assert _notifications(user).count() == 1
        assert not EmailNotificationLog.objects.filter(entity_identifier=issue.id).exists()

    def test_today_is_computed_in_the_project_timezone(self, db):
        # 13:00 UTC on Sep 10 is already Sep 11 in Auckland, so an item due Sep 12 is "due tomorrow" there.
        auckland = _make_env(timezone_name="Pacific/Auckland", members=1)
        utc = _make_env(timezone_name="UTC", members=1)
        auckland.issue(target_date=date(2026, 9, 12), assignees=[auckland.users[0]])
        utc.issue(target_date=date(2026, 9, 12), assignees=[utc.users[0]])

        issue_due_date_reminders(now=datetime(2026, 9, 10, 13, 0, tzinfo=dt_timezone.utc))

        assert _notifications(auckland.users[0], DUE_REMINDER_FIELD).count() == 1
        assert not _notifications(utc.users[0]).exists()

    def test_accepts_iso_string_for_now_and_defaults_to_current_time(self, env):
        user = env.users[0]
        env.issue(target_date=timezone.now().date() - timedelta(days=1), assignees=[user])

        assert issue_due_date_reminders()[OVERDUE_FIELD] == 1
        assert issue_due_date_reminders(now=timezone.now().isoformat())[OVERDUE_FIELD] == 0


@pytest.mark.unit
class TestReminderEmailRendering:
    def test_reminder_message_wording(self):
        assert reminder_message(DUE_REMINDER_FIELD, 0) == "This work item is due today."
        assert reminder_message(DUE_REMINDER_FIELD, 1) == "This work item is due tomorrow."
        assert reminder_message(DUE_REMINDER_FIELD, 3) == "This work item is due in 3 days."
        assert reminder_message(OVERDUE_FIELD, 1) == "This work item is overdue by 1 day."
        assert reminder_message(OVERDUE_FIELD, 4) == "This work item is overdue by 4 days."

    def test_build_reminder_context_from_batched_change(self):
        context = build_reminder_context(OVERDUE_FIELD, {"new_value": ["2026-09-09"], "old_value": ["2"]})
        assert context == {
            "kind": OVERDUE_FIELD,
            "target_date": "2026-09-09",
            "days": 2,
            "message": "This work item is overdue by 2 days.",
        }
        assert build_reminder_context(DUE_REMINDER_FIELD, {"new_value": ["2026-09-11"]})["days"] == 0

    def test_email_template_renders_reminder_block_without_actor_summary(self):
        context = {
            "data": [],
            "comments": [],
            "reminders": [build_reminder_context(OVERDUE_FIELD, {"new_value": ["2026-09-09"], "old_value": ["2"]})],
            "summary": "Updates were made to the issue by",
            "actors_involved": 1,
            "issue": {"issue_identifier": "GEO-1", "name": "Survey", "issue_url": "http://x/issue"},
            "receiver": {"email": "a@b.c"},
            "issue_url": "http://x/issue",
            "project_url": "http://x/project",
            "workspace": "geo",
            "project": "Ops",
            "user_preference": "http://x/prefs",
            "entity_type": "issue",
        }

        html = render_to_string("emails/notifications/issue-updates.html", context)

        assert "This work item is overdue by 2 days." in html
        assert "Due date: 2026-09-09" in html
        assert "Updates were made to the issue by" not in html
