# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for "My Space" - a private workspace per person (Phase 1).

See ``plane.utils.personal_project`` for the rules. ``alice`` is a MEMBER of
the company ``workspace`` and owns a My Space; ``create_user``
(``session_client``) is the company workspace owner and ADMIN, who must not be
able to see, join or change it.
"""

from unittest import mock
from uuid import uuid4

import pytest
from django.utils import timezone
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
    Webhook,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
)
from plane.db.models.state import DEFAULT_STATES

ADMIN, MEMBER, GUEST = 20, 15, 5
MY_SPACE_URL = "/api/users/me/my-space/"


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


@pytest.fixture
def my_space(alice_client):
    """``(workspace, project)`` of alice's My Space."""
    response = alice_client.post(MY_SPACE_URL, {}, format="json")
    assert response.status_code == status.HTTP_200_OK
    return (
        Workspace.objects.get(pk=response.data["workspace"]["id"]),
        Project.objects.get(pk=response.data["project"]["id"]),
    )


@pytest.fixture
def team(db, workspace, create_user, alice):
    """A container in the company workspace that both the admin and alice belong to."""
    project = Project.objects.create(name="Team", identifier="TEAM", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, workspace=workspace, role=ADMIN)
    ProjectMember.objects.create(project=project, member=alice, workspace=workspace, role=MEMBER)
    return project


@pytest.mark.contract
class TestOpeningMySpace:
    @pytest.mark.django_db
    def test_first_open_creates_a_private_workspace_with_one_container(self, alice, my_space):
        space, container = my_space
        assert (space.is_personal, space.owner_id, space.name) == (True, alice.id, "My Space")
        assert space.slug == f"my-space-{alice.id.hex}"
        assert list(WorkspaceMember.objects.filter(workspace=space).values_list("member_id", "role")) == [
            (alice.id, ADMIN)
        ]

        assert list(Project.objects.filter(workspace=space)) == [container]
        assert (container.is_personal, container.owner_id, container.identifier, container.network) == (
            True,
            alice.id,
            "MY",
            0,
        )
        features = (container.module_view, container.cycle_view, container.issue_views_view, container.intake_view)
        assert features == (False, False, False, False)
        assert container.page_view is True
        assert list(ProjectMember.objects.filter(project=container).values_list("member_id", "role")) == [
            (alice.id, ADMIN)
        ]
        # ``State.objects`` hides the Triage state, as it does for every container.
        assert State.objects.filter(project=container).count() == len(
            [state for state in DEFAULT_STATES if state["group"] != "triage"]
        )

    @pytest.mark.django_db
    def test_it_is_one_place_whichever_workspace_you_come_from(self, alice, alice_client, my_space):
        other = Workspace.objects.create(name="Other company", slug="other-company", owner=alice)
        WorkspaceMember.objects.create(workspace=other, member=alice, role=MEMBER)

        response = alice_client.post(MY_SPACE_URL, {}, format="json")
        assert response.status_code == status.HTTP_200_OK
        assert response.data["workspace"]["id"] == my_space[0].id
        assert response.data["project"]["id"] == my_space[1].id
        assert Workspace.objects.filter(owner=alice, is_personal=True).count() == 1

    @pytest.mark.django_db
    def test_everyone_gets_their_own(self, session_client, my_space):
        response = session_client.post(MY_SPACE_URL, {}, format="json")
        assert response.status_code == status.HTTP_200_OK
        assert response.data["workspace"]["id"] != my_space[0].id

    @pytest.mark.django_db
    def test_guests_do_not_get_one(self, workspace):
        guest = _user("guest")
        WorkspaceMember.objects.create(workspace=workspace, member=guest, role=GUEST)
        assert _client(guest).post(MY_SPACE_URL, {}, format="json").status_code == status.HTTP_403_FORBIDDEN
        assert not Workspace.objects.filter(is_personal=True).exists()

    @pytest.mark.django_db
    def test_someone_demoted_later_keeps_theirs(self, alice, alice_client, workspace, my_space):
        WorkspaceMember.objects.filter(workspace=workspace, member=alice).update(role=GUEST)
        response = alice_client.post(MY_SPACE_URL, {}, format="json")
        assert response.status_code == status.HTTP_200_OK
        assert response.data["workspace"]["id"] == my_space[0].id

    @pytest.mark.django_db
    def test_opening_restores_the_owners_memberships(self, alice, alice_client, my_space):
        space, container = my_space
        WorkspaceMember.objects.filter(workspace=space, member=alice).update(is_active=False, role=GUEST)
        ProjectMember.objects.filter(project=container, member=alice).update(is_active=False, role=GUEST)

        assert alice_client.post(MY_SPACE_URL, {}, format="json").status_code == status.HTTP_200_OK
        workspace_membership = WorkspaceMember.objects.get(workspace=space, member=alice)
        container_membership = ProjectMember.objects.get(project=container, member=alice)
        assert (workspace_membership.is_active, workspace_membership.role) == (True, ADMIN)
        assert (container_membership.is_active, container_membership.role) == (True, ADMIN)


