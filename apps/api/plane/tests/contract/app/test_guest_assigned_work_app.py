# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for Geotech3D's guest-assignee rules.

Upstream Plane treats a guest as a spectator: on a container with
``guest_view_all_features=False`` they only see tasks they authored, they are
silently dropped from ``assignee_ids``, and they may not update a task at all.

Geotech3D hands guests real work. A guest may now:

* be set as an assignee,
* see a task assigned to them,
* move that task to another state - and nothing else about it.

Everything outside that scope stays shut: a task that is neither theirs nor
assigned to them stays invisible, and any field other than the state is dropped
from their PATCH.
"""

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    Issue,
    IssueAssignee,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)

LIST_URL = "/api/workspaces/{slug}/projects/{project_id}/issues/list/"
DETAIL_URL = "/api/workspaces/{slug}/projects/{project_id}/issues/{pk}/"
CREATE_URL = "/api/workspaces/{slug}/projects/{project_id}/issues/"


@pytest.fixture
def project(db, workspace, create_user):
    """A container (guest_view_all_features defaults to False); owner is an admin."""
    project = Project.objects.create(
        name="Assigned Work",
        identifier="AW",
        workspace=workspace,
        created_by=create_user,
    )
    ProjectMember.objects.create(project=project, member=create_user, workspace=workspace, role=20)
    return project


@pytest.fixture
def guest(db, workspace, project):
    """An active container GUEST (role=5)."""
    unique_id = uuid4().hex[:8]
    user = User.objects.create(
        email=f"guest-{unique_id}@plane.so",
        username=f"guest_{unique_id}",
        first_name="Guest",
        last_name="User",
    )
    user.set_password("test-password")
    user.save()
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=5)
    ProjectMember.objects.create(project=project, member=user, workspace=workspace, role=5)
    return user


@pytest.fixture
def guest_client(guest):
    client = APIClient()
    client.force_authenticate(user=guest)
    return client


@pytest.fixture
def states(db, workspace, project):
    """Two states to move a task between."""
    todo = State.objects.create(name="Todo", group="unstarted", project=project, workspace=workspace)
    done = State.objects.create(name="Done", group="completed", project=project, workspace=workspace)
    return todo, done


def _make_issue(name, project, workspace, author, state=None):
    """Create a task with a deterministic ``created_by``.

    ``BaseModel.save`` auto-sets ``created_by`` from the current request user
    (None under tests), so a ``created_by=`` kwarg to ``create`` is overwritten.
    Passing ``created_by_id`` to ``save`` sets it explicitly.
    """
    issue = Issue(name=name, project=project, workspace=workspace, state=state)
    issue.save(created_by_id=author.id)
    return issue


@pytest.fixture
def assigned_issue(db, workspace, project, create_user, guest, states):
    """A task authored by the admin and assigned to the guest."""
    todo, _ = states
    issue = _make_issue("Assigned to the guest", project, workspace, create_user, state=todo)
    IssueAssignee.objects.create(issue=issue, assignee=guest, project=project, workspace=workspace)
    return issue


@pytest.fixture
def foreign_issue(db, workspace, project, create_user, states):
    """A task the guest neither authored nor is assigned to."""
    todo, _ = states
    return _make_issue("Nothing to do with the guest", project, workspace, create_user, state=todo)


@pytest.mark.contract
class TestGuestSeesAssignedWork:
    """A guest reads the tasks assigned to them, and only those."""

    @pytest.mark.django_db
    def test_guest_reads_assigned_issue(self, guest_client, workspace, project, assigned_issue, foreign_issue):
        url = LIST_URL.format(slug=workspace.slug, project_id=project.id)
        response = guest_client.get(url, {"issues": f"{assigned_issue.id},{foreign_issue.id}"})

        assert response.status_code == status.HTTP_200_OK, (
            f"Got {response.status_code}: {getattr(response, 'data', None)!r}"
        )
        returned_ids = {str(row["id"]) for row in response.data}
        assert str(assigned_issue.id) in returned_ids
        assert str(foreign_issue.id) not in returned_ids, f"Guest read a foreign task: {response.data!r}"

    @pytest.mark.django_db
    def test_guest_retrieves_assigned_issue(self, guest_client, workspace, project, assigned_issue):
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id, pk=assigned_issue.id)
        response = guest_client.get(url)

        assert response.status_code == status.HTTP_200_OK, (
            f"Got {response.status_code}: {getattr(response, 'data', None)!r}"
        )

    @pytest.mark.django_db
    def test_guest_cannot_retrieve_foreign_issue(self, guest_client, workspace, project, foreign_issue):
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id, pk=foreign_issue.id)
        response = guest_client.get(url)

        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
class TestGuestMovesAssignedWork:
    """A guest may change the state of their task, and nothing else."""

    @pytest.mark.django_db
    def test_guest_changes_state_of_assigned_issue(self, guest_client, workspace, project, assigned_issue, states):
        _, done = states
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id, pk=assigned_issue.id)
        response = guest_client.patch(url, {"state_id": str(done.id)}, format="json")

        assert response.status_code == status.HTTP_204_NO_CONTENT, (
            f"Got {response.status_code}: {getattr(response, 'data', None)!r}"
        )
        assigned_issue.refresh_from_db()
        assert assigned_issue.state_id == done.id

    @pytest.mark.django_db
    def test_guest_cannot_rename_assigned_issue(self, guest_client, workspace, project, assigned_issue, states):
        _, done = states
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id, pk=assigned_issue.id)
        response = guest_client.patch(url, {"state_id": str(done.id), "name": "Renamed by the guest"}, format="json")

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assigned_issue.refresh_from_db()
        assert assigned_issue.state_id == done.id
        assert assigned_issue.name == "Assigned to the guest", "Guest edited a field other than the state"

    @pytest.mark.django_db
    def test_guest_gets_403_when_nothing_is_editable(self, guest_client, workspace, project, assigned_issue):
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id, pk=assigned_issue.id)
        response = guest_client.patch(url, {"priority": "urgent"}, format="json")

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assigned_issue.refresh_from_db()
        assert assigned_issue.priority != "urgent"

    @pytest.mark.django_db
    def test_guest_cannot_touch_foreign_issue(self, guest_client, workspace, project, foreign_issue, states):
        _, done = states
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id, pk=foreign_issue.id)
        response = guest_client.patch(url, {"state_id": str(done.id)}, format="json")

        assert response.status_code == status.HTTP_403_FORBIDDEN
        foreign_issue.refresh_from_db()
        assert foreign_issue.state_id != done.id


@pytest.mark.contract
class TestGuestIsAssignable:
    """A member may hand a guest work in the first place."""

    @pytest.mark.django_db
    def test_member_can_assign_a_guest(self, session_client, workspace, project, guest, states):
        todo, _ = states
        url = CREATE_URL.format(slug=workspace.slug, project_id=project.id)
        response = session_client.post(
            url,
            {"name": "Work for the guest", "state_id": str(todo.id), "assignee_ids": [str(guest.id)]},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED, (
            f"Got {response.status_code}: {getattr(response, 'data', None)!r}"
        )
        assert IssueAssignee.objects.filter(issue_id=response.data["id"], assignee=guest).exists(), (
            "Guest was dropped from assignee_ids"
        )
