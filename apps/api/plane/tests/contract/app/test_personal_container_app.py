# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for "My Space", the personal container (Phase 1, backend).

See ``plane.utils.personal_project`` for the rules. ``alice`` is a workspace
MEMBER who owns a My Space; ``create_user`` (``session_client``) is the
workspace owner and ADMIN, who must not be able to see, join, edit or reach
into it.
"""

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    DeployBoard,
    Issue,
    IssueRelation,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)
from plane.db.models.state import DEFAULT_STATES

ADMIN, MEMBER, GUEST = 20, 15, 5


def _user(prefix):
    unique_id = uuid4().hex[:8]
    user = User.objects.create(
        email=f"{prefix}-{unique_id}@plane.so", username=f"{prefix}_{unique_id}", display_name=prefix
    )
    user.set_password("test-password")
    user.save()
    return user


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _issue(name, project, author):
    issue = Issue(name=name, project=project, workspace=project.workspace)
    issue.save(created_by_id=author.id)
    return issue


@pytest.fixture
def alice(db, workspace):
    user = _user("alice")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=MEMBER)
    return user


@pytest.fixture
def alice_client(alice):
    return _client(alice)


def _open_my_space(client, workspace):
    return client.post(f"/api/workspaces/{workspace.slug}/my-space/", {}, format="json")


@pytest.fixture
def my_space(alice_client, workspace):
    response = _open_my_space(alice_client, workspace)
    assert response.status_code == status.HTTP_200_OK
    return Project.objects.get(pk=response.data["id"])


@pytest.fixture
def team(db, workspace, create_user, alice):
    """An ordinary container both the admin and alice belong to."""
    project = Project.objects.create(name="Team", identifier="TEAM", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, workspace=workspace, role=ADMIN)
    ProjectMember.objects.create(project=project, member=alice, workspace=workspace, role=MEMBER)
    return project


@pytest.mark.contract
class TestOpeningMySpace:
    @pytest.mark.django_db
    def test_first_open_creates_a_private_tasks_and_pages_container(self, alice, my_space):
        assert my_space.is_personal is True
        assert my_space.owner_id == alice.id
        assert my_space.network == 0
        assert my_space.identifier.startswith("MY")
        assert (my_space.module_view, my_space.cycle_view, my_space.issue_views_view, my_space.intake_view) == (
            False,
            False,
            False,
            False,
        )
        assert my_space.page_view is True
        assert list(ProjectMember.objects.filter(project=my_space).values_list("member_id", "role")) == [
            (alice.id, ADMIN)
        ]
        # ``State.objects`` hides the Triage state, as it does for every container.
        assert State.objects.filter(project=my_space).count() == len(
            [state for state in DEFAULT_STATES if state["group"] != "triage"]
        )

    @pytest.mark.django_db
    def test_opening_again_returns_the_same_container(self, alice_client, workspace, my_space):
        response = _open_my_space(alice_client, workspace)
        assert response.status_code == status.HTTP_200_OK
        assert response.data["id"] == my_space.id
        assert response.data["is_personal"] is True
        assert Project.objects.filter(workspace=workspace, is_personal=True).count() == 1

    @pytest.mark.django_db
    def test_everyone_gets_their_own(self, session_client, workspace, my_space):
        response = _open_my_space(session_client, workspace)
        assert response.status_code == status.HTTP_200_OK
        assert response.data["id"] != my_space.id

    @pytest.mark.django_db
    def test_guests_do_not_get_one(self, workspace):
        guest = _user("guest")
        WorkspaceMember.objects.create(workspace=workspace, member=guest, role=GUEST)
        assert _open_my_space(_client(guest), workspace).status_code == status.HTTP_403_FORBIDDEN
        assert not Project.objects.filter(is_personal=True).exists()

    @pytest.mark.django_db
    def test_opening_restores_a_deactivated_membership(self, alice, alice_client, workspace, my_space):
        ProjectMember.objects.filter(project=my_space, member=alice).update(is_active=False, role=GUEST)
        assert _open_my_space(alice_client, workspace).status_code == status.HTTP_200_OK
        membership = ProjectMember.objects.get(project=my_space, member=alice)
        assert (membership.is_active, membership.role) == (True, ADMIN)


@pytest.mark.contract
class TestHiddenFromEveryoneElse:
    @pytest.mark.django_db
    def test_not_in_the_admins_container_list(self, session_client, alice_client, workspace, my_space, team):
        ids = {str(row["id"]) for row in session_client.get(f"/api/workspaces/{workspace.slug}/projects/").data}
        assert str(my_space.id) not in ids
        assert str(team.id) in ids

        detail = session_client.get(f"/api/workspaces/{workspace.slug}/projects/details/").data
        assert str(my_space.id) not in {str(row["id"]) for row in detail}

        own = {
            str(row["id"]): row for row in alice_client.get(f"/api/workspaces/{workspace.slug}/projects/").data
        }
        assert own[str(my_space.id)]["is_personal"] is True

    @pytest.mark.django_db
    def test_admin_cannot_open_edit_delete_or_archive_it(self, session_client, workspace, my_space):
        url = f"/api/workspaces/{workspace.slug}/projects/{my_space.id}/"
        assert session_client.get(url).status_code == status.HTTP_404_NOT_FOUND
        assert session_client.patch(url, {"name": "taken"}, format="json").status_code == status.HTTP_404_NOT_FOUND
        assert session_client.delete(url).status_code == status.HTTP_404_NOT_FOUND
        assert session_client.post(f"{url}archive/").status_code == status.HTTP_403_FORBIDDEN
        my_space.refresh_from_db()
        assert my_space.deleted_at is None and my_space.archived_at is None
        assert my_space.name.startswith("My Space")

    @pytest.mark.django_db
    def test_admin_cannot_join_it(self, session_client, create_user, workspace, my_space):
        response = session_client.post(
            f"/api/users/me/workspaces/{workspace.slug}/projects/invitations/",
            {"project_ids": [str(my_space.id)]},
            format="json",
        )
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED)
        assert not ProjectMember.objects.filter(project=my_space, member=create_user).exists()


@pytest.mark.contract
class TestOnlyTheOwnerIsAMember:
    @pytest.mark.django_db
    def test_members_cannot_be_added_invited_or_changed(self, alice, alice_client, create_user, workspace, my_space):
        base = f"/api/workspaces/{workspace.slug}/projects/{my_space.id}"
        added = alice_client.post(
            f"{base}/members/", {"members": [{"member_id": str(create_user.id), "role": MEMBER}]}, format="json"
        )
        invited = alice_client.post(f"{base}/invitations/", {"emails": [{"email": "x@plane.so"}]}, format="json")
        membership = ProjectMember.objects.get(project=my_space, member=alice)
        changed = alice_client.patch(f"{base}/members/{membership.id}/", {"role": MEMBER}, format="json")
        left = alice_client.post(f"{base}/members/leave/")

        for response in (added, invited, changed, left):
            assert response.status_code == status.HTTP_400_BAD_REQUEST
            assert response.data["error_code"] == "PERSONAL_PROJECT_LOCKED"
        assert list(ProjectMember.objects.filter(project=my_space).values_list("member_id", "role", "is_active")) == [
            (alice.id, ADMIN, True)
        ]


@pytest.mark.contract
class TestOwnerLimits:
    @pytest.mark.django_db
    def test_owner_can_rename_but_not_make_it_public(self, alice_client, workspace, my_space):
        url = f"/api/workspaces/{workspace.slug}/projects/{my_space.id}/"
        assert alice_client.patch(url, {"name": "Scratchpad"}, format="json").status_code == status.HTTP_200_OK
        assert alice_client.patch(url, {"network": 2}, format="json").status_code == status.HTTP_400_BAD_REQUEST
        assert (
            alice_client.patch(url, {"is_personal": False, "owner": None}, format="json").status_code
            == status.HTTP_200_OK
        )
        my_space.refresh_from_db()
        assert (my_space.name, my_space.network, my_space.is_personal) == ("Scratchpad", 0, True)
        assert my_space.owner_id is not None

    @pytest.mark.django_db
    def test_owner_cannot_delete_archive_or_publish_it(self, alice_client, workspace, my_space):
        base = f"/api/workspaces/{workspace.slug}/projects/{my_space.id}"
        assert alice_client.delete(f"{base}/").status_code == status.HTTP_400_BAD_REQUEST
        assert alice_client.post(f"{base}/archive/").status_code == status.HTTP_400_BAD_REQUEST
        assert (
            alice_client.post(f"{base}/project-deploy-boards/", {}, format="json").status_code
            == status.HTTP_400_BAD_REQUEST
        )
        my_space.refresh_from_db()
        assert my_space.deleted_at is None and my_space.archived_at is None
        assert not DeployBoard.objects.filter(project=my_space).exists()


@pytest.mark.contract
class TestSealedFromOtherContainers:
    @pytest.mark.django_db
    def test_no_relation_out_of_my_space(self, alice, alice_client, workspace, my_space, team):
        mine = _issue("private note", my_space, alice)
        sibling = _issue("another private note", my_space, alice)
        outside = _issue("team task", team, alice)
        response = alice_client.post(
            f"/api/workspaces/{workspace.slug}/projects/{my_space.id}/issues/{mine.id}/issue-relation/",
            {"relation_type": "relates_to", "issues": [str(outside.id), str(sibling.id)]},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert list(IssueRelation.objects.values_list("related_issue_id", flat=True)) == [sibling.id]

    @pytest.mark.django_db
    def test_no_relation_into_my_space(self, alice, alice_client, workspace, my_space, team):
        mine = _issue("private note", my_space, alice)
        outside = _issue("team task", team, alice)
        response = alice_client.post(
            f"/api/workspaces/{workspace.slug}/projects/{team.id}/issues/{outside.id}/issue-relation/",
            {"relation_type": "blocked_by", "issues": [str(mine.id)]},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert not IssueRelation.objects.exists()

    @pytest.mark.django_db
    def test_webhook_activity_sends_team_events_only(self, alice, workspace, my_space, team):
        from unittest import mock

        from plane.bgtasks import webhook_task
        from plane.db.models import Webhook

        Webhook.objects.create(workspace=workspace, url="https://hooks.example.com/plane", issue=True)
        private = _issue("private", my_space, alice)
        shared = _issue("shared", team, alice)

        def fire(issue):
            webhook_task.webhook_activity(
                event="issue",
                verb="updated",
                field="name",
                old_value=None,
                new_value=issue.name,
                actor_id=alice.id,
                slug=workspace.slug,
                current_site="https://example.com",
                event_id=issue.id,
                old_identifier=None,
                new_identifier=None,
            )

        with mock.patch.object(webhook_task.webhook_send_task, "delay") as send:
            fire(private)
            assert not send.called
            fire(shared)
            assert send.call_count == 1

    @pytest.mark.django_db
    def test_webhooks_skip_my_space_events(self, alice, my_space, team):
        from plane.bgtasks.webhook_task import _is_personal_project_event

        assert _is_personal_project_event("project", my_space.id) is True
        assert _is_personal_project_event("issue", _issue("private", my_space, alice).id) is True
        assert _is_personal_project_event("project", team.id) is False
        assert _is_personal_project_event("issue", _issue("shared", team, alice).id) is False


@pytest.mark.contract
class TestWorkspaceMembership:
    @pytest.mark.django_db
    def test_demotion_to_guest_closes_my_space_but_keeps_it(
        self, session_client, alice, alice_client, workspace, my_space, team
    ):
        workspace_member = WorkspaceMember.objects.get(workspace=workspace, member=alice)
        response = session_client.patch(
            f"/api/workspaces/{workspace.slug}/members/{workspace_member.id}/", {"role": GUEST}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK

        personal = ProjectMember.objects.get(project=my_space, member=alice)
        assert personal.is_active is False
        assert ProjectMember.objects.get(project=team, member=alice).role == GUEST
        assert Project.objects.filter(pk=my_space.pk).exists()
        assert _open_my_space(alice_client, workspace).status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_my_space_does_not_block_leaving_the_workspace(self, alice, alice_client, workspace, my_space):
        response = alice_client.post(f"/api/workspaces/{workspace.slug}/members/leave/")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert ProjectMember.objects.get(project=my_space, member=alice).is_active is False


@pytest.mark.contract
class TestExternalApi:
    @pytest.mark.django_db
    def test_member_endpoints_refuse_my_space(self, session_client, api_key_client, create_user, workspace, alice):
        my_space_id = _open_my_space(session_client, workspace).data["id"]
        base = f"/api/v1/workspaces/{workspace.slug}/projects/{my_space_id}"

        response = api_key_client.post(f"{base}/members/", {"member": str(alice.id), "role": MEMBER}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not ProjectMember.objects.filter(project_id=my_space_id, member=alice).exists()

        assert api_key_client.delete(f"{base}/").status_code == status.HTTP_400_BAD_REQUEST
        assert (
            api_key_client.patch(f"{base}/", {"network": 2}, format="json").status_code
            == status.HTTP_400_BAD_REQUEST
        )
        assert Project.objects.get(pk=my_space_id).network == 0
