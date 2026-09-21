# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: who may accept or decline a Request (intake issue).

The rule the user asked for: a project admin, or whoever the Request was
assigned to — assigning it is the act that grants the say, so the assignee's
project role is deliberately not consulted and a guest assignee qualifies.

Three separate gates decide this and all three have to agree, which is why the
tests assert the stored status rather than the response code: before this
change a member's PATCH returned 200 while the status quietly stayed PENDING.
"""

from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from plane.db.models import (
    Intake,
    IntakeIssue,
    Issue,
    IssueAssignee,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.db.models.intake import IntakeIssueStatus

ADMIN, MEMBER, GUEST = 20, 15, 5


@pytest.fixture
def env(db):
    suffix = uuid4().hex[:8]
    owner = User.objects.create(email=f"owner-{suffix}@geo.test", username=f"owner_{suffix}")
    workspace = Workspace.objects.create(name=f"WS {suffix}", owner=owner, slug=f"ws-{suffix}")
    project = Project.objects.create(
        name=f"P {suffix}", workspace=workspace, identifier=f"P{suffix[:4].upper()}", timezone="UTC"
    )
    state = State.objects.create(
        project=project, workspace=workspace, name="Todo", group="unstarted", color="#888"
    )
    intake = Intake.objects.create(name="Intake", project=project, workspace=workspace, is_default=True)

    people = {}
    for name, role in (("admin", ADMIN), ("member", MEMBER), ("bystander", MEMBER), ("guest", GUEST)):
        user = User.objects.create(email=f"{name}-{suffix}@geo.test", username=f"{name}_{suffix}")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=role, is_active=True)
        ProjectMember.objects.create(
            workspace=workspace, project=project, member=user, role=role, is_active=True
        )
        people[name] = user

    return {"workspace": workspace, "project": project, "intake": intake, "state": state, "people": people}


def _request(env, *, raised_by, assigned_to=None):
    issue = Issue.objects.create(
        project=env["project"], workspace=env["workspace"], name="Request", state=env["state"]
    )
    Issue.objects.filter(pk=issue.pk).update(created_by=raised_by)
    intake_issue = IntakeIssue.objects.create(
        intake=env["intake"], issue=issue, project=env["project"], workspace=env["workspace"],
        status=IntakeIssueStatus.PENDING.value, created_by=raised_by,
    )
    if assigned_to is not None:
        IssueAssignee.objects.create(
            issue=issue, assignee=assigned_to, project=env["project"], workspace=env["workspace"]
        )
    return issue, intake_issue


def _accepted(env, actor, issue, intake_issue):
    """Did the accept actually stick? A 200 alone proves nothing here."""
    client = APIClient()
    client.force_authenticate(user=actor)
    client.patch(
        f"/api/workspaces/{env['workspace'].slug}/projects/{env['project'].id}/intake-issues/{issue.id}/",
        {"status": IntakeIssueStatus.ACCEPTED.value},
        format="json",
    )
    intake_issue.refresh_from_db()
    return intake_issue.status == IntakeIssueStatus.ACCEPTED.value


@pytest.mark.unit
class TestIntakeReviewPermission:
    def test_project_admin_may_accept(self, env):
        issue, ii = _request(env, raised_by=env["people"]["member"])
        assert _accepted(env, env["people"]["admin"], issue, ii) is True

    def test_assignee_may_accept(self, env):
        issue, ii = _request(env, raised_by=env["people"]["admin"], assigned_to=env["people"]["member"])
        assert _accepted(env, env["people"]["member"], issue, ii) is True

    def test_guest_assignee_may_accept(self, env):
        """Assigning it is what grants the say, so role is not consulted."""
        issue, ii = _request(env, raised_by=env["people"]["admin"], assigned_to=env["people"]["guest"])
        assert _accepted(env, env["people"]["guest"], issue, ii) is True

    def test_admin_still_may_accept_one_assigned_to_someone_else(self, env):
        issue, ii = _request(env, raised_by=env["people"]["member"], assigned_to=env["people"]["member"])
        assert _accepted(env, env["people"]["admin"], issue, ii) is True

    def test_uninvolved_member_may_not_accept(self, env):
        issue, ii = _request(env, raised_by=env["people"]["admin"])
        assert _accepted(env, env["people"]["bystander"], issue, ii) is False

    def test_member_assigned_elsewhere_may_not_accept(self, env):
        issue, ii = _request(env, raised_by=env["people"]["admin"], assigned_to=env["people"]["member"])
        assert _accepted(env, env["people"]["bystander"], issue, ii) is False

    def test_raising_a_request_does_not_let_you_accept_it(self, env):
        """The creator reaches the endpoint, but must not decide their own."""
        issue, ii = _request(env, raised_by=env["people"]["member"])
        assert _accepted(env, env["people"]["member"], issue, ii) is False

    def test_plain_guest_may_not_accept(self, env):
        issue, ii = _request(env, raised_by=env["people"]["admin"])
        assert _accepted(env, env["people"]["guest"], issue, ii) is False
