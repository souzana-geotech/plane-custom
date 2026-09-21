# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: dependency auto-shift must respect a fixed (locked) due date.

Stop / absorb semantics — when the shift reaches a locked task, that task stays
put *and* the chain stops there; the delay is absorbed rather than passed
through to tasks behind it. An upstream task can still move freely: a locked
task somewhere downstream never blocks someone else's reschedule.

Calendar anchors (2026): Sep 7 = Monday, Sep 12 = Saturday, Sep 13 = Sunday,
Sep 14 = Monday. Working days run Monday-Saturday.
"""

from datetime import date
from uuid import uuid4

import pytest

from plane.bgtasks.dependency_auto_shift_task import auto_shift_dependents
from plane.db.models import Issue, IssueRelation, State
from plane.tests.factories import ProjectFactory, UserFactory, WorkspaceFactory


class Env:
    def __init__(self, project, state):
        self.project = project
        self.state = state

    def issue(self, name, start=None, target=None, locked=False):
        return Issue.objects.create(
            project=self.project,
            name=name,
            state=self.state,
            start_date=start,
            target_date=target,
            is_due_date_locked=locked,
        )

    def block(self, dependent, upstream):
        """``dependent`` is blocked_by ``upstream`` (stored forward form)."""
        return IssueRelation.objects.create(
            project=self.project,
            issue=dependent,
            related_issue=upstream,
            relation_type="blocked_by",
        )

    def move(self, issue, new_target):
        old_target = issue.target_date
        Issue.objects.filter(pk=issue.pk).update(target_date=new_target)
        issue.refresh_from_db()
        return auto_shift_dependents(
            issue_id=str(issue.id),
            old_target_date=old_target.isoformat(),
            new_target_date=new_target.isoformat(),
        )


@pytest.fixture
def env(db):
    workspace = WorkspaceFactory(owner=UserFactory(username=f"lock_shift_{uuid4().hex[:8]}"))
    project = ProjectFactory(workspace=workspace, timezone="UTC")
    state = State.objects.create(project=project, name="In Progress", group="started", color="#000")
    return Env(project, state)


def _dates(issue):
    issue.refresh_from_db()
    return issue.start_date, issue.target_date


@pytest.mark.unit
class TestLockedTaskStopsTheChain:
    def test_locked_dependent_does_not_move(self, env):
        survey = env.issue("Site Survey", target=date(2026, 9, 10))
        processing = env.issue(
            "Data Processing", start=date(2026, 9, 11), target=date(2026, 9, 12), locked=True
        )
        env.block(processing, survey)

        summary = env.move(survey, date(2026, 9, 12))

        assert summary == {"shifted": 0, "cyclic": 0}
        assert _dates(processing) == (date(2026, 9, 11), date(2026, 9, 12))

    def test_chain_stops_at_the_locked_task(self, env):
        """A -> B -> C with B locked: A moves, B and C both stay put."""
        a = env.issue("A Survey", target=date(2026, 9, 10))
        b = env.issue("B Processing", start=date(2026, 9, 11), target=date(2026, 9, 12), locked=True)
        c = env.issue("C Report", start=date(2026, 9, 14), target=date(2026, 9, 15))
        env.block(b, a)
        env.block(c, b)

        summary = env.move(a, date(2026, 9, 12))  # +2 working days

        assert summary == {"shifted": 0, "cyclic": 0}
        assert _dates(b) == (date(2026, 9, 11), date(2026, 9, 12))
        # C must NOT pass through: the locked task absorbed the delay.
        assert _dates(c) == (date(2026, 9, 14), date(2026, 9, 15))

    def test_unlocked_chain_still_shifts(self, env):
        """Control: the same graph without a lock propagates as before."""
        a = env.issue("A Survey", target=date(2026, 9, 10))
        b = env.issue("B Processing", start=date(2026, 9, 11), target=date(2026, 9, 12))
        c = env.issue("C Report", start=date(2026, 9, 14), target=date(2026, 9, 15))
        env.block(b, a)
        env.block(c, b)

        summary = env.move(a, date(2026, 9, 12))

        assert summary == {"shifted": 2, "cyclic": 0}
        assert _dates(b) == (date(2026, 9, 14), date(2026, 9, 15))
        assert _dates(c) == (date(2026, 9, 16), date(2026, 9, 17))

    def test_upstream_task_can_still_move(self, env):
        """A downstream lock must not veto the upstream reschedule itself."""
        a = env.issue("A Survey", target=date(2026, 9, 10))
        b = env.issue("B Processing", start=date(2026, 9, 11), target=date(2026, 9, 12), locked=True)
        env.block(b, a)

        env.move(a, date(2026, 9, 12))

        assert _dates(a) == (None, date(2026, 9, 12))

    def test_sibling_branch_still_shifts_when_another_branch_is_locked(self, env):
        """Locking one dependent must not freeze an unrelated dependent."""
        a = env.issue("A Survey", target=date(2026, 9, 10))
        locked = env.issue("B Locked", start=date(2026, 9, 11), target=date(2026, 9, 12), locked=True)
        free = env.issue("B Free", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(locked, a)
        env.block(free, a)

        summary = env.move(a, date(2026, 9, 12))

        assert summary == {"shifted": 1, "cyclic": 0}
        assert _dates(locked) == (date(2026, 9, 11), date(2026, 9, 12))
        assert _dates(free) == (date(2026, 9, 14), date(2026, 9, 15))

    def test_admin_moving_a_locked_task_still_propagates_downstream(self, env):
        """
        The lock stops *propagation into* a locked task. A locked task that an
        admin deliberately reschedules still pushes its own dependents.
        """
        locked = env.issue("Locked anchor", target=date(2026, 9, 10), locked=True)
        downstream = env.issue("Downstream", start=date(2026, 9, 11), target=date(2026, 9, 12))
        env.block(downstream, locked)

        summary = env.move(locked, date(2026, 9, 12))

        assert summary == {"shifted": 1, "cyclic": 0}
        assert _dates(downstream) == (date(2026, 9, 14), date(2026, 9, 15))
