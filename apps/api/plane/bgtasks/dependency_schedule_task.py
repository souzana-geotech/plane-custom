# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Dependency-aware scheduling for work items.

When an upstream work item is delayed, the work items that depend on it through
``blocked_by`` relations are marked *dependency delayed* and get projected
(adjusted) dates. The projection is stored in ``IssueDependencySchedule`` — a row
exists if and only if the issue is currently dependency delayed. The issue's own
``start_date`` / ``target_date`` are never modified, so manual date edits are always
preserved and no recalculation loop through the activity pipeline can occur (this
task writes only schedule rows and never dispatches issue activities).

Semantics
---------
* An upstream blocker U "finishes late" when it is completed after its
  ``target_date``, or it is still open past its ``target_date`` (its earliest
  possible finish is then "today" in its project's timezone), or it is itself
  dependency delayed (its adjusted target date is used — this propagates delays
  through chains A -> B -> C).
* A dependent X is delayed when the first working day after the latest upstream
  finish date (multiple dependencies: the latest one wins) is after X's planned
  start date. Working days run Monday-Saturday; Sunday is excluded, matching
  ``packages/utils/src/working-days.ts`` on the frontend.
* The adjusted window preserves X's planned duration counted in working days.
* Completed/cancelled dependents are never marked delayed; cancelled upstreams
  never push their dependents.

Recalculation is triggered from the ``issue_activity`` pipeline (date, state,
relation and deletion changes) via ``handle_issue_activity_for_dependencies`` and
by an hourly sweep (``dependency_schedule_sweep``) that keeps "today"-based
projections fresh. Circular dependencies are detected with a topological sort;
issues stuck in a cycle get their projections cleared instead of looping forever.
"""

# Python imports
import json
import logging
from datetime import datetime, timedelta

import pytz

# Third party imports
from celery import shared_task

# Django imports
from django.utils import timezone

# Module imports
from plane.db.models import Issue, IssueDependencySchedule, IssueRelation
from plane.db.models.state import StateGroup
from plane.utils.exception_logger import log_exception
from plane.utils.working_days import add_working_days, next_working_day, working_days_between

logger = logging.getLogger("plane.worker")

CLOSED_STATE_GROUPS = (StateGroup.COMPLETED.value, StateGroup.CANCELLED.value)

# Issue payload keys whose change can affect dependency schedules.
RELEVANT_ISSUE_KEYS = {"start_date", "target_date", "state", "state_id"}

# Safety cap for one recalculation pass; prevents runaway traversals on
# pathological relation graphs. Exceeding it is logged and the pass is truncated.
MAX_AFFECTED_ISSUES = 1000


def _project_today(project, now):
    """Calendar date of ``now`` in the project's timezone (UTC fallback)."""
    try:
        tz = pytz.timezone(project.timezone or "UTC")
    except pytz.UnknownTimeZoneError:
        tz = pytz.utc
    return now.astimezone(tz).date()


def _state_group(issue):
    return issue.state.group if issue.state_id and issue.state else None


def _is_closed(issue):
    return _state_group(issue) in CLOSED_STATE_GROUPS or issue.completed_at is not None


def _completion_date(issue, now):
    """Local calendar date on which the issue was completed, or None."""
    if issue.completed_at is None:
        return None
    return _project_today(issue.project, issue.completed_at)


def _projected_finish(upstream, schedule_lookup, now):
    """
    The date on which the upstream blocker is (actually or projectedly) finished
    *too late*, or None when it does not push its dependents.
    """
    group = _state_group(upstream)
    if group == StateGroup.CANCELLED.value:
        return None

    if _is_closed(upstream):
        completed_on = _completion_date(upstream, now)
        if completed_on is None or upstream.target_date is None:
            # Completed without a known finish date or without a plan: there is
            # nothing to measure a delay against.
            return None
        return completed_on if completed_on > upstream.target_date else None

    today = _project_today(upstream.project, now)
    schedule = schedule_lookup(upstream.id)
    adjusted_target = schedule.get("adjusted_target_date") if schedule else None
    if adjusted_target is not None:
        # Inherited (chained) delay; keep it at least at "today" while it is open.
        return max(adjusted_target, today)
    if upstream.target_date is not None and upstream.target_date < today:
        # Open and past due: the earliest it can possibly finish is today.
        return today
    return None


def _is_eligible_dependent(issue):
    """Only open, non-archived, non-draft issues with at least one date can be delayed."""
    if issue.archived_at is not None or issue.is_draft:
        return False
    if _is_closed(issue):
        return False
    return issue.start_date is not None or issue.target_date is not None


def _compute_projection(issue, upstream_ids, issues_by_id, schedule_lookup, now):
    """
    Compute the dependency-delay projection for one issue.

    Returns a dict with ``delayed_by_id``, ``dependency_finish_date``,
    ``adjusted_start_date`` and ``adjusted_target_date`` when the issue is
    dependency delayed, otherwise None.
    """
    if not _is_eligible_dependent(issue):
        return None

    latest_finish = None
    culprit_id = None
    for upstream_id in upstream_ids:
        upstream = issues_by_id.get(upstream_id)
        if upstream is None:
            continue
        finish = _projected_finish(upstream, schedule_lookup, now)
        if finish is not None and (latest_finish is None or finish > latest_finish):
            latest_finish = finish
            culprit_id = upstream_id
    if latest_finish is None:
        return None

    earliest_start = next_working_day(latest_finish)
    planned_anchor = issue.start_date or issue.target_date
    if earliest_start <= planned_anchor:
        # The delay still leaves enough room to start (or finish) as planned.
        return None

    if issue.start_date and issue.target_date and issue.target_date >= issue.start_date:
        duration = working_days_between(issue.start_date, issue.target_date) or 1
    else:
        duration = 1

    return {
        "delayed_by_id": culprit_id,
        "dependency_finish_date": latest_finish,
        "adjusted_start_date": earliest_start,
        "adjusted_target_date": add_working_days(earliest_start, duration),
    }


def _downstream_closure(seed_ids):
    """
    The seed issues plus every transitive dependent reachable through ``blocked_by``
    edges. Bounded by MAX_AFFECTED_ISSUES; cycles are naturally terminated by the
    visited set.
    """
    affected = set(seed_ids)
    frontier = set(seed_ids)
    truncated = False
    while frontier and not truncated:
        dependents = {
            str(issue_id)
            for issue_id in IssueRelation.objects.filter(
                relation_type="blocked_by", related_issue_id__in=frontier
            ).values_list("issue_id", flat=True)
        }
        frontier = dependents - affected
        for issue_id in frontier:
            if len(affected) >= MAX_AFFECTED_ISSUES:
                truncated = True
                break
            affected.add(issue_id)
    if truncated:
        logger.warning(
            "Dependency schedule recalculation truncated at %s issues",
            MAX_AFFECTED_ISSUES,
            extra={"data": {"seed_count": len(seed_ids)}},
        )
    return affected


def _topological_order(affected_ids, upstream_map):
    """
    Kahn's algorithm over the affected subgraph. Returns (ordered_ids, cyclic_ids):
    issues involved in a circular dependency end up in ``cyclic_ids`` and are not
    recomputed — their projections are cleared instead of risking corrupted dates.
    """
    in_set_upstreams = {
        issue_id: [u for u in upstream_map.get(issue_id, ()) if u in affected_ids] for issue_id in affected_ids
    }
    dependents_of = {issue_id: [] for issue_id in affected_ids}
    in_degree = {}
    for issue_id, ups in in_set_upstreams.items():
        in_degree[issue_id] = len(ups)
        for u in ups:
            dependents_of[u].append(issue_id)

    queue = [issue_id for issue_id, degree in in_degree.items() if degree == 0]
    ordered = []
    while queue:
        current = queue.pop()
        ordered.append(current)
        for dependent in dependents_of[current]:
            in_degree[dependent] -= 1
            if in_degree[dependent] == 0:
                queue.append(dependent)

    cyclic = set(affected_ids) - set(ordered)
    return ordered, cyclic


def _schedule_as_dict(row):
    return {
        "delayed_by_id": str(row.delayed_by_id),
        "dependency_finish_date": row.dependency_finish_date,
        "adjusted_start_date": row.adjusted_start_date,
        "adjusted_target_date": row.adjusted_target_date,
    }


def recalculate_for_seeds(seed_ids, now=None):
    """
    Recompute dependency schedules for the seed issues, all their transitive
    dependents, and any issue whose stored delay still points at a seed (covers
    removed relations and deleted upstreams). Returns a summary dict.
    """
    if now is None:
        now = timezone.now()

    seed_ids = {str(s) for s in seed_ids if s}
    if not seed_ids:
        return {"affected": 0, "created": 0, "updated": 0, "deleted": 0, "cyclic": 0}

    # Issues whose stored projection blames a seed must be revisited even when the
    # relation that produced the projection no longer exists.
    stale_dependents = set(
        map(
            str,
            IssueDependencySchedule.objects.filter(delayed_by_id__in=seed_ids).values_list("issue_id", flat=True),
        )
    )
    affected = _downstream_closure(seed_ids | stale_dependents)

    # Schedule rows are derived data, but deleting an upstream issue soft-deletes
    # them through ``soft_delete_related_objects``. A soft-deleted row still holds
    # the one-to-one unique index on ``issue_id``, which would break recreating a
    # projection for that issue — purge such rows before recomputing.
    IssueDependencySchedule.all_objects.filter(issue_id__in=affected, deleted_at__isnull=False).delete()

    # Direct upstream edges for every affected issue.
    upstream_map = {}
    for issue_id, upstream_id in IssueRelation.objects.filter(
        relation_type="blocked_by", issue_id__in=affected
    ).values_list("issue_id", "related_issue_id"):
        upstream_map.setdefault(str(issue_id), []).append(str(upstream_id))

    upstream_ids = {u for ups in upstream_map.values() for u in ups}
    load_ids = affected | upstream_ids
    issues_by_id = {
        str(issue.id): issue
        for issue in Issue.objects.filter(id__in=load_ids).select_related("state", "project")
    }

    schedule_rows = {
        str(row.issue_id): row
        for row in IssueDependencySchedule.objects.filter(issue_id__in=load_ids)
    }

    computed = {}

    def schedule_lookup(issue_id):
        issue_id = str(issue_id)
        if issue_id in computed:
            return computed[issue_id]
        row = schedule_rows.get(issue_id)
        return _schedule_as_dict(row) if row else None

    ordered, cyclic = _topological_order(affected, upstream_map)
    if cyclic:
        logger.warning(
            "Circular blocked_by dependency detected; clearing projections for cycle members",
            extra={"data": {"issue_ids": sorted(cyclic)}},
        )

    for issue_id in ordered:
        issue = issues_by_id.get(issue_id)
        if issue is None:
            computed[issue_id] = None
            continue
        computed[issue_id] = _compute_projection(
            issue, upstream_map.get(issue_id, ()), issues_by_id, schedule_lookup, now
        )
    for issue_id in cyclic:
        computed[issue_id] = None

    created = updated = deleted = 0
    for issue_id in affected:
        projection = computed.get(issue_id)
        row = schedule_rows.get(issue_id)
        if projection is None:
            if row is not None:
                # Derived data: hard delete so a future projection can be recreated.
                IssueDependencySchedule.objects.filter(pk=row.pk).delete(soft=False)
                deleted += 1
            continue
        if row is None:
            issue = issues_by_id[issue_id]
            IssueDependencySchedule.objects.create(
                issue_id=issue_id,
                project_id=issue.project_id,
                delayed_by_id=projection["delayed_by_id"],
                dependency_finish_date=projection["dependency_finish_date"],
                adjusted_start_date=projection["adjusted_start_date"],
                adjusted_target_date=projection["adjusted_target_date"],
            )
            created += 1
        elif _schedule_as_dict(row) != projection:
            row.delayed_by_id = projection["delayed_by_id"]
            row.dependency_finish_date = projection["dependency_finish_date"]
            row.adjusted_start_date = projection["adjusted_start_date"]
            row.adjusted_target_date = projection["adjusted_target_date"]
            row.save(
                update_fields=[
                    "delayed_by_id",
                    "dependency_finish_date",
                    "adjusted_start_date",
                    "adjusted_target_date",
                    "updated_at",
                ]
            )
            updated += 1

    summary = {
        "affected": len(affected),
        "created": created,
        "updated": updated,
        "deleted": deleted,
        "cyclic": len(cyclic),
    }
    logger.info("Dependency schedules recalculated", extra={"data": summary})
    return summary


@shared_task
def recalculate_dependency_schedules(issue_id=None, extra_issue_ids=None, now=None):
    """
    Celery entry point for event-driven recalculation. ``now`` is optional (ISO
    string or datetime) and exists for deterministic tests.
    """
    try:
        if isinstance(now, str):
            now = datetime.fromisoformat(now)
        if now is not None and timezone.is_naive(now):
            now = timezone.make_aware(now, timezone=pytz.utc)
        seeds = set(extra_issue_ids or [])
        if issue_id:
            seeds.add(str(issue_id))
        return recalculate_for_seeds(seeds, now=now)
    except Exception as e:
        log_exception(e)
        return


@shared_task
def dependency_schedule_sweep(now=None):
    """
    Celery Beat entry point. Refreshes every stored projection and picks up newly
    late upstreams — "today" moves forward without any issue being edited, so this
    keeps open-past-due pushes current.
    """
    try:
        if now is None:
            now = timezone.now()
        elif isinstance(now, str):
            now = datetime.fromisoformat(now)
        if timezone.is_naive(now):
            now = timezone.make_aware(now, timezone=pytz.utc)

        # Loose bound: a project timezone can be ahead of UTC, so include one extra
        # day; the per-issue recalculation applies the exact project-local "today".
        loose_today = now.date() + timedelta(days=1)

        late_upstreams = (
            IssueRelation.objects.filter(
                relation_type="blocked_by",
                related_issue__target_date__isnull=False,
                related_issue__target_date__lt=loose_today,
                related_issue__completed_at__isnull=True,
            )
            .exclude(related_issue__state__group__in=CLOSED_STATE_GROUPS)
            .values_list("related_issue_id", flat=True)
            .distinct()
        )
        stored = IssueDependencySchedule.objects.values_list("issue_id", flat=True)
        seeds = {str(i) for i in late_upstreams} | {str(i) for i in stored}
        if not seeds:
            return {"affected": 0, "created": 0, "updated": 0, "deleted": 0, "cyclic": 0}
        return recalculate_for_seeds(seeds, now=now)
    except Exception as e:
        log_exception(e)
        return


def _maybe_dispatch_auto_shift(activity_type, issue_id, payload, current_instance, actor_id):
    """
    Dispatch the dependency auto-shift when a work item's ``target_date`` actually
    changed. Payloads carrying the auto-shift marker are themselves the *output* of
    an auto-shift pass and never re-trigger one — that guard is what prevents
    recursive shifting through the activity pipeline.
    """
    # imported lazily: the auto-shift module imports helpers from this module
    from plane.bgtasks.dependency_auto_shift_task import AUTO_SHIFT_MARKER, auto_shift_dependents

    if activity_type != "issue.activity.updated" or not issue_id:
        return
    if "target_date" not in payload or payload.get(AUTO_SHIFT_MARKER):
        return

    previous = {}
    if current_instance:
        try:
            parsed = json.loads(current_instance)
            if isinstance(parsed, dict):
                previous = parsed
        except (TypeError, ValueError):
            previous = {}

    old_target = previous.get("target_date")
    new_target = payload.get("target_date")
    if not old_target or not new_target or str(old_target)[:10] == str(new_target)[:10]:
        return

    auto_shift_dependents.delay(
        issue_id=str(issue_id),
        old_target_date=str(old_target)[:10],
        new_target_date=str(new_target)[:10],
        actor_id=str(actor_id) if actor_id else None,
    )


def handle_issue_activity_for_dependencies(
    activity_type, issue_id, project_id, requested_data, current_instance=None, actor_id=None
):
    """
    Additive hook called from the ``issue_activity`` pipeline. Decides whether the
    activity can affect dependency schedules and, if so, dispatches an async
    projection recalculation — and, for unmarked ``target_date`` changes, the
    dependency auto-shift. Never raises.
    """
    try:
        payload = {}
        if requested_data:
            try:
                parsed = json.loads(requested_data)
                if isinstance(parsed, dict):
                    payload = parsed
            except (TypeError, ValueError):
                payload = {}

        _maybe_dispatch_auto_shift(activity_type, issue_id, payload, current_instance, actor_id)

        extra_ids = []
        if activity_type in ("issue_relation.activity.created", "issue_relation.activity.deleted"):
            relation_type = payload.get("relation_type")
            if relation_type is not None and relation_type not in ("blocked_by", "blocking"):
                return
            related = payload.get("issues") or []
            if isinstance(related, (list, tuple)):
                extra_ids.extend(str(i) for i in related)
            related_issue = payload.get("related_issue")
            if related_issue:
                extra_ids.append(str(related_issue))
        elif activity_type in ("issue.activity.created", "issue.activity.updated"):
            if not RELEVANT_ISSUE_KEYS & set(payload.keys()):
                return
        elif activity_type != "issue.activity.deleted":
            return

        if not issue_id and not extra_ids:
            return
        recalculate_dependency_schedules.delay(
            issue_id=str(issue_id) if issue_id else None,
            extra_issue_ids=extra_ids or None,
        )
    except Exception as e:
        log_exception(e)
