# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: the intake badge in the project sidebar comes from `intake_count` on
the project list payload.

`ProjectViewSet.list` filters a workspace MEMBER's projects with
``Q(project_projectmember__member=me, is_active=True) | Q(network=2)``. On a
public project the OR leaves that join unconstrained, so the project row repeats
once per member, and an aggregate computed over those rows is multiplied by the
member count. The trailing ``.distinct()`` dedupes rows, not an aggregate that
was already computed, so only ``Count(..., distinct=True)`` fixes it.

An admin never gets that filter, which is why the bug is invisible unless the
test looks at the payload a *member* receives.
"""

from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from plane.db.models import (
    Intake,
    IntakeIssue,
    Issue,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.db.models.intake import IntakeIssueStatus

ADMIN, MEMBER = 20, 15
PUBLIC = 2


@pytest.fixture
def env(db):
    suffix = uuid4().hex[:8]
    owner = User.objects.create(email=f"owner-{suffix}@geo.test", username=f"owner_{suffix}")
    workspace = Workspace.objects.create(name=f"WS {suffix}", owner=owner, slug=f"ws-{suffix}")
    # network=2 is what makes the OR branch match every member row
    project = Project.objects.create(
        name=f"P {suffix}", workspace=workspace, identifier=f"P{suffix[:4].upper()}",
        timezone="UTC", network=PUBLIC,
    )
    state = State.objects.create(
        project=project, workspace=workspace, name="Todo", group="unstarted", color="#888"
    )
    intake = Intake.objects.create(name="Intake", project=project, workspace=workspace, is_default=True)

    people = {}
    # three members, so an inflated count is unmistakably 3x rather than off by one
    for role_name, role in (("admin", ADMIN), ("member", MEMBER), ("second", MEMBER)):
        user = User.objects.create(email=f"{role_name}-{suffix}@geo.test", username=f"{role_name}_{suffix}")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=role, is_active=True)
        ProjectMember.objects.create(
            workspace=workspace, project=project, member=user, role=role, is_active=True
        )
        people[role_name] = user

    # exactly one pending request
    issue = Issue.objects.create(project=project, workspace=workspace, name="Request", state=state)
    IntakeIssue.objects.create(
        intake=intake, issue=issue, project=project, workspace=workspace,
        status=IntakeIssueStatus.PENDING.value,
    )
    return {"workspace": workspace, "project": project, "people": people}


def _intake_count(env, user):
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get(f"/api/workspaces/{env['workspace'].slug}/projects/")
    assert response.status_code == 200
    payload = response.json()
    rows = payload.get("results", payload) if isinstance(payload, dict) else payload
    row = next((r for r in rows if str(r["id"]) == str(env["project"].id)), None)
    assert row is not None, "the project is missing from the list payload"
    return row["intake_count"]


@pytest.mark.unit
class TestProjectIntakeCount:
    def test_admin_sees_the_real_count(self, env):
        assert _intake_count(env, env["people"]["admin"]) == 1

    def test_member_sees_the_same_count_as_an_admin(self, env):
        """The regression: this returned 3 (one pending x three members)."""
        assert _intake_count(env, env["people"]["member"]) == 1

    def test_every_role_agrees(self, env):
        counts = {name: _intake_count(env, user) for name, user in env["people"].items()}
        assert len(set(counts.values())) == 1, f"roles disagree on the badge: {counts}"
