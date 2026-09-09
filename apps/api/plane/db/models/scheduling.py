# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models

# Module imports
from .project import ProjectBaseModel


class IssueDependencySchedule(ProjectBaseModel):
    """
    Derived scheduling projection for a task whose plan is pushed forward by a
    delayed ``blocked_by`` dependency.

    A row exists if and only if the issue is currently *dependency delayed*: at least
    one upstream blocker finishes (actually or projectedly) too late for the issue to
    start on its planned ``start_date``. The issue's own ``start_date`` /
    ``target_date`` are never modified — the adjusted dates here are a projection kept
    up to date by ``plane.bgtasks.dependency_schedule_task``. Rows are derived data and
    are always hard-deleted, never soft-deleted.
    """

    issue = models.OneToOneField("db.Issue", related_name="dependency_schedule", on_delete=models.CASCADE)
    # The upstream blocker with the latest projected finish date (the delay culprit).
    delayed_by = models.ForeignKey(
        "db.Issue",
        related_name="dependency_delayed_issues",
        on_delete=models.CASCADE,
    )
    # Latest projected finish across all upstream blockers; the dependent can start
    # on the next working day after this date.
    dependency_finish_date = models.DateField()
    adjusted_start_date = models.DateField(null=True, blank=True)
    adjusted_target_date = models.DateField(null=True, blank=True)

    class Meta:
        verbose_name = "Issue Dependency Schedule"
        verbose_name_plural = "Issue Dependency Schedules"
        db_table = "issue_dependency_schedules"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue_id} delayed by {self.delayed_by_id}"
