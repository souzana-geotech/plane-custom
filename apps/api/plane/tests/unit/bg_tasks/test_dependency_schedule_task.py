# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Unit tests for dependency-aware scheduling (`plane.bgtasks.dependency_schedule_task`).

Covers: basic dependency delay, chains, multiple dependencies, Sunday exclusion,
Saturday -> Monday rollover, completed/reopened dependencies, removed dependencies,
manual date changes, circular dependencies, tasks without dependencies, the activity
hook filter, the hourly sweep, and coexistence with the existing overdue reminders.

Calendar anchors (2026): Sep 7 = Monday, Sep 12 = Saturday, Sep 13 = Sunday,
Sep 14 = Monday. "Now" is fixed to Monday Sep 14, 09:00 UTC.
"""

from datetime import date, datetime, timezone as dt_timezone
from uuid import uuid4

import pytest

from plane.bgtasks.dependency_schedule_task import (
    dependency_schedule_sweep,
    handle_issue_activity_for_dependencies,
    recalculate_dependency_schedules,
    recalculate_for_seeds,
)
from plane.bgtasks.issue_reminder_task import OVERDUE_FIELD, issue_due_date_reminders
from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueDependencySchedule,
    IssueRelation,
    Notification,
    State,
)
from plane.tests.factories import ProjectFactory, ProjectMemberFactory, UserFactory, WorkspaceFactory

NOW = datetime(2026, 9, 14, 9, 0, tzinfo=dt_timezone.utc)  # Monday
TODAY = date(2026, 9, 14)


def _utc(year, month, day, hour=12):
    return datetime(year, month, day, hour, tzinfo=dt_timezone.utc)


class Env:
    def __init__(self, project, states):
        self.project = project
        self.states = states

    def issue(self, name="Work Item", start=None, target=None, state="open"):
        return Issue.objects.create(
            project=self.project,
            name=name,
            state=self.states[state],
            start_date=start,
            target_date=target,
        )

    def block(self, dependent, upstream):
        """dependent is blocked_by upstream (stored forward form)."""
        return IssueRelation.objects.create(
            project=self.project,
            issue=dependent,
            related_issue=upstream,
            relation_type="blocked_by",
        )

    def complete(self, issue, completed_at):
        """Mark completed with a controlled timestamp (bypasses save-time now())."""
        Issue.objects.filter(pk=issue.pk).update(state=self.states["completed"], completed_at=completed_at)

    def reopen(self, issue):
        Issue.objects.filter(pk=issue.pk).update(state=self.states["open"], completed_at=None)


@pytest.fixture
def env(db):
    workspace = WorkspaceFactory(owner=UserFactory(username=f"dep_sched_{uuid4().hex[:8]}"))
    project = ProjectFactory(workspace=workspace, timezone="UTC")
    states = {
        "open": State.objects.create(project=project, name="In Progress", group="started", color="#000"),
        "completed": State.objects.create(project=project, name="Done", group="completed", color="#000"),
        "cancelled": State.objects.create(project=project, name="Cancelled", group="cancelled", color="#000"),
    }
    return Env(project, states)


def _schedule(issue):
    return IssueDependencySchedule.objects.filter(issue_id=issue.id).first()


@pytest.mark.unit
class TestBasicDependencyDelay:
    def test_upstream_completed_late_pushes_dependent(self, env):
        # Site Survey: due Thu Sep 10, actually finished Sun Sep 13.
        survey = env.issue("Site Survey", target=date(2026, 9, 10))
        env.complete(survey, _utc(2026, 9, 13, 18))
        # Data Processing: planned Fri Sep 11 - Sat Sep 12 (2 working days).
        processing = env.issue("Data Processing", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(processing, survey)

        recalculate_for_seeds([survey.id], now=NOW)

        schedule = _schedule(processing)
        assert schedule is not None
        assert schedule.delayed_by_id == survey.id
        assert schedule.dependency_finish_date == date(2026, 9, 13)
        # Next working day after Sunday Sep 13 is Monday Sep 14; 2 working days kept.
        assert schedule.adjusted_start_date == date(2026, 9, 14)
        assert schedule.adjusted_target_date == date(2026, 9, 15)
        # The dependent's own dates are never modified.
        processing.refresh_from_db()
        assert processing.start_date == date(2026, 9, 11)
        assert processing.target_date == date(2026, 9, 12)

    def test_open_overdue_upstream_pushes_using_today(self, env):
        upstream = env.issue("Late Upstream", target=date(2026, 9, 10))  # open, past due
        dependent = env.issue("Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(dependent, upstream)

        recalculate_for_seeds([upstream.id], now=NOW)

        schedule = _schedule(dependent)
        assert schedule is not None
        # Earliest possible upstream finish is "today" (Mon Sep 14).
        assert schedule.dependency_finish_date == TODAY
        assert schedule.adjusted_start_date == date(2026, 9, 15)
        assert schedule.adjusted_target_date == date(2026, 9, 16)

    def test_dependent_with_room_to_spare_is_not_delayed(self, env):
        upstream = env.issue("Late Upstream", target=date(2026, 9, 10))  # finish projected today (Sep 14)
        dependent = env.issue("Dependent", start=date(2026, 9, 15), target=date(2026, 9, 16))
        env.block(dependent, upstream)

        recalculate_for_seeds([upstream.id], now=NOW)

        assert _schedule(dependent) is None

    def test_upstream_on_time_does_not_delay(self, env):
        upstream = env.issue("On Time", target=date(2026, 9, 10))
        env.complete(upstream, _utc(2026, 9, 10))
        dependent = env.issue("Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(dependent, upstream)

        recalculate_for_seeds([upstream.id], now=NOW)

        assert _schedule(dependent) is None

    def test_completed_dependent_is_never_marked_delayed(self, env):
        upstream = env.issue("Late Upstream", target=date(2026, 9, 10))
        dependent = env.issue("Done Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.complete(dependent, _utc(2026, 9, 12))
        env.block(dependent, upstream)

        recalculate_for_seeds([upstream.id], now=NOW)

        assert _schedule(dependent) is None


@pytest.mark.unit
class TestDependencyChains:
    def test_delay_propagates_through_chain(self, env):
        # A (late) -> B -> C -> D
        a = env.issue("A", target=date(2026, 9, 10))  # open, past due -> finishes today at best
        b = env.issue("B", start=date(2026, 9, 11), target=date(2026, 9, 12))  # 2 working days
        c = env.issue("C", start=date(2026, 9, 14), target=date(2026, 9, 15))  # 2 working days
        d = env.issue("D", start=date(2026, 9, 16), target=date(2026, 9, 17))  # 2 working days
        env.block(b, a)
        env.block(c, b)
        env.block(d, c)

        summary = recalculate_for_seeds([a.id], now=NOW)
        assert summary["cyclic"] == 0

        b_schedule = _schedule(b)
        assert (b_schedule.adjusted_start_date, b_schedule.adjusted_target_date) == (
            date(2026, 9, 15),
            date(2026, 9, 16),
        )
        c_schedule = _schedule(c)
        assert c_schedule.delayed_by_id == b.id
        assert (c_schedule.adjusted_start_date, c_schedule.adjusted_target_date) == (
            date(2026, 9, 17),
            date(2026, 9, 18),
        )
        d_schedule = _schedule(d)
        assert d_schedule.delayed_by_id == c.id
        # Next working day after Fri Sep 18 is Sat Sep 19; the second working day
        # after that is Monday Sep 21 (Sunday Sep 20 is skipped).
        assert (d_schedule.adjusted_start_date, d_schedule.adjusted_target_date) == (
            date(2026, 9, 19),
            date(2026, 9, 21),
        )

    def test_chain_recovers_when_root_completes_on_time(self, env):
        # B and C are planned in the future so that, once A recovers, nothing in
        # the chain is late by its own dates.
        a = env.issue("A", target=date(2026, 9, 10))  # open, past due
        b = env.issue("B", start=date(2026, 9, 14), target=date(2026, 9, 15))
        c = env.issue("C", start=date(2026, 9, 16), target=date(2026, 9, 17))
        env.block(b, a)
        env.block(c, b)
        recalculate_for_seeds([a.id], now=NOW)
        assert _schedule(b) is not None and _schedule(c) is not None

        env.complete(a, _utc(2026, 9, 10))
        recalculate_for_seeds([a.id], now=NOW)

        assert _schedule(b) is None
        assert _schedule(c) is None

    def test_chain_keeps_delay_from_middle_when_middle_is_itself_late(self, env):
        # Even when the root recovers, a middle item that is open past its own
        # target keeps pushing its dependents (the delay source shifts to it).
        a = env.issue("A", target=date(2026, 9, 10))
        b = env.issue("B", start=date(2026, 9, 11), target=date(2026, 9, 12))  # past due by itself
        c = env.issue("C", start=date(2026, 9, 14), target=date(2026, 9, 15))
        env.block(b, a)
        env.block(c, b)
        recalculate_for_seeds([a.id], now=NOW)

        env.complete(a, _utc(2026, 9, 10))
        recalculate_for_seeds([a.id], now=NOW)

        assert _schedule(b) is None  # B is overdue, not dependency delayed
        c_schedule = _schedule(c)
        assert c_schedule is not None
        assert c_schedule.delayed_by_id == b.id


@pytest.mark.unit
class TestMultipleDependencies:
    def test_latest_dependency_finish_wins(self, env):
        u1 = env.issue("U1", target=date(2026, 9, 8))
        env.complete(u1, _utc(2026, 9, 9))  # one day late
        u2 = env.issue("U2", target=date(2026, 9, 9))
        env.complete(u2, _utc(2026, 9, 11))  # two days late, finishes latest
        x = env.issue("X", start=date(2026, 9, 10), target=date(2026, 9, 10))
        env.block(x, u1)
        env.block(x, u2)

        recalculate_for_seeds([u1.id, u2.id], now=NOW)

        schedule = _schedule(x)
        assert schedule is not None
        assert schedule.delayed_by_id == u2.id
        assert schedule.dependency_finish_date == date(2026, 9, 11)
        assert schedule.adjusted_start_date == date(2026, 9, 12)  # Saturday is a working day
        assert schedule.adjusted_target_date == date(2026, 9, 12)


@pytest.mark.unit
class TestWorkingDayRules:
    def test_saturday_finish_rolls_dependent_to_monday(self, env):
        upstream = env.issue("Upstream", target=date(2026, 9, 10))
        env.complete(upstream, _utc(2026, 9, 12))  # finished late on Saturday
        dependent = env.issue("Dependent", start=date(2026, 9, 12), target=date(2026, 9, 12))
        env.block(dependent, upstream)

        recalculate_for_seeds([upstream.id], now=NOW)

        schedule = _schedule(dependent)
        # Saturday -> Monday: Sunday Sep 13 is excluded.
        assert schedule.adjusted_start_date == date(2026, 9, 14)
        assert schedule.adjusted_target_date == date(2026, 9, 14)

    def test_adjusted_window_never_lands_on_sunday(self, env):
        upstream = env.issue("Upstream", target=date(2026, 9, 10))
        env.complete(upstream, _utc(2026, 9, 13))  # finished late on Sunday
        dependent = env.issue("Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(dependent, upstream)

        recalculate_for_seeds([upstream.id], now=NOW)

        schedule = _schedule(dependent)
        assert schedule.adjusted_start_date.weekday() != 6
        assert schedule.adjusted_target_date.weekday() != 6
        assert schedule.adjusted_start_date == date(2026, 9, 14)


@pytest.mark.unit
class TestCompletedAndReopenedDependencies:
    def test_completing_upstream_on_time_clears_delay(self, env):
        upstream = env.issue("Upstream", target=date(2026, 9, 10))
        dependent = env.issue("Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(dependent, upstream)
        recalculate_for_seeds([upstream.id], now=NOW)
        assert _schedule(dependent) is not None

        # Backdated completion: it was actually finished on its due date.
        env.complete(upstream, _utc(2026, 9, 10))
        recalculate_for_seeds([upstream.id], now=NOW)
        assert _schedule(dependent) is None

    def test_reopening_late_upstream_restores_delay(self, env):
        upstream = env.issue("Upstream", target=date(2026, 9, 10))
        env.complete(upstream, _utc(2026, 9, 10))
        dependent = env.issue("Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(dependent, upstream)
        recalculate_for_seeds([upstream.id], now=NOW)
        assert _schedule(dependent) is None

        env.reopen(upstream)  # open again and past due
        recalculate_for_seeds([upstream.id], now=NOW)
        assert _schedule(dependent) is not None

    def test_cancelled_upstream_does_not_delay(self, env):
        upstream = env.issue("Cancelled Upstream", target=date(2026, 9, 10), state="cancelled")
        dependent = env.issue("Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(dependent, upstream)

        recalculate_for_seeds([upstream.id], now=NOW)

        assert _schedule(dependent) is None


@pytest.mark.unit
class TestRemovingDependency:
    def test_removing_relation_clears_stale_delay(self, env):
        upstream = env.issue("Upstream", target=date(2026, 9, 10))
        dependent = env.issue("Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        relation = env.block(dependent, upstream)
        recalculate_for_seeds([upstream.id], now=NOW)
        assert _schedule(dependent) is not None

        relation.delete()
        # The remove-relation flow seeds with the issues from the payload; even a
        # seed on the upstream alone finds the stale row through delayed_by.
        recalculate_for_seeds([upstream.id], now=NOW)

        assert _schedule(dependent) is None


@pytest.mark.unit
class TestSoftDeletedScheduleRows:
    def test_projection_is_recreated_over_a_soft_deleted_row(self, env):
        """
        Deleting an upstream issue soft-deletes schedule rows through the generic
        ``soft_delete_related_objects`` cascade. The soft-deleted row still occupies
        the one-to-one unique index, so recalculation must purge it before writing a
        fresh projection (e.g. when a second blocker keeps the issue delayed).
        """
        from django.utils import timezone as django_timezone

        u1 = env.issue("U1", target=date(2026, 9, 10))
        u2 = env.issue("U2", target=date(2026, 9, 10))
        dependent = env.issue("Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(dependent, u1)
        env.block(dependent, u2)
        recalculate_for_seeds([u1.id, u2.id], now=NOW)
        assert _schedule(dependent) is not None

        # Simulate the deletion cascade: the row is soft-deleted, u1 and its
        # relation disappear, but u2 still blocks the dependent.
        IssueDependencySchedule.all_objects.filter(issue_id=dependent.id).update(
            deleted_at=django_timezone.now()
        )
        IssueRelation.objects.filter(issue=dependent, related_issue=u1).delete()
        Issue.objects.filter(pk=u1.pk).update(deleted_at=django_timezone.now())

        recalculate_for_seeds([u1.id, u2.id], now=NOW)

        schedule = _schedule(dependent)
        assert schedule is not None
        assert schedule.delayed_by_id == u2.id
        # Exactly one physical row exists; the soft-deleted one was purged.
        assert IssueDependencySchedule.all_objects.filter(issue_id=dependent.id).count() == 1


@pytest.mark.unit
class TestManualDateChanges:
    def test_moving_dependent_past_the_delay_clears_it(self, env):
        upstream = env.issue("Upstream", target=date(2026, 9, 10))
        dependent = env.issue("Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(dependent, upstream)
        recalculate_for_seeds([upstream.id], now=NOW)
        assert _schedule(dependent) is not None

        # User manually reschedules the dependent after the projected upstream finish.
        Issue.objects.filter(pk=dependent.pk).update(start_date=date(2026, 9, 16), target_date=date(2026, 9, 17))
        recalculate_for_seeds([dependent.id], now=NOW)

        assert _schedule(dependent) is None
        dependent.refresh_from_db()
        # Manual dates are preserved verbatim; recalculation never writes issue dates.
        assert dependent.start_date == date(2026, 9, 16)
        assert dependent.target_date == date(2026, 9, 17)

    def test_recalculation_is_idempotent(self, env):
        upstream = env.issue("Upstream", target=date(2026, 9, 10))
        dependent = env.issue("Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(dependent, upstream)

        recalculate_for_seeds([upstream.id], now=NOW)
        first = _schedule(dependent)
        summary = recalculate_for_seeds([upstream.id], now=NOW)
        second = _schedule(dependent)

        assert summary["created"] == 0 and summary["updated"] == 0 and summary["deleted"] == 0
        assert first.pk == second.pk
        assert first.updated_at == second.updated_at


@pytest.mark.unit
class TestCircularDependencies:
    def test_two_node_cycle_terminates_without_rows(self, env):
        a = env.issue("A", start=date(2026, 9, 11), target=date(2026, 9, 12))
        b = env.issue("B", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(a, b)
        env.block(b, a)

        summary = recalculate_for_seeds([a.id], now=NOW)

        assert summary["cyclic"] == 2
        assert _schedule(a) is None
        assert _schedule(b) is None

    def test_cycle_members_get_projections_cleared(self, env):
        upstream = env.issue("Upstream", target=date(2026, 9, 10))
        a = env.issue("A", start=date(2026, 9, 11), target=date(2026, 9, 12))
        b = env.issue("B", start=date(2026, 9, 14), target=date(2026, 9, 15))
        env.block(a, upstream)
        env.block(b, a)
        recalculate_for_seeds([upstream.id], now=NOW)
        assert _schedule(a) is not None and _schedule(b) is not None

        # Introducing a cycle A <-> B clears both projections instead of looping.
        env.block(a, b)
        summary = recalculate_for_seeds([upstream.id], now=NOW)

        assert summary["cyclic"] == 2
        assert _schedule(a) is None
        assert _schedule(b) is None


@pytest.mark.unit
class TestTasksWithoutDependencies:
    def test_plain_overdue_issue_gets_no_schedule(self, env):
        loner = env.issue("Loner", start=date(2026, 9, 8), target=date(2026, 9, 10))

        recalculate_for_seeds([loner.id], now=NOW)

        assert _schedule(loner) is None

    def test_dependent_without_dates_gets_no_schedule(self, env):
        upstream = env.issue("Upstream", target=date(2026, 9, 10))
        dependent = env.issue("No Dates")
        env.block(dependent, upstream)

        recalculate_for_seeds([upstream.id], now=NOW)

        assert _schedule(dependent) is None

    def test_target_only_dependent_is_supported(self, env):
        upstream = env.issue("Upstream", target=date(2026, 9, 10))
        env.complete(upstream, _utc(2026, 9, 12))
        dependent = env.issue("Target Only", target=date(2026, 9, 12))
        env.block(dependent, upstream)

        recalculate_for_seeds([upstream.id], now=NOW)

        schedule = _schedule(dependent)
        assert schedule is not None
        assert schedule.adjusted_start_date == date(2026, 9, 14)
        assert schedule.adjusted_target_date == date(2026, 9, 14)


@pytest.mark.unit
class TestSweepAndTaskEntryPoints:
    def test_sweep_picks_up_late_upstreams_and_clears_stale_rows(self, env):
        upstream = env.issue("Upstream", target=date(2026, 9, 10))
        dependent = env.issue("Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(dependent, upstream)

        dependency_schedule_sweep(now=NOW)
        assert _schedule(dependent) is not None

        env.complete(upstream, _utc(2026, 9, 10))  # actually finished on time
        dependency_schedule_sweep(now=NOW)
        assert _schedule(dependent) is None

    def test_task_entry_point_accepts_iso_now(self, env):
        upstream = env.issue("Upstream", target=date(2026, 9, 10))
        dependent = env.issue("Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(dependent, upstream)

        recalculate_dependency_schedules(issue_id=str(upstream.id), now=NOW.isoformat())

        assert _schedule(dependent) is not None


@pytest.mark.unit
class TestActivityHook:
    @pytest.fixture
    def dispatched(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            "plane.bgtasks.dependency_schedule_task.recalculate_dependency_schedules.delay",
            lambda **kwargs: calls.append(kwargs),
        )
        return calls

    def test_date_change_dispatches_recalculation(self, dispatched):
        handle_issue_activity_for_dependencies(
            "issue.activity.updated", str(uuid4()), str(uuid4()), '{"target_date": "2026-09-16"}'
        )
        assert len(dispatched) == 1

    def test_state_change_dispatches_recalculation(self, dispatched):
        handle_issue_activity_for_dependencies(
            "issue.activity.updated", str(uuid4()), str(uuid4()), '{"state_id": "abc"}'
        )
        assert len(dispatched) == 1

    def test_unrelated_update_is_ignored(self, dispatched):
        handle_issue_activity_for_dependencies(
            "issue.activity.updated", str(uuid4()), str(uuid4()), '{"name": "Renamed"}'
        )
        assert dispatched == []

    def test_blocked_by_relation_dispatches_with_extra_ids(self, dispatched):
        other = str(uuid4())
        handle_issue_activity_for_dependencies(
            "issue_relation.activity.created",
            str(uuid4()),
            str(uuid4()),
            '{"relation_type": "blocked_by", "issues": ["%s"]}' % other,
        )
        assert len(dispatched) == 1
        assert dispatched[0]["extra_issue_ids"] == [other]

    def test_non_blocking_relation_is_ignored(self, dispatched):
        handle_issue_activity_for_dependencies(
            "issue_relation.activity.created", str(uuid4()), str(uuid4()), '{"relation_type": "duplicate"}'
        )
        assert dispatched == []

    def test_malformed_payload_never_raises(self, dispatched):
        handle_issue_activity_for_dependencies("issue.activity.updated", str(uuid4()), str(uuid4()), "not json")
        assert dispatched == []


@pytest.mark.unit
class TestOverdueVsDependencyDelayed:
    def test_existing_overdue_reminders_are_unaffected(self, env):
        """
        Overdue (the task itself is late) and Dependency Delayed (inherited lateness)
        are independent signals: the existing reminder pipeline still emits its
        overdue notification, while the schedule row identifies the inherited delay.
        """
        user = UserFactory(username=f"dep_overdue_{uuid4().hex[:8]}")
        ProjectMemberFactory(project=env.project, member=user)

        upstream = env.issue("Late Upstream", target=date(2026, 9, 10))
        dependent = env.issue("Dependent", start=date(2026, 9, 11), target=date(2026, 9, 12))
        IssueAssignee.objects.create(issue=dependent, assignee=user, project=env.project)
        env.block(dependent, upstream)

        recalculate_for_seeds([upstream.id], now=NOW)
        issue_due_date_reminders(now=NOW)

        # Dependency Delayed: projection row exists, dates untouched.
        assert _schedule(dependent) is not None
        # Overdue: the untouched reminder pipeline still notifies the assignee
        # (target Sep 12 < today Sep 14).
        assert Notification.objects.filter(
            receiver=user,
            entity_identifier=dependent.id,
            sender__endswith=OVERDUE_FIELD,
        ).exists()