@pytest.mark.contract
class TestOutsiders:
    @pytest.mark.django_db
    def test_company_admin_cannot_reach_it(self, session_client, my_space):
        space, container = my_space
        base = f"/api/workspaces/{space.slug}"
        assert session_client.get(f"{base}/projects/").status_code == status.HTTP_403_FORBIDDEN
        issues = session_client.get(f"{base}/projects/{container.id}/issues/")
        assert issues.status_code == status.HTTP_403_FORBIDDEN
        renamed = session_client.patch(f"{base}/", {"name": "taken"}, format="json")
        assert renamed.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)
        space.refresh_from_db()
        assert space.name == "My Space"

    @pytest.mark.django_db
    def test_not_in_the_admins_workspace_list(self, session_client, my_space):
        slugs = {row["slug"] for row in session_client.get("/api/users/me/workspaces/").data}
        assert my_space[0].slug not in slugs

    @pytest.mark.django_db
    def test_owner_sees_it_flagged_in_their_workspace_list(self, alice_client, my_space):
        rows = {row["slug"]: row for row in alice_client.get("/api/users/me/workspaces/").data}
        assert rows[my_space[0].slug]["is_personal"] is True

    @pytest.mark.django_db
    def test_hidden_from_the_instance_admin_workspace_list(self, create_user, my_space):
        from plane.license.models import Instance, InstanceAdmin

        instance = Instance.objects.first() or Instance.objects.create(
            instance_name="test",
            instance_id=uuid4().hex,
            current_version="0",
            latest_version="0",
            last_checked_at=timezone.now(),
        )
        InstanceAdmin.objects.get_or_create(instance=instance, user=create_user, defaults={"role": 20})
        response = _client(create_user).get("/api/instances/workspaces/", {"per_page": 10, "cursor": "10:0:0"})
        assert response.status_code == status.HTTP_200_OK, response.data
        assert my_space[0].slug not in {row["slug"] for row in response.data["results"]}


