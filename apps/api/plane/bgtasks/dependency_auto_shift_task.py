# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Dependency auto-shift for work items.

When a work item is rescheduled (its ``target_date`` changes), the work items that
depend on it through ``blocked_by`` relations are shifted automatically — their
actual ``start_date`` / ``target_date`` are updated, unlike the read-only projection
in ``dependency_schedule_task``.

Semantics
---------
* A dependent's schedule is anchored to its *latest required date*: the latest
  ``target_date`` across all of its blockers. The dependent shifts by exactly the
  working-day change of that requirement — so moving a non-binding blocker (one
  that still finishes before another blocker) does not move the dependent at all,
  and any slack the user planned between a blocker and its dependent is preserved,
  in both directions (forward and backward moves).
* Shifts are measured and applied in working days (Monday-Saturday; Sunday is
  excluded), so a dependent's working-day duration is preserved and shifted dates
  never land on a Sunday.
* The shift propagates through the whole chain in one topologically-ordered pass:
  each affected work item is updated at most once, dependency cycles are detected
  and skipped, and completed/cancelled/archived/draft dependents (and anything
  behind them) stay untouched.
* Every applied shift is announced through the normal ``issue_activity`` pipeline
  with the ``dependency_auto_shift`` marker in the payload. The activity hook
  ignores marked payloads for auto-shifting (preventing recursive shift loops)
  while still refreshing the dependency-delay projections.
"""

# Python imports
import json
import logging
from datetime import date, datetime

# Third party imports
from celery import shared_task

# Django imports
from django.utils import timezone

# Module imports
from plane.db.models import Issue
from plane.utils.exception_logger import log_exception
from plane.utils.working_days import shift_by_working_days, working_days_delta

logger = logging.getLogger("plane.worker")

# Payload key marking a date update as produced by this task. Its presence tells
# the activity hook not to auto-shift again (the whole chain was already handled
# in one pass), which is what makes recursion through the pipeline impossible.
AUTO_SHIFT_MARKER = "dependency_auto_shift"


def _parse_date(value):
    if value is None or isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _is_shiftable(issue):
    """Only open, non-archived, non-draft issues with at least one date can move."""
    from plane.bgtasks.dependency_schedule_task import _is_closed

    if issue.archived_at is not None or issue.is_draft:
        return False
    if _is_closed(issue):
        return False
    return issue.start_date is not None or issue.target_date is not None


@shared_task
def auto_shift_dependents(issue_id, old_target_date, new_target_date, actor_id=None):
    """
    Celery entry point: the work item ``issue_id`` had its ``target_date`` changed
    from ``old_target_date`` to ``new_target_date`` (ISO strings). Shifts every
    transitive dependent whose latest required date changed. Returns a summary.
    """
    try:
        return _auto_shift_dependents(issue_id, old_target_date, new_target_date, actor_id)
    except Exception as e:
        log_exception(e)
        return


def _auto_shift_dependents(issue_id, old_target_date, new_target_date, actor_id=None):
    # imported lazily to avoid a circular import with the activity hook's module
    from plane.bgtasks.dependency_schedule_task import _downstream_closure, _topological_order
    from plane.bgtasks.issue_activities_task import issue_activity

    old_target = _parse_date(old_target_date)
    new_target = _parse_date(new_target_date)
    if old_target is None or new_target is None or old_target == new_target:
        return {"shifted": 0, "cyclic": 0}

    moved = Issue.objects.filter(pk=issue_id).first()
    # Stale event guard: only act when the payload still matches reality; a newer
    # move dispatches its own task, so acting on an outdated delta would double-shift.
    if moved is None or moved.target_date != new_target:
        return {"shifted": 0, "cyclic": 0}

    moved_id = str(moved.id)
    affected = _downstream_closure({moved_id})

    # Direct upstream edges for every affected issue (mirrors the projection pass).
    from plane.db.models import IssueRelation

    upstream_map = {}
    for dependent_id, upstream_id in IssueRelation.objects.filter(
        relation_type="blocked_by", issue_id__in=affected
    ).values_list("issue_id", "related_issue_id"):
        upstream_map.setdefault(str(dependent_id), []).append(str(upstream_id))

    upstream_ids = {u for ups in upstream_map.values() for u in ups}
    issues_by_id = {
        str(issue.id): issue
        for issue in Issue.objects.filter(id__in=affected | upstream_ids).select_related("state")
    }

    ordered, cyclic = _topological_order(affected, upstream_map)
    if cyclic:
        logger.warning(
            "Circular blocked_by dependency detected during auto-shift; cycle members are not moved",
            extra={"data": {"issue_ids": sorted(cyclic)}},
        )

    # target_date before/after this pass, per issue. The moved issue seeds the walk;
    # untouched blockers contribute their current value on both sides.
    old_targets = {moved_id: old_target}
    new_targets = {moved_id: new_target}

    def requirement(dependent_id, values):
        """Latest required date: max target across all blockers, or None."""
        dates = []
        for blocker_id in upstream_map.get(dependent_id, ()):
            if blocker_id in values:
                dates.append(values[blocker_id])
            else:
                blocker = issues_by_id.get(blocker_id)
                if blocker is not None and blocker.target_date is not None:
                    dates.append(blocker.target_date)
        return max(dates) if dates else None

    to_update = []
    activities = []
    for dependent_id in ordered:
        if dependent_id == moved_id:
            continue
        issue = issues_by_id.get(dependent_id)
        if issue is None or not _is_shiftable(issue):
            continue

        old_requirement = requirement(dependent_id, old_targets)
        new_requirement = requirement(dependent_id, new_targets)
        if old_requirement is None or new_requirement is None:
            continue
        delta = working_days_delta(old_requirement, new_requirement)
        if delta == 0:
            continue

        old_dates = {"start_date": issue.start_date, "target_date": issue.target_date}
        if issue.start_date is not None:
            issue.start_date = shift_by_working_days(issue.start_date, delta)
        if issue.target_date is not None:
            old_targets[dependent_id] = issue.target_date
            issue.target_date = shift_by_working_days(issue.target_date, delta)
            new_targets[dependent_id] = issue.target_date

        to_update.append(issue)
        activities.append((dependent_id, old_dates, issue.start_date, issue.target_date))

    if to_update:
        # same persistence pattern as the gantt bulk date endpoint
        Issue.objects.bulk_update(to_update, ["start_date", "target_date"])

        epoch = int(timezone.now().timestamp())
        for dependent_id, old_dates, new_start, new_target_value in activities:
            issue_activity.delay(
                type="issue.activity.updated",
                requested_data=json.dumps(
                    {
                        "start_date": new_start.isoformat() if new_start else None,
                        "target_date": new_target_value.isoformat() if new_target_value else None,
                        AUTO_SHIFT_MARKER: True,
                    }
                ),
                current_instance=json.dumps(
                    {
                        "start_date": old_dates["start_date"].isoformat() if old_dates["start_date"] else None,
                        "target_date": old_dates["target_date"].isoformat() if old_dates["target_date"] else None,
                    }
                ),
                issue_id=dependent_id,
                actor_id=str(actor_id) if actor_id else None,
                project_id=str(issues_by_id[dependent_id].project_id),
                epoch=epoch,
                notification=True,
            )

    summary = {"shifted": len(to_update), "cyclic": len(cyclic)}
    logger.info("Dependency auto-shift applied", extra={"data": {"issue_id": moved_id, **summary}})
    return summary
