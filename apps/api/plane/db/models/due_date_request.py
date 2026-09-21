# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.db import models

# Module imports
from .project import ProjectBaseModel


class IssueDueDateChangeRequest(ProjectBaseModel):
    """
    Approval workflow around a *fixed* (locked) ``Issue.target_date``.

    When a task's due date is locked (``Issue.is_due_date_locked``) a member
    cannot change it directly. They submit a request here instead; only a
    project admin approving it results in an actual ``target_date`` change, and
    that change is applied through the normal issue update pipeline so every
    existing side effect (activity, notifications, webhooks, dependency
    auto-shift) is preserved.

    This is *not* a second due-date field: ``requested_target_date`` is a
    proposal and is never read by anything that schedules or reports on the
    task. ``current_target_date`` snapshots the due date at request time so a
    reviewer sees what was actually being asked for, even if the locked date was
    changed by an admin in the meantime.

    At most one ``PENDING`` request may exist per task, enforced by a partial
    unique constraint.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    issue = models.ForeignKey("db.Issue", related_name="due_date_change_requests", on_delete=models.CASCADE)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="due_date_change_requests",
        on_delete=models.CASCADE,
    )
    # The date the requester is asking for.
    requested_target_date = models.DateField()
    # The task's due date when the request was raised (null when it had none).
    current_target_date = models.DateField(null=True, blank=True)
    reason = models.TextField(blank=True, default="")
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.PENDING)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="reviewed_due_date_change_requests",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # Reviewer's note; carries the rejection reason when the request is rejected.
    review_comment = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "Issue Due Date Change Request"
        verbose_name_plural = "Issue Due Date Change Requests"
        db_table = "issue_due_date_change_requests"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["issue"],
                condition=models.Q(status="pending", deleted_at__isnull=True),
                name="issue_due_date_change_request_one_pending_per_issue",
            )
        ]

    def __str__(self):
        return f"{self.issue_id} -> {self.requested_target_date} ({self.status})"
