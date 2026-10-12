# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for "Personal Space" (My Space) (Phase 1, backend).

See ``plane.utils.personal_project`` for the rules. There is one shared My
Space workspace; it holds one personal container per person. ``alice`` is a
MEMBER of the company ``workspace`` and owns a My Space; ``create_user``
(``session_client``) is the company owner and ADMIN, who must not be able to
see, join or change alice's container - even after opening their own My Space
and so sharing the My Space workspace with her.
"""

from unittest import mock
from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    DEFAULT_STATES,
    DeployBoard,
    Issue,
    IssueRelation,
    IssueView,
    Project,
    ProjectMember,
    State,
    User,
    Webhook,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
)

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


def _open_my_space(client, workspace):
    return client.post(f"/api/workspaces/{workspace.slug}/my-space/", {}, format="json")


@pytest.fixture
def alice(db, workspace):
    user = _user("alice")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=MEMBER)
    return user


@pytest.fixture
def alice_client(alice):
    return _client(alice)


@pytest.fixture
def my_space(alice_client, workspace):
    """alice's personal container (it lives in the My Space workspace)."""
    response = _open_my_space(alice_client, workspace)
    assert response.status_code == status.HTTP_200_OK
    return Project.objects.select_related("workspace").get(pk=response.data["id"])


@pytest.fixture
def hub(my_space):
    """The shared My Space workspace."""
    return my_space.workspace


@pytest.fixture
def admin_in_hub(session_client, workspace):
    """The company admin opens their own My Space, so they share the hub with alice."""
    assert _open_my_space(session_client, workspace).status_code == status.HTTP_200_OK
    return session_client


@pytest.fixture
def team(db, workspace, create_user, alice):
    """An ordinary container in the company workspace that both the admin and alice belong to."""
    project = Project.objects.create(name="Team", identifier="TEAM", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, workspace=workspace, role=ADMIN)
    ProjectMember.objects.create(project=project, member=alice, workspace=workspace, role=MEMBER)
    return project


@pytest.mark.contract
class TestOpeningMySpace:
    @pytest.mark.django_db
    def test_first_open_sets_up_the_shared_workspace_and_a_private_container(self, alice, workspace, my_space, hub):
        assert (hub.is_my_space, hub.name, hub.slug) == (True, "Personal Space", "my-space")
        assert WorkspaceMember.objects.get(workspace=hub, member=alice).role == MEMBER

        assert (my_space.is_personal, my_space.owner_id, my_space.network) == (True, alice.id, 0)
        assert my_space.name == "Personal Space"
        assert my_space.identifier.startswith("MY")
        # An ordinary container: Jobs, cycles, views and pages on; requests off.
        features = (my_space.module_view, my_space.cycle_view, my_space.issue_views_view, my_space.page_view)
        assert features == (True, True, True, True)
        assert my_space.intake_view is False
        assert list(ProjectMember.objects.filter(project=my_space).values_list("member_id", "role")) == [
            (alice.id, ADMIN)
        ]
        # The same workflow states as any new container.
        states = State.all_state_objects.filter(project=my_space).order_by("sequence")
        assert [state.name for state in states] == [state["name"] for state in DEFAULT_STATES]
        assert states.get(default=True).name == "Backlog"
        # Nothing lands in the company workspace.
        assert not Project.objects.filter(workspace=workspace, is_personal=True).exists()

    @pytest.mark.django_db
    def test_it_is_one_container_whichever_workspace_you_open_it_from(self, alice, alice_client, workspace, my_space):
        dubai = Workspace.objects.create(name="Dubai", slug="dubai", owner=alice)
        WorkspaceMember.objects.create(workspace=dubai, member=alice, role=MEMBER)

        for opened_from in (workspace, dubai):
            response = _open_my_space(alice_client, opened_from)
            assert response.status_code == status.HTTP_200_OK
            assert response.data["id"] == my_space.id
            assert (response.data["workspace_slug"], response.data["workspace_name"]) == ("my-space", "Personal Space")
        assert Project.objects.filter(owner=alice, is_personal=True).count() == 1
        assert Workspace.objects.filter(is_my_space=True).count() == 1

    @pytest.mark.django_db
    def test_everyone_gets_their_own_container_in_the_same_workspace(self, admin_in_hub, create_user, my_space, hub):
        theirs = Project.objects.get(owner=create_user, is_personal=True)
        assert theirs.id != my_space.id
        assert theirs.workspace_id == hub.id
        # Everyone's container has the same name; no colleague's name shows.
        assert theirs.name == my_space.name == "Personal Space"
        # Nobody runs the My Space workspace - the company admin is a MEMBER there.
        assert WorkspaceMember.objects.get(workspace=hub, member=create_user).role == MEMBER

    @pytest.mark.django_db
    def test_guests_do_not_get_one(self, workspace):
        guest = _user("guest")
        WorkspaceMember.objects.create(workspace=workspace, member=guest, role=GUEST)
        assert _open_my_space(_client(guest), workspace).status_code == status.HTTP_403_FORBIDDEN
        assert not Project.objects.filter(is_personal=True).exists()

    @pytest.mark.django_db
    def test_opening_restores_the_owners_memberships(self, alice, alice_client, workspace, my_space, hub):
        WorkspaceMember.objects.filter(workspace=hub, member=alice).update(is_active=False, role=GUEST)
        ProjectMember.objects.filter(project=my_space, member=alice).update(is_active=False, role=GUEST)

        assert _open_my_space(alice_client, workspace).status_code == status.HTTP_200_OK
        hub_membership = WorkspaceMember.objects.get(workspace=hub, member=alice)
        container_membership = ProjectMember.objects.get(project=my_space, member=alice)
        assert (hub_membership.is_active, hub_membership.role) == (True, MEMBER)
        assert (container_membership.is_active, container_membership.role) == (True, ADMIN)


