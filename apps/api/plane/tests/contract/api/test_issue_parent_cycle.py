# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for hierarchy-cycle prevention on issue re-parenting.

PATCH /api/workspaces/<slug>/projects/<project_id>/issues/<pk>/

The server must reject any parent assignment that would make a work item
its own ancestor (self-parent, direct cycle, deep cycle), while still
allowing every legitimate re-parent, un-parent, and subtree move — this is
the safety boundary behind the WBS drag-and-drop layer.
"""

import pytest
from rest_framework import status

from plane.db.models import Issue, Project, ProjectMember, State


def _issue_url(slug, project_id, issue_id):
    return f"/api/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/"


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(
        name="Cycle Guard Project",
        identifier="CYC",
        workspace=workspace,
        created_by=create_user,
    )
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=create_user,
        role=20,
        is_active=True,
    )
    return project


@pytest.fixture
def other_project(db, workspace, create_user):
    project = Project.objects.create(
        name="Cycle Guard Other Project",
        identifier="CYCO",
        workspace=workspace,
        created_by=create_user,
    )
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=create_user,
        role=20,
        is_active=True,
    )
    return project


def _make_issue(project, name, parent=None):
    state = State.objects.filter(project=project).first()
    return Issue.objects.create(
        name=name,
        project=project,
        workspace=project.workspace,
        state=state,
        parent=parent,
    )


@pytest.fixture
def chain(project):
    """A -> B -> C (C is the deepest descendant)."""
    a = _make_issue(project, "A")
    b = _make_issue(project, "B", parent=a)
    c = _make_issue(project, "C", parent=b)
    return {"a": a, "b": b, "c": c}


@pytest.mark.contract
class TestIssueParentCycleGuard:
    @pytest.mark.django_db
    def test_self_parent_rejected(self, session_client, workspace, project, chain):
        response = session_client.patch(
            _issue_url(workspace.slug, project.id, chain["a"].id),
            {"parent_id": str(chain["a"].id)},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        chain["a"].refresh_from_db()
        assert chain["a"].parent_id is None

    @pytest.mark.django_db
    def test_direct_cycle_rejected(self, session_client, workspace, project, chain):
        # B is A's child; A -> child of B would be a two-node cycle
        response = session_client.patch(
            _issue_url(workspace.slug, project.id, chain["a"].id),
            {"parent_id": str(chain["b"].id)},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        chain["a"].refresh_from_db()
        assert chain["a"].parent_id is None

    @pytest.mark.django_db
    def test_deep_cycle_rejected(self, session_client, workspace, project, chain):
        # C is A's grandchild; A -> child of C would be a three-node cycle
        response = session_client.patch(
            _issue_url(workspace.slug, project.id, chain["a"].id),
            {"parent_id": str(chain["c"].id)},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        chain["a"].refresh_from_db()
        assert chain["a"].parent_id is None

    @pytest.mark.django_db
    def test_valid_reparent_accepted(self, session_client, workspace, project, chain):
        # moving the deepest node under the root is legal
        response = session_client.patch(
            _issue_url(workspace.slug, project.id, chain["c"].id),
            {"parent_id": str(chain["a"].id)},
            format="json",
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT
        chain["c"].refresh_from_db()
        assert chain["c"].parent_id == chain["a"].id

    @pytest.mark.django_db
    def test_unparent_to_root_accepted(self, session_client, workspace, project, chain):
        response = session_client.patch(
            _issue_url(workspace.slug, project.id, chain["b"].id),
            {"parent_id": None},
            format="json",
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT
        chain["b"].refresh_from_db()
        assert chain["b"].parent_id is None
        # the subtree stays intact: C still hangs under B
        chain["c"].refresh_from_db()
        assert chain["c"].parent_id == chain["b"].id

    @pytest.mark.django_db
    def test_subtree_move_keeps_descendants(self, session_client, workspace, project, chain):
        other_root = _make_issue(project, "QA/QC")
        response = session_client.patch(
            _issue_url(workspace.slug, project.id, chain["b"].id),
            {"parent_id": str(other_root.id)},
            format="json",
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT
        chain["b"].refresh_from_db()
        chain["c"].refresh_from_db()
        assert chain["b"].parent_id == other_root.id
        assert chain["c"].parent_id == chain["b"].id

    @pytest.mark.django_db
    def test_cross_project_parent_rejected(self, session_client, workspace, project, other_project, chain):
        foreign = _make_issue(other_project, "Foreign")
        response = session_client.patch(
            _issue_url(workspace.slug, project.id, chain["c"].id),
            {"parent_id": str(foreign.id)},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        chain["c"].refresh_from_db()
        assert chain["c"].parent_id == chain["b"].id

    @pytest.mark.django_db
    def test_sort_order_reorder_accepted(self, session_client, workspace, project, chain):
        response = session_client.patch(
            _issue_url(workspace.slug, project.id, chain["c"].id),
            {"sort_order": 123.5},
            format="json",
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT
        chain["c"].refresh_from_db()
        assert chain["c"].sort_order == 123.5