@pytest.mark.contract
class TestFixedShape:
    @pytest.mark.django_db
    def test_nobody_can_be_invited_or_change_membership(self, alice, alice_client, my_space):
        space, _ = my_space
        base = f"/api/workspaces/{space.slug}"
        invited = alice_client.post(
            f"{base}/invitations/", {"emails": [{"email": "x@plane.so", "role": MEMBER}]}, format="json"
        )
        own = WorkspaceMember.objects.get(workspace=space, member=alice)
        changed = alice_client.patch(f"{base}/members/{own.id}/", {"role": MEMBER}, format="json")
        removed = alice_client.delete(f"{base}/members/{own.id}/")
        left = alice_client.post(f"{base}/members/leave/")

        for response in (invited, changed, removed, left):
            assert response.status_code == status.HTTP_400_BAD_REQUEST
            assert response.data["error_code"] == "PERSONAL_PROJECT_LOCKED"
        assert not WorkspaceMemberInvite.objects.filter(workspace=space).exists()
        memberships = WorkspaceMember.objects.filter(workspace=space).values_list("member_id", "role", "is_active")
        assert list(memberships) == [(alice.id, ADMIN, True)]

    @pytest.mark.django_db
    def test_the_workspace_cannot_be_renamed_deleted_or_given_a_second_container(self, alice_client, my_space):
        space, _ = my_space
        base = f"/api/workspaces/{space.slug}"
        assert alice_client.patch(f"{base}/", {"name": "Mine"}, format="json").status_code == 400
        assert alice_client.delete(f"{base}/").status_code == 400
        created = alice_client.post(f"{base}/projects/", {"name": "Second", "identifier": "SEC"}, format="json")
        assert created.status_code == 400
        space.refresh_from_db()
        assert (space.name, space.deleted_at) == ("My Space", None)
        assert Project.objects.filter(workspace=space).count() == 1

    @pytest.mark.django_db
    def test_the_container_cannot_be_shared_published_deleted_or_made_public(self, alice, alice_client, my_space):
        space, container = my_space
        base = f"/api/workspaces/{space.slug}/projects/{container.id}"
        membership = ProjectMember.objects.get(project=container, member=alice)
        new_member = {"members": [{"member_id": str(uuid4()), "role": MEMBER}]}
        responses = [
            alice_client.post(f"{base}/members/", new_member, format="json"),
            alice_client.post(f"{base}/invitations/", {"emails": [{"email": "x@plane.so"}]}, format="json"),
            alice_client.patch(f"{base}/members/{membership.id}/", {"role": MEMBER}, format="json"),
            alice_client.post(f"{base}/members/leave/"),
            alice_client.post(f"{base}/project-deploy-boards/", {}, format="json"),
            alice_client.patch(f"{base}/", {"network": 2}, format="json"),
            alice_client.delete(f"{base}/"),
            alice_client.post(f"{base}/archive/"),
        ]
        assert [response.status_code for response in responses] == [400] * len(responses)
        container.refresh_from_db()
        assert (container.network, container.deleted_at, container.archived_at) == (0, None, None)
        assert not DeployBoard.objects.filter(project=container).exists()

    @pytest.mark.django_db
    def test_the_owner_can_still_use_it(self, alice_client, my_space):
        space, container = my_space
        response = alice_client.post(
            f"/api/workspaces/{space.slug}/projects/{container.id}/issues/", {"name": "note to self"}, format="json"
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert Issue.objects.get(pk=response.data["id"]).sequence_id == 1

    @pytest.mark.django_db
    def test_company_slugs_cannot_take_the_reserved_prefix(self, session_client):
        response = session_client.post(
            "/api/workspaces/", {"name": "Sneaky", "slug": f"my-space-{uuid4().hex}"}, format="json"
        )
        assert response.status_code == status.HTTP_409_CONFLICT
        # ``status`` is "available".
        check = session_client.get("/api/workspace-slug-check/", {"slug": "my-space-anything"})
        assert check.data["status"] is False


@pytest.mark.contract
class TestSealed:
    @pytest.mark.django_db
    def test_no_relation_out_of_my_space(self, alice, alice_client, my_space, team):
        space, container = my_space
        mine = _issue("private note", container, alice)
        sibling = _issue("another private note", container, alice)
        outside = _issue("team task", team, alice)
        response = alice_client.post(
            f"/api/workspaces/{space.slug}/projects/{container.id}/issues/{mine.id}/issue-relation/",
            {"relation_type": "relates_to", "issues": [str(outside.id), str(sibling.id)]},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert list(IssueRelation.objects.values_list("related_issue_id", flat=True)) == [sibling.id]

    @pytest.mark.django_db
    def test_webhooks_never_carry_my_space_events(self, alice, my_space, team):
        from plane.bgtasks import webhook_task

        space, container = my_space
        Webhook.objects.create(workspace=space, url="https://hooks.example.com/mine", issue=True)
        Webhook.objects.create(workspace=team.workspace, url="https://hooks.example.com/team", issue=True)

        def fire(issue):
            webhook_task.webhook_activity(
                event="issue",
                verb="updated",
                field="name",
                old_value=None,
                new_value=issue.name,
                actor_id=alice.id,
                slug=issue.workspace.slug,
                current_site="https://example.com",
                event_id=issue.id,
                old_identifier=None,
                new_identifier=None,
            )

        with mock.patch.object(webhook_task.webhook_send_task, "delay") as send:
            fire(_issue("private", container, alice))
            assert not send.called
            fire(_issue("shared", team, alice))
            assert send.call_count == 1


@pytest.mark.contract
class TestExternalApi:
    @pytest.mark.django_db
    def test_external_api_refuses_to_change_my_space(self, session_client, api_key_client, alice):
        opened = session_client.post(MY_SPACE_URL, {}, format="json").data
        slug, project_id = opened["workspace"]["slug"], opened["project"]["id"]
        base = f"/api/v1/workspaces/{slug}"

        new_member = {"member": str(alice.id), "role": MEMBER}
        responses = [
            api_key_client.post(f"{base}/projects/{project_id}/members/", new_member, format="json"),
            api_key_client.post(f"{base}/projects/", {"name": "Second", "identifier": "SEC"}, format="json"),
            api_key_client.post(f"{base}/invitations/", {"email": "x@plane.so", "role": MEMBER}, format="json"),
            api_key_client.delete(f"{base}/projects/{project_id}/"),
            api_key_client.patch(f"{base}/projects/{project_id}/", {"network": 2}, format="json"),
        ]
        assert [response.status_code for response in responses] == [400] * len(responses)
        assert Project.objects.get(pk=project_id).network == 0