@pytest.mark.contract
class TestLeavingTheCompany:
    @pytest.mark.django_db
    def test_leaving_the_last_company_workspace_closes_it_and_keeps_the_data(
        self, alice, alice_client, workspace, my_space, hub
    ):
        assert alice_client.post(f"/api/workspaces/{workspace.slug}/members/leave/").status_code == 204

        assert WorkspaceMember.objects.get(workspace=hub, member=alice).is_active is False
        assert ProjectMember.objects.get(project=my_space, member=alice).is_active is False
        assert Project.objects.filter(pk=my_space.pk).exists()
        listing = alice_client.get(f"/api/workspaces/{hub.slug}/projects/{my_space.id}/issues/")
        assert listing.status_code == status.HTTP_403_FORBIDDEN

        # Back in the company: opening My Space restores it.
        WorkspaceMember.objects.filter(workspace=workspace, member=alice).update(is_active=True)
        assert _open_my_space(alice_client, workspace).data["id"] == my_space.id
        assert ProjectMember.objects.get(project=my_space, member=alice).is_active is True

    @pytest.mark.django_db
    def test_being_removed_closes_it(self, session_client, alice, workspace, my_space, hub):
        membership = WorkspaceMember.objects.get(workspace=workspace, member=alice)
        assert session_client.delete(f"/api/workspaces/{workspace.slug}/members/{membership.id}/").status_code == 204
        assert WorkspaceMember.objects.get(workspace=hub, member=alice).is_active is False

    @pytest.mark.django_db
    def test_demotion_to_guest_closes_it(self, session_client, alice, workspace, my_space, hub):
        membership = WorkspaceMember.objects.get(workspace=workspace, member=alice)
        response = session_client.patch(
            f"/api/workspaces/{workspace.slug}/members/{membership.id}/", {"role": GUEST}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK
        assert ProjectMember.objects.get(project=my_space, member=alice).is_active is False

    @pytest.mark.django_db
    def test_staying_in_another_company_workspace_keeps_it_open(self, alice, alice_client, workspace, my_space, hub):
        dubai = Workspace.objects.create(name="Dubai", slug="dubai", owner=alice)
        WorkspaceMember.objects.create(workspace=dubai, member=alice, role=MEMBER)
        assert alice_client.post(f"/api/workspaces/{workspace.slug}/members/leave/").status_code == 204
        assert WorkspaceMember.objects.get(workspace=hub, member=alice).is_active is True
        assert ProjectMember.objects.get(project=my_space, member=alice).is_active is True


@pytest.mark.contract
class TestPrivateFromColleagues:
    @pytest.mark.django_db
    def test_not_in_a_colleagues_container_list(self, admin_in_hub, create_user, alice_client, my_space, hub):
        ids = {str(row["id"]) for row in admin_in_hub.get(f"/api/workspaces/{hub.slug}/projects/").data}
        assert str(my_space.id) not in ids
        assert str(Project.objects.get(owner=create_user, is_personal=True).id) in ids

        detail = admin_in_hub.get(f"/api/workspaces/{hub.slug}/projects/details/").data
        assert str(my_space.id) not in {str(row["id"]) for row in detail}

        own = {str(row["id"]): row for row in alice_client.get(f"/api/workspaces/{hub.slug}/projects/").data}
        assert own[str(my_space.id)]["is_personal"] is True

    @pytest.mark.django_db
    def test_a_colleague_cannot_open_edit_delete_archive_or_join_it(self, admin_in_hub, create_user, my_space, hub):
        url = f"/api/workspaces/{hub.slug}/projects/{my_space.id}/"
        assert admin_in_hub.get(url).status_code == status.HTTP_404_NOT_FOUND
        assert admin_in_hub.patch(url, {"name": "taken"}, format="json").status_code == status.HTTP_404_NOT_FOUND
        assert admin_in_hub.delete(url).status_code == status.HTTP_404_NOT_FOUND
        assert admin_in_hub.post(f"{url}archive/").status_code == status.HTTP_403_FORBIDDEN
        assert admin_in_hub.get(f"{url}issues/").status_code == status.HTTP_403_FORBIDDEN
        admin_in_hub.post(
            f"/api/users/me/workspaces/{hub.slug}/projects/invitations/",
            {"project_ids": [str(my_space.id)]},
            format="json",
        )
        assert not ProjectMember.objects.filter(project=my_space, member=create_user).exists()
        my_space.refresh_from_db()
        assert (my_space.deleted_at, my_space.archived_at) == (None, None)

    @pytest.mark.django_db
    def test_saved_views_in_the_my_space_workspace_stay_private(self, admin_in_hub, alice_client, hub):
        created = alice_client.post(
            f"/api/workspaces/{hub.slug}/views/", {"name": "alice's view", "access": 1}, format="json"
        )
        assert created.status_code == status.HTTP_201_CREATED
        listing = admin_in_hub.get(f"/api/workspaces/{hub.slug}/views/").data
        assert "alice's view" not in str(listing)
        assert IssueView.objects.filter(name="alice's view").exists()

    @pytest.mark.django_db
    def test_her_tasks_stay_out_of_the_workspace_wide_routes(self, admin_in_hub, create_user, alice, my_space, hub):
        """The to-do list reads tasks through the My Space workspace's task list; so could a colleague."""
        secret = _issue("alice secret plan", my_space, alice)
        theirs = _issue("admin own note", Project.objects.get(owner=create_user, is_personal=True), create_user)
        base = f"/api/workspaces/{hub.slug}"

        listing = admin_in_hub.get(f"{base}/issues/", {"per_page": 100, "cursor": "100:0:0"})
        assert listing.status_code == status.HTTP_200_OK
        assert str(theirs.id) in str(listing.data) and str(secret.id) not in str(listing.data)
        # Asking for her container by id does not help either.
        filtered = admin_in_hub.get(
            f"{base}/issues/", {"project": str(my_space.id), "per_page": 100, "cursor": "100:0:0"}
        )
        assert str(secret.id) not in str(filtered.data)

        assert "secret" not in str(admin_in_hub.get(f"{base}/search/", {"search": "secret"}).data)
        assert "secret" not in str(admin_in_hub.get(f"{base}/user-issues/{alice.id}/").data)
        by_key = admin_in_hub.get(f"{base}/work-items/{my_space.identifier}-{secret.sequence_id}/")
        assert by_key.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)

    @pytest.mark.django_db
    def test_her_jobs_cycles_pages_and_views_stay_out_of_workspace_wide_routes(
        self, admin_in_hub, alice, alice_client, my_space, hub
    ):
        """Personal Space is an ordinary container, so it holds Jobs, cycles, pages and views too."""
        from plane.db.models import Cycle, Label, Module, Page, ProjectPage

        owned = {"project": my_space, "workspace": hub}
        _issue("zzsecret task", my_space, alice)
        Module.objects.create(name="zzsecret job", **owned)
        Cycle.objects.create(name="zzsecret cycle", owned_by=alice, **owned)
        IssueView.objects.create(name="zzsecret view", owned_by=alice, **owned)
        Label.objects.create(name="zzsecret label", **owned)
        page = Page.objects.create(name="zzsecret page", workspace=hub, owned_by=alice, access=0)
        ProjectPage.objects.create(project=my_space, page=page, workspace=hub)

        base = f"/api/workspaces/{hub.slug}"
        routes = [
            ("search/", {"search": "zzsecret"}),
            ("search/", {"search": "zzsecret", "workspace_search": "true"}),
            ("entity-search/", {"query": "zzsecret", "query_type": "issue,cycle,module,page,project"}),
            ("issues/", {"per_page": 100, "cursor": "100:0:0"}),
            ("modules/", {}),
            ("cycles/", {}),
            ("labels/", {}),
            ("states/", {}),
            ("estimates/", {}),
            ("views/", {}),
            ("workspace-views/", {}),
            ("project-stats/", {}),
            ("project-members/", {}),
            ("analytics/", {"x_axis": "labels__id", "y_axis": "issue_count"}),
            ("default-analytics/", {}),
            ("recent-visits/", {}),
            ("user-favorites/", {}),
            ("dependency-schedules/", {}),
            ("due-date-change-requests/", {}),
            (f"user-issues/{alice.id}/", {}),
        ]
        leaks = []
        for route, params in routes:
            response = admin_in_hub.get(f"{base}/{route}", params)
            if response.status_code >= 500 or b"zzsecret" in response.content:
                leaks.append((route, response.status_code))
        assert leaks == []
        # The probe can see a leak: the owner finds all of it.
        own = alice_client.get(f"{base}/search/", {"search": "zzsecret"}).content
        for name in (b"zzsecret task", b"zzsecret job", b"zzsecret cycle", b"zzsecret page", b"zzsecret view"):
            assert name in own


