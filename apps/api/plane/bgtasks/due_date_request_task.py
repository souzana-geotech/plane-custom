# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: in-app notifications for the fixed-due-date change request workflow.

Reuses the existing ``Notification`` infrastructure exactly as
``plane.bgtasks.issue_reminder_task`` does — same row shape, same
``entity_name="issue"``, rendered by the workspace notification inbox through
``BASE_NOTIFICATION_CONTENT_MAP``. No new notification framework is introduced.

Deliberately in-app only: due-date *changes* already go through the normal
``property_change`` email path when the approval is applied, so emailing the
request handshake as well would double up on the same event.
"""

# Python imports
import logging

# Third party imports
from celery import shared_task

# Django imports
from django.utils import timezone

# Module imports
from plane.db.models import (
    IssueDueDateChangeRequest,
    Notification,
    ProjectMember,
)
from plane.db.models.project import ROLE
from plane.utils.exception_logger import log_exception

logger = logging.getLogger("plane.worker")

# ``Notification.data.issue_activity.field`` values; the web inbox renders these
# through BASE_NOTIFICATION_CONTENT_MAP (see the frontend content map).
REQUESTED_FIELD = "due_date_change_requested"
APPROVED_FIELD = "due_date_change_approved"
REJECTED_FIELD = "due_date_change_rejected"

SENDER_PREFIX = "in_app:issue_activities:due_date_change:"
VERB = "requested"


def _issue_payload(issue):
    return {
        "id": str(issue.id),
        "name": str(issue.name),
        "identifier": str(issue.project.identifier),
        "sequence_id": issue.sequence_id,
        "state_name": issue.state.name if issue.state else "",
        "state_group": issue.state.group if issue.state else "",
    }


def _activity_payload(field, change_request, actor_id, now):
    """
    Shape mirrors the activity-derived notifications so the inbox renderer needs
    no special case beyond a content-map entry. ``new_value`` carries the
    requested date, ``old_value`` the date it would replace.
    """
    return {
        "id": str(change_request.id),
        "verb": VERB,
        "field": field,
        "actor": str(actor_id) if actor_id else None,
        "new_value": change_request.requested_target_date.isoformat(),
        "old_value": (
            change_request.current_target_date.isoformat() if change_request.current_target_date else ""
        ),
        "issue_comment": "",
        "old_identifier": None,
        "new_identifier": None,
        "activity_time": now.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
    }


def _create(issue, change_request, field, receiver_ids, actor_id, title, now):
    notifications = [
        Notification(
            workspace_id=issue.project.workspace_id,
            project_id=issue.project_id,
            sender=f"{SENDER_PREFIX}{field}",
            triggered_by_id=actor_id,
            receiver_id=receiver_id,
            entity_identifier=issue.id,
            entity_name="issue",
            title=title,
            message=title,
            data={
                "issue": _issue_payload(issue),
                "issue_activity": _activity_payload(field, change_request, actor_id, now),
            },
        )
        for receiver_id in receiver_ids
    ]
    if notifications:
        Notification.objects.bulk_create(notifications, batch_size=50)
    return len(notifications)


@shared_task
def notify_due_date_change_request(change_request_id, event, actor_id=None):
    """
    Celery entry point. ``event`` is one of ``requested`` / ``approved`` /
    ``rejected``. Never raises — a failed notification must not roll back the
    request transition that already committed.
    """
    try:
        change_request = (
            IssueDueDateChangeRequest.objects.filter(pk=change_request_id)
            .select_related("issue", "issue__project", "issue__project__workspace", "issue__state")
            .first()
        )
        if change_request is None:
            return

        issue = change_request.issue
        now = timezone.now()

        if event == "requested":
            # Every active project admin reviews; the requester is never notified
            # of their own submission.
            receiver_ids = list(
                ProjectMember.objects.filter(
                    project_id=issue.project_id,
                    role=ROLE.ADMIN.value,
                    is_active=True,
                )
                .exclude(member_id=change_request.requested_by_id)
                .values_list("member_id", flat=True)
            )
            field = REQUESTED_FIELD
            title = "Requested a change to a fixed due date"
        elif event == "approved":
            receiver_ids = [change_request.requested_by_id]
            field = APPROVED_FIELD
            title = "Your due date change request was approved"
        elif event == "rejected":
            receiver_ids = [change_request.requested_by_id]
            field = REJECTED_FIELD
            title = "Your due date change request was rejected"
        else:
            return

        created = _create(issue, change_request, field, receiver_ids, actor_id, title, now)
        logger.info(
            "Due date change request notifications created",
            extra={"data": {"change_request_id": str(change_request_id), "event": event, "created": created}},
        )
        return created
    except Exception as e:
        log_exception(e)
        return
