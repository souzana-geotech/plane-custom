# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Unit tests for dependency auto-shift (`plane.bgtasks.dependency_auto_shift_task`).

Covers: single dependency (forward and backward moves), chain propagation,
multiple dependencies (latest required date wins), working-day arithmetic across
Sundays, closed/undated dependents, dependency cycles, the stale-event guard,
duplicate-update prevention, the activity marker that stops recursive shifting,
and the hook's dispatch conditions.

Calendar anchors (2026): Sep 7 = Monday, Sep 12 = Saturday, Sep 13 = Sunday,
Sep 14 = Monday.
"""

import json
from datetime import date
from uuid import uuid4

import pytest

from plane.bgtasks.dependency_auto_shift_task import AUTO_SHIFT_MARKER, auto_shift_dependents
from plane.bgtasks.dependency_schedule_task import handle_issue_activity_for_dependencies
from plane.db.models import Issue, IssueRelation, State
from plane.tests.factories import ProjectFactory, UserFactory, WorkspaceFactory


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

    def move(self, issue, new_target, new_start=None):
        """Reschedule like a view would: save new dates, then run the auto-shift."""
        old_target = issue.target_date
        update = {"target_date": new_target}
        if new_start is not None:
            update["start_date"] = new_start
        Issue.objects.filter(pk=issue.pk).update(**update)
        issue.refresh_from_db()
        return auto_shift_dependents(
            issue_id=str(issue.id),
            old_target_date=old_target.isoformat(),
            new_target_date=new_target.isoformat(),
        )


@pytest.fixture
def env(db):
    workspace = WorkspaceFactory(owner=UserFactory(username=f"auto_shift_{uuid4().hex[:8]}"))
    project = ProjectFactory(workspace=workspace, timezone="UTC")
    states = {
        "open": State.objects.create(project=project, name="In Progress", group="started", color="#000"),
        "completed": State.objects.create(project=project, name="Done", group="completed", color="#000"),
    }
    return Env(project, states)


def _dates(issue):
    issue.refresh_from_db()
    return issue.start_date, issue.target_date


@pytest.mark.unit
class TestSingleDependency:
    def test_forward_move_shifts_dependent_and_preserves_duration(self, env):
        # Site Survey due Thu Sep 10; Data Processing planned Fri Sep 11 - Sat Sep 12.
        survey = env.issue("Site Survey", start=date(2026, 9, 8), target=date(2026, 9, 10))
        processing = env.issue("Data Processing", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(processing, survey)

        # Survey slips two working days: Thu Sep 10 -> Sat Sep 12.
        summary = env.move(survey, date(2026, 9, 12))

        assert summary == {"shifted": 1, "cyclic": 0}
        # +2 working days, Sunday Sep 13 skipped: Sep 11-12 -> Sep 14-15.
        assert _dates(processing) == (date(2026, 9, 14), date(2026, 9, 15))

    def test_backward_move_pulls_dependent_earlier(self, env):
        survey = env.issue("Site Survey", target=date(2026, 9, 10))
        processing = env.issue("Data Processing", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(processing, survey)

        env.move(survey, date(2026, 9, 9))  # one working day earlier

        assert _dates(processing) == (date(2026, 9, 10), date(2026, 9, 11))

    def test_saturday_to_monday_rollover(self, env):
        survey = env.issue("Site Survey", target=date(2026, 9, 11))
        processing = env.issue("Data Processing", start=date(2026, 9, 12), target=date(2026, 9, 12))
        env.block(processing, survey)

        env.move(survey, date(2026, 9, 12))  # +1 working day (Fri -> Sat)

        # Sat Sep 12 + 1 working day skips Sunday and lands on Monday Sep 14.
        assert _dates(processing) == (date(2026, 9, 14), date(2026, 9, 14))

    def test_planned_slack_is_preserved(self, env):
        survey = env.issue("Site Survey", target=date(2026, 9, 8))
        # the user planned a two-working-day buffer after the survey
        processing = env.issue("Data Processing", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(processing, survey)

        env.move(survey, date(2026, 9, 9))  # +1 working day

        # shifted by the same delta; the buffer stays two working days
        assert _dates(processing) == (date(2026, 9, 12), date(2026, 9, 14))

    def test_target_only_dependent_shifts_its_target(self, env):
        survey = env.issue("Site Survey", target=date(2026, 9, 10))
        processing = env.issue("Data Processing", target=date(2026, 9, 11))
        env.block(processing, survey)

        env.move(survey, date(2026, 9, 11))

        assert _dates(processing) == (None, date(2026, 9, 12))

    def test_completed_dependent_is_never_moved(self, env):
        survey = env.issue("Site Survey", target=date(2026, 9, 10))
        done = env.issue("Done Work", start=date(2026, 9, 11), target=date(2026, 9, 12), state="completed")
        env.block(done, survey)

        summary = env.move(survey, date(2026, 9, 14))

        assert summary["shifted"] == 0
        assert _dates(done) == (date(2026, 9, 11), date(2026, 9, 12))

    def test_undated_dependent_is_ignored(self, env):
        survey = env.issue("Site Survey", target=date(2026, 9, 10))
        undated = env.issue("Undated")
        env.block(undated, survey)

        summary = env.move(survey, date(2026, 9, 14))

        assert summary["shifted"] == 0
        assert _dates(undated) == (None, None)


@pytest.mark.unit
class TestChainPropagation:
    def test_shift_propagates_through_the_whole_chain(self, env):
        a = env.issue("A", target=date(2026, 9, 8))
        b = env.issue("B", start=date(2026, 9, 9), target=date(2026, 9, 10))
        c = env.issue("C", start=date(2026, 9, 11), target=date(2026, 9, 12))
        d = env.issue("D", start=date(2026, 9, 14), target=date(2026, 9, 15))
        env.block(b, a)
        env.block(c, b)
        env.block(d, c)

        summary = env.move(a, date(2026, 9, 9))  # +1 working day

        assert summary == {"shifted": 3, "cyclic": 0}
        assert _dates(b) == (date(2026, 9, 10), date(2026, 9, 11))
        # C crosses the weekend: Sep 11-12 -> Sep 12, then Monday Sep 14.
        assert _dates(c) == (date(2026, 9, 12), date(2026, 9, 14))
        assert _dates(d) == (date(2026, 9, 15), date(2026, 9, 16))

    def test_chain_stops_behind_a_completed_dependent(self, env):
        a = env.issue("A", target=date(2026, 9, 8))
        b = env.issue("B", start=date(2026, 9, 9), target=date(2026, 9, 10), state="completed")
        c = env.issue("C", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(b, a)
        env.block(c, b)

        summary = env.move(a, date(2026, 9, 10))

        # B is done and does not move, so its finish - C's requirement - is unchanged.
        assert summary["shifted"] == 0
        assert _dates(b) == (date(2026, 9, 9), date(2026, 9, 10))
        assert _dates(c) == (date(2026, 9, 11), date(2026, 9, 12))


@pytest.mark.unit
class TestMultipleDependencies:
    def test_moving_a_non_binding_blocker_does_not_shift(self, env):
        early = env.issue("Early Blocker", target=date(2026, 9, 8))
        late = env.issue("Late Blocker", target=date(2026, 9, 11))
        x = env.issue("X", start=date(2026, 9, 12), target=date(2026, 9, 14))
        env.block(x, early)
        env.block(x, late)

        # early moves but still finishes before the late blocker - the latest
        # required date (Sep 11) is unchanged, so X stays put.
        summary = env.move(early, date(2026, 9, 10))

        assert summary["shifted"] == 0
        assert _dates(x) == (date(2026, 9, 12), date(2026, 9, 14))

    def test_moving_the_binding_blocker_shifts_by_the_requirement_change(self, env):
        early = env.issue("Early Blocker", target=date(2026, 9, 8))
        late = env.issue("Late Blocker", target=date(2026, 9, 11))
        x = env.issue("X", start=date(2026, 9, 12), target=date(2026, 9, 14))
        env.block(x, early)
        env.block(x, late)

        env.move(late, date(2026, 9, 14))  # latest requirement Sep 11 -> Sep 14: +2 working days

        assert _dates(x) == (date(2026, 9, 15), date(2026, 9, 16))

    def test_backward_move_is_limited_by_the_other_blocker(self, env):
        b1 = env.issue("B1", target=date(2026, 9, 10))
        b2 = env.issue("B2", target=date(2026, 9, 9))
        x = env.issue("X", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(x, b1)
        env.block(x, b2)

        # B1 moves way back; the latest required date only drops to B2's Sep 9,
        # so X moves back exactly one working day, not four.
        env.move(b1, date(2026, 9, 4))

        assert _dates(x) == (date(2026, 9, 10), date(2026, 9, 11))


@pytest.mark.unit
class TestSafetyGuards:
    def test_cycle_is_detected_and_skipped(self, env):
        a = env.issue("A", start=date(2026, 9, 8), target=date(2026, 9, 9))
        b = env.issue("B", start=date(2026, 9, 10), target=date(2026, 9, 11))
        env.block(b, a)
        env.block(a, b)

        summary = env.move(a, date(2026, 9, 10))

        assert summary["shifted"] == 0
        assert summary["cyclic"] >= 2
        assert _dates(b) == (date(2026, 9, 10), date(2026, 9, 11))

    def test_diamond_graph_updates_each_dependent_once(self, env):
        top = env.issue("Top", target=date(2026, 9, 8))
        left = env.issue("Left", start=date(2026, 9, 9), target=date(2026, 9, 9))
        right = env.issue("Right", start=date(2026, 9, 9), target=date(2026, 9, 10))
        bottom = env.issue("Bottom", start=date(2026, 9, 11), target=date(2026, 9, 11))
        env.block(left, top)
        env.block(right, top)
        env.block(bottom, left)
        env.block(bottom, right)

        summary = env.move(top, date(2026, 9, 9))  # +1 working day

        # three dependents, each shifted exactly once; bottom follows the latest
        # requirement (right: Sep 10 -> Sep 11), not a double application.
        assert summary == {"shifted": 3, "cyclic": 0}
        assert _dates(left) == (date(2026, 9, 10), date(2026, 9, 10))
        assert _dates(right) == (date(2026, 9, 10), date(2026, 9, 11))
        assert _dates(bottom) == (date(2026, 9, 12), date(2026, 9, 12))

    def test_stale_event_is_ignored(self, env):
        survey = env.issue("Site Survey", target=date(2026, 9, 10))
        processing = env.issue("Data Processing", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(processing, survey)

        # The payload says Sep 10 -> Sep 14, but the issue has moved on since.
        Issue.objects.filter(pk=survey.pk).update(target_date=date(2026, 9, 16))
        summary = auto_shift_dependents(
            issue_id=str(survey.id), old_target_date="2026-09-10", new_target_date="2026-09-14"
        )

        assert summary["shifted"] == 0
        assert _dates(processing) == (date(2026, 9, 11), date(2026, 9, 12))

    def test_shifted_dependents_announce_marked_activities(self, env, monkeypatch):
        dispatched = []
        monkeypatch.setattr(
            "plane.bgtasks.issue_activities_task.issue_activity.delay",
            lambda **kwargs: dispatched.append(kwargs),
        )
        survey = env.issue("Site Survey", target=date(2026, 9, 10))
        processing = env.issue("Data Processing", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(processing, survey)

        env.move(survey, date(2026, 9, 11))

        assert len(dispatched) == 1
        payload = json.loads(dispatched[0]["requested_data"])
        assert payload[AUTO_SHIFT_MARKER] is True
        assert payload["start_date"] == "2026-09-12"
        previous = json.loads(dispatched[0]["current_instance"])
        assert previous["start_date"] == "2026-09-11"


@pytest.mark.unit
class TestActivityHookDispatch:
    @pytest.fixture
    def dispatched(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            "plane.bgtasks.dependency_auto_shift_task.auto_shift_dependents.delay",
            lambda **kwargs: calls.append(kwargs),
        )
        # projection recalculation is exercised elsewhere; silence it here
        monkeypatch.setattr(
            "plane.bgtasks.dependency_schedule_task.recalculate_dependency_schedules.delay",
            lambda **kwargs: None,
        )
        return calls

    def test_target_date_change_dispatches_auto_shift(self, dispatched):
        issue_id = str(uuid4())
        handle_issue_activity_for_dependencies(
            "issue.activity.updated",
            issue_id,
            str(uuid4()),
            '{"target_date": "2026-09-14"}',
            current_instance='{"target_date": "2026-09-10"}',
            actor_id=str(uuid4()),
        )
        assert len(dispatched) == 1
        assert dispatched[0]["old_target_date"] == "2026-09-10"
        assert dispatched[0]["new_target_date"] == "2026-09-14"

    def test_unchanged_target_date_is_ignored(self, dispatched):
        handle_issue_activity_for_dependencies(
            "issue.activity.updated",
            str(uuid4()),
            str(uuid4()),
            '{"target_date": "2026-09-10"}',
            current_instance='{"target_date": "2026-09-10"}',
        )
        assert dispatched == []

    def test_marked_payload_never_retriggers_auto_shift(self, dispatched):
        handle_issue_activity_for_dependencies(
            "issue.activity.updated",
            str(uuid4()),
            str(uuid4()),
            json.dumps({"target_date": "2026-09-14", AUTO_SHIFT_MARKER: True}),
            current_instance='{"target_date": "2026-09-10"}',
        )
        assert dispatched == []

    def test_start_date_only_change_does_not_auto_shift(self, dispatched):
        handle_issue_activity_for_dependencies(
            "issue.activity.updated",
            str(uuid4()),
            str(uuid4()),
            '{"start_date": "2026-09-09"}',
            current_instance='{"start_date": "2026-09-08"}',
        )
        assert dispatched == []

    def test_cleared_target_date_does_not_auto_shift(self, dispatched):
        handle_issue_activity_for_dependencies(
            "issue.activity.updated",
            str(uuid4()),
            str(uuid4()),
            '{"target_date": null}',
            current_instance='{"target_date": "2026-09-10"}',
        )
        assert dispatched == []