@pytest.mark.contract
class TestTheMySpaceWorkspaceIsLocked:
    @pytest.mark.django_db
    def test_no_invites_member_changes_or_leaving(self, alice, alice_client, hub):
        base = f"/api/workspaces/{hub.slug}"
        own = WorkspaceMember.objects.get(workspace=hub, member=alice)
        responses = [
            alice_client.post(
                f"{base}/invitations/", {"emails": [{"email": "x@plane.so", "role": MEMBER}]}, format="json"
            ),
            alice_client.patch(f"{base}/members/{own.id}/", {"role": ADMIN}, format="json"),
            alice_client.delete(f"{base}/members/{own.id}/"),
            alice_client.post(f"{base}/members/leave/"),
        ]
        # The member endpoints need a workspace admin and the My Space
        # workspace has none, so those two are refused before reaching the lock.
        assert [response.status_code for response in responses] == [400, 403, 403, 400]
        assert not WorkspaceMemberInvite.objects.filter(workspace=hub).exists()
        assert WorkspaceMember.objects.get(workspace=hub, member=alice).role == MEMBER

    @pytest.mark.django_db
    def test_lock_holds_even_for_a_workspace_admin(self, alice, alice_client, hub):
        # Belt and braces: should anyone ever be made an admin of it.
        WorkspaceMember.objects.filter(workspace=hub, member=alice).update(role=ADMIN)
        base = f"/api/workspaces/{hub.slug}"
        own = WorkspaceMember.objects.get(workspace=hub, member=alice)
        responses = [
            alice_client.post(
                f"{base}/invitations/", {"emails": [{"email": "x@plane.so", "role": MEMBER}]}, format="json"
            ),
            alice_client.patch(f"{base}/members/{own.id}/", {"role": MEMBER}, format="json"),
            alice_client.patch(f"{base}/", {"name": "Mine"}, format="json"),
            alice_client.delete(f"{base}/"),
            alice_client.post(f"{base}/projects/", {"name": "Second", "identifier": "SEC"}, format="json"),
        ]
        assert [response.status_code for response in responses] == [400] * len(responses)
        hub.refresh_from_db()
        assert (hub.name, hub.deleted_at) == ("Personal Space", None)
        assert Project.objects.filter(workspace=hub, is_personal=False).count() == 0

    @pytest.mark.django_db
    def test_company_slugs_cannot_take_my_space(self, session_client):
        response = session_client.post("/api/workspaces/", {"name": "Sneaky", "slug": "my-space"}, format="json")
        assert response.status_code == status.HTTP_409_CONFLICT
        check = session_client.get("/api/workspace-slug-check/", {"slug": "my-space"})
        # ``status`` is "available".
        assert check.data["status"] is False


@pytest.mark.contract
class TestTheContainerIsLocked:
    @pytest.mark.django_db
    def test_it_cannot_be_shared_published_deleted_or_made_public(self, alice, alice_client, my_space, hub):
        base = f"/api/workspaces/{hub.slug}/projects/{my_space.id}"
        membership = ProjectMember.objects.get(project=my_space, member=alice)
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
        my_space.refresh_from_db()
        assert (my_space.network, my_space.deleted_at, my_space.archived_at) == (0, None, None)
        assert not DeployBoard.objects.filter(project=my_space).exists()

    @pytest.mark.django_db
    def test_the_owner_can_use_it(self, alice, alice_client, my_space, hub):
        response = alice_client.post(
            f"/api/workspaces/{hub.slug}/projects/{my_space.id}/issues/", {"name": "note to self"}, format="json"
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert Issue.objects.get(pk=response.data["id"]).sequence_id == 1
        # Nobody assigned: the task is the owner's.
        assert response.data["assignee_ids"] == [alice.id]
        unassigned = alice_client.post(
            f"/api/workspaces/{hub.slug}/projects/{my_space.id}/issues/",
            {"name": "another note", "assignee_ids": []},
            format="json",
        )
        assert unassigned.data["assignee_ids"] == [alice.id]
        renamed = alice_client.patch(
            f"/api/workspaces/{hub.slug}/projects/{my_space.id}/", {"name": "Scratchpad"}, format="json"
        )
        assert renamed.status_code == status.HTTP_200_OK


@pytest.mark.contract
class TestSealed:
    @pytest.mark.django_db
    def test_no_relation_out_of_my_space(self, alice, alice_client, my_space, hub, team):
        mine = _issue("private note", my_space, alice)
        sibling = _issue("another private note", my_space, alice)
        outside = _issue("team task", team, alice)
        response = alice_client.post(
            f"/api/workspaces/{hub.slug}/projects/{my_space.id}/issues/{mine.id}/issue-relation/",
            {"relation_type": "relates_to", "issues": [str(outside.id), str(sibling.id)]},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert list(IssueRelation.objects.values_list("related_issue_id", flat=True)) == [sibling.id]

    @pytest.mark.django_db
    def test_webhooks_never_carry_my_space_events(self, alice, workspace, my_space, team):
        from plane.bgtasks import webhook_task

        Webhook.objects.create(workspace=workspace, url="https://hooks.example.com/team", issue=True)
        Webhook.objects.create(workspace=my_space.workspace, url="https://hooks.example.com/hub", issue=True)

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
            fire(_issue("private", my_space, alice))
            assert not send.called
            fire(_issue("shared", team, alice))
            assert send.call_count == 1


@pytest.mark.contract
class TestExternalApi:
    @pytest.mark.django_db
    def test_external_api_refuses_to_change_my_space(self, session_client, api_key_client, workspace, alice):
        opened = _open_my_space(session_client, workspace).data
        base = f"/api/v1/workspaces/{opened['workspace_slug']}"
        project_id = opened["id"]

        new_member = {"member": str(alice.id), "role": MEMBER}
        responses = [
            api_key_client.post(f"{base}/projects/{project_id}/members/", new_member, format="json"),
            api_key_client.post(f"{base}/projects/", {"name": "Second", "identifier": "SEC"}, format="json"),
            api_key_client.delete(f"{base}/projects/{project_id}/"),
            api_key_client.patch(f"{base}/projects/{project_id}/", {"network": 2}, format="json"),
        ]
        assert [response.status_code for response in responses] == [400] * len(responses)
        assert Project.objects.get(pk=project_id).network == 0


@pytest.mark.contract
class TestNeverTheLandingWorkspace:
    @pytest.mark.django_db
    def test_sign_in_lands_in_a_company_workspace(self, alice, workspace, hub):
        from plane.db.models import Profile

        from plane.app.serializers import UserMeSettingsSerializer

        # Created at sign-up in the app; the test user has none yet.
        Profile.objects.get_or_create(user=alice)
        Profile.objects.filter(user=alice).update(last_workspace_id=hub.id)
        settings = UserMeSettingsSerializer(alice).data["workspace"]
        assert settings["last_workspace_slug"] is None
        assert settings["fallback_workspace_slug"] == workspace.slug

        from plane.authentication.utils.redirection_path import get_redirection_path

        Profile.objects.filter(user=alice).update(is_onboarded=True)
        assert get_redirection_path(alice) == workspace.slug
