# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests: a container's data stays with its active members.

Geotech3D Phase 0 of the personal-container work. An audit found endpoints that
returned a Secret container's data to people outside it - including workspace
admins, who get no bypass on per-container endpoints. These tests pin the shared
rule from ``plane.utils.project_access``: a user reads a container's data only
while an active member of it.

The caller throughout is ``create_user``: the workspace owner and ADMIN, an
active member of ``mine`` and NOT a member of ``secret`` (a Secret container
owned by someone else). That is the strongest case - an admin who has not
joined the container.
"""

from datetime import timedelta
from unittest import mock
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    Cycle,
    CycleIssue,
    DeployBoard,
    DraftIssue,
    Estimate,
    ExporterHistory,
    FileAsset,
    Issue,
    IssueAssignee,
    IssueRelation,
    Label,
    Project,
    ProjectMember,
    User,
    WorkspaceMember,
)

ADMIN, MEMBER = 20, 15


def _user(prefix):
    unique_id = uuid4().hex[:8]
    user = User.objects.create(email=f"{prefix}-{unique_id}@plane.so", username=f"{prefix}_{unique_id}")
    user.set_password("test-password")
    user.save()
    return user


def _issue(name, project, author):
    # ``BaseModel.save`` overwrites ``created_by`` from the request user, so
    # pass it to ``save`` explicitly (see test_sub_issue_cross_project_scope_app).
    issue = Issue(name=name, project=project, workspace=project.workspace)
    issue.save(created_by_id=author.id)
    return issue


@pytest.fixture
def owner(db, workspace):
    """Another workspace member; owns the Secret container."""
    user = _user("owner")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=MEMBER)
    return user


@pytest.fixture
def mine(db, workspace, create_user):
    project = Project.objects.create(name="Mine", identifier="MINE", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, workspace=workspace, role=ADMIN)
    return project


@pytest.fixture
def secret(db, workspace, owner):
    project = Project.objects.create(
        name="Secret", identifier="SEC", workspace=workspace, network=0, created_by=owner
    )
    ProjectMember.objects.create(project=project, member=owner, workspace=workspace, role=ADMIN)
    return project


@pytest.fixture
def my_issue(db, mine, create_user):
    return _issue("my task", mine, create_user)


@pytest.fixture
def secret_issue(db, secret, owner):
    return _issue("secret task title", secret, owner)


@pytest.fixture
def stranger_client(db):
    """A logged-in user who belongs to no workspace at all."""
    client = APIClient()
    client.force_authenticate(user=_user("stranger"))
    return client


@pytest.mark.contract
class TestAnalyticsScope:
    @pytest.mark.django_db
    def test_analytics_counts_only_member_containers(self, session_client, workspace, my_issue, secret_issue):
        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/analytics/", {"x_axis": "priority", "y_axis": "issue_count"}
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["total"] == 1

    @pytest.mark.django_db
    def test_default_analytics_counts_only_member_containers(self, session_client, workspace, my_issue, secret_issue):
        response = session_client.get(f"/api/workspaces/{workspace.slug}/default-analytics/")
        assert response.status_code == status.HTTP_200_OK
        assert response.data["total_issues"] == 1

    @pytest.mark.django_db
    def test_project_stats_skips_non_member_containers(self, session_client, workspace, mine, secret):
        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/project-stats/", {"project_ids": f"{mine.id},{secret.id}"}
        )
        assert response.status_code == status.HTTP_200_OK
        assert {str(row["id"]) for row in response.data} == {str(mine.id)}

    @pytest.mark.django_db
    def test_analytics_export_task_scopes_to_requester(self, workspace, create_user, my_issue, secret_issue):
        from plane.bgtasks import analytic_plot_export

        seen = {}

        def capture(queryset, **kwargs):
            seen["ids"] = set(queryset.values_list("id", flat=True))
            return {}

        with (
            mock.patch.object(analytic_plot_export, "build_graph_plot", side_effect=capture),
            mock.patch.object(analytic_plot_export, "send_export_email") as send,
        ):
            analytic_plot_export.analytic_export_task(
                email=create_user.email,
                data={"x_axis": "priority", "y_axis": "issue_count"},
                slug=workspace.slug,
                user_id=str(create_user.id),
            )
        assert seen["ids"] == {my_issue.id}
        assert send.called

    @pytest.mark.django_db
    def test_analytics_export_task_without_requester_sends_nothing(self, workspace, secret_issue):
        from plane.bgtasks import analytic_plot_export

        with mock.patch.object(analytic_plot_export, "send_export_email") as send:
            analytic_plot_export.analytic_export_task(
                email="nobody@plane.so", data={"x_axis": "priority", "y_axis": "issue_count"}, slug=workspace.slug
            )
        assert not send.called


@pytest.mark.contract
class TestPublishScope:
    @pytest.mark.django_db
    def test_non_member_cannot_publish(self, session_client, workspace, secret):
        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/projects/{secret.id}/project-deploy-boards/", {}, format="json"
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not DeployBoard.objects.filter(project=secret).exists()

    @pytest.mark.django_db
    def test_member_can_publish(self, session_client, workspace, mine):
        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/projects/{mine.id}/project-deploy-boards/", {}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK

    @pytest.mark.django_db
    def test_board_of_another_container_unreachable_by_id(self, session_client, workspace, mine, secret):
        board = DeployBoard.objects.create(
            entity_name="project", entity_identifier=secret.id, project=secret, workspace=workspace
        )
        url = f"/api/workspaces/{workspace.slug}/projects/{mine.id}/project-deploy-boards/{board.id}/"
        assert session_client.patch(url, {"is_comments_enabled": True}, format="json").status_code == 404
        assert session_client.delete(url).status_code == 404
        assert DeployBoard.objects.filter(pk=board.id).exists()


@pytest.mark.contract
class TestWorkspaceLevelReads:
    @pytest.mark.django_db
    def test_estimates_only_from_member_containers(self, session_client, workspace, mine, secret):
        mine_estimate = Estimate.objects.create(name="Mine points", project=mine, workspace=workspace)
        secret_estimate = Estimate.objects.create(name="Secret points", project=secret, workspace=workspace)
        Project.objects.filter(pk=mine.pk).update(estimate=mine_estimate)
        Project.objects.filter(pk=secret.pk).update(estimate=secret_estimate)

        response = session_client.get(f"/api/workspaces/{workspace.slug}/estimates/")
        assert response.status_code == status.HTTP_200_OK
        assert {str(row["id"]) for row in response.data} == {str(mine_estimate.id)}

    @pytest.mark.django_db
    def test_profile_stats_needs_workspace_membership(self, stranger_client, workspace, create_user):
        response = stranger_client.get(f"/api/workspaces/{workspace.slug}/user-stats/{create_user.id}/")
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_profile_stats_cycles_only_from_member_containers(
        self, session_client, workspace, secret, owner, secret_issue
    ):
        cycle = Cycle.objects.create(
            name="Secret sprint",
            project=secret,
            workspace=workspace,
            owned_by=owner,
            start_date=timezone.now() + timedelta(days=3),
            end_date=timezone.now() + timedelta(days=10),
        )
        CycleIssue.objects.create(cycle=cycle, issue=secret_issue, project=secret, workspace=workspace)
        IssueAssignee.objects.create(issue=secret_issue, assignee=owner, project=secret, workspace=workspace)

        response = session_client.get(f"/api/workspaces/{workspace.slug}/user-stats/{owner.id}/")
        assert response.status_code == status.HTTP_200_OK
        assert list(response.data["upcoming_cycles"]) == []

    @pytest.mark.django_db
    def test_mention_search_hides_members_of_non_member_container(self, session_client, workspace, mine, secret):
        url = f"/api/workspaces/{workspace.slug}/entity-search/"
        hidden = session_client.get(url, {"query_type": "user_mention", "project_id": str(secret.id)})
        assert hidden.status_code == status.HTTP_200_OK
        assert hidden.data["user_mention"] == []

        visible = session_client.get(url, {"query_type": "user_mention", "project_id": str(mine.id)})
        assert len(visible.data["user_mention"]) == 1

    @pytest.mark.django_db
    def test_project_search_ignores_inactive_membership(self, session_client, workspace, create_user, secret):
        ProjectMember.objects.create(
            project=secret, member=create_user, workspace=workspace, role=MEMBER, is_active=False
        )
        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/entity-search/", {"query_type": "project", "query": "Secret"}
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["project"] == []

    @pytest.mark.django_db
    def test_former_member_cannot_list_labels(self, session_client, workspace, create_user, secret):
        ProjectMember.objects.create(
            project=secret, member=create_user, workspace=workspace, role=MEMBER, is_active=False
        )
        Label.objects.create(name="secret-label", project=secret, workspace=workspace)
        response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{secret.id}/issue-labels/")
        assert "secret-label" not in str(response.data)


@pytest.mark.contract
class TestExportHistoryScope:
    @pytest.mark.django_db
    def test_history_hides_exports_of_non_member_containers(
        self, session_client, workspace, create_user, owner, mine, secret
    ):
        own = ExporterHistory.objects.create(
            workspace=workspace, project=[], initiated_by=create_user, provider="csv", type="issue_exports"
        )
        covered = ExporterHistory.objects.create(
            workspace=workspace, project=[mine.id], initiated_by=owner, provider="csv", type="issue_exports"
        )
        ExporterHistory.objects.create(
            workspace=workspace, project=[secret.id], initiated_by=owner, provider="csv", type="issue_exports"
        )
        ExporterHistory.objects.create(
            workspace=workspace, project=[mine.id, secret.id], initiated_by=owner, provider="csv", type="issue_exports"
        )
        ExporterHistory.objects.create(
            workspace=workspace, project=[], initiated_by=owner, provider="csv", type="issue_exports"
        )

        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/export-issues/", {"per_page": 50, "cursor": "50:0:0"}
        )
        assert response.status_code == status.HTTP_200_OK
        assert {str(row["id"]) for row in response.data["results"]} == {str(own.id), str(covered.id)}


@pytest.mark.contract
class TestAssetScope:
    @pytest.fixture
    def secret_asset(self, db, workspace, secret):
        return FileAsset.objects.create(
            attributes={"name": "plan.pdf", "type": "application/pdf"},
            asset=f"{workspace.id}/{uuid4().hex}-plan.pdf",
            workspace=workspace,
            project=secret,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            is_uploaded=True,
        )

    @pytest.mark.django_db
    def test_workspace_download_refuses_non_member(self, session_client, workspace, secret_asset):
        with mock.patch("plane.app.views.asset.v2.S3Storage") as storage:
            storage.return_value.generate_presigned_url.return_value = "https://files.example/x"
            response = session_client.get(f"/api/assets/v2/workspaces/{workspace.slug}/download/{secret_asset.id}/")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.django_db
    def test_workspace_download_allows_member(self, session_client, workspace, mine):
        asset = FileAsset.objects.create(
            attributes={"name": "mine.pdf"},
            asset=f"{workspace.id}/{uuid4().hex}-mine.pdf",
            workspace=workspace,
            project=mine,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            is_uploaded=True,
        )
        with mock.patch("plane.app.views.asset.v2.S3Storage") as storage:
            storage.return_value.generate_presigned_url.return_value = "https://files.example/x"
            response = session_client.get(f"/api/assets/v2/workspaces/{workspace.slug}/download/{asset.id}/")
        assert response.status_code == status.HTTP_302_FOUND

    @pytest.mark.django_db
    def test_duplicate_refuses_non_member_source(self, session_client, workspace, secret_asset):
        with mock.patch("plane.app.views.asset.v2.S3Storage"):
            response = session_client.post(
                f"/api/assets/v2/workspaces/{workspace.slug}/duplicate-assets/{secret_asset.id}/",
                {"entity_type": "ISSUE_DESCRIPTION"},
                format="json",
            )
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert FileAsset.objects.filter(workspace=workspace).count() == 1

    @pytest.mark.django_db
    def test_duplicate_refuses_non_member_destination(self, session_client, workspace, mine, secret):
        source = FileAsset.objects.create(
            attributes={"name": "mine.png"},
            asset=f"{workspace.id}/{uuid4().hex}-mine.png",
            workspace=workspace,
            project=mine,
            entity_type=FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
            is_uploaded=True,
        )
        with mock.patch("plane.app.views.asset.v2.S3Storage"):
            response = session_client.post(
                f"/api/assets/v2/workspaces/{workspace.slug}/duplicate-assets/{source.id}/",
                {"entity_type": "ISSUE_DESCRIPTION", "project_id": str(secret.id)},
                format="json",
            )
        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
class TestRelationScope:
    def _url(self, workspace, project, issue, action="issue-relation"):
        return f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/{action}/"

    @pytest.mark.django_db
    def test_other_end_in_non_member_container_is_hidden(
        self, session_client, workspace, mine, my_issue, secret_issue
    ):
        IssueRelation.objects.create(
            issue=my_issue, related_issue=secret_issue, relation_type="blocked_by", project=mine, workspace=workspace
        )
        response = session_client.get(self._url(workspace, mine, my_issue))
        assert response.status_code == status.HTTP_200_OK
        assert list(response.data["blocked_by"]) == []
        assert "secret task title" not in str(response.data)

    @pytest.mark.django_db
    def test_task_from_another_container_404s(self, session_client, workspace, mine, secret_issue):
        response = session_client.get(self._url(workspace, mine, secret_issue))
        assert response.status_code == status.HTTP_404_NOT_FOUND

        response = session_client.post(
            self._url(workspace, mine, secret_issue, "remove-relation"), {"related_issue": str(uuid4())}, format="json"
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.django_db
    def test_cannot_link_into_non_member_container(self, session_client, workspace, mine, my_issue, secret_issue):
        response = session_client.post(
            self._url(workspace, mine, my_issue),
            {"relation_type": "blocked_by", "issues": [str(secret_issue.id)]},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert not IssueRelation.objects.filter(related_issue=secret_issue).exists()

    @pytest.mark.django_db
    def test_can_still_link_within_member_containers(self, session_client, workspace, mine, my_issue, create_user):
        other = _issue("other task", mine, create_user)
        response = session_client.post(
            self._url(workspace, mine, my_issue),
            {"relation_type": "blocked_by", "issues": [str(other.id)]},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert IssueRelation.objects.filter(issue=my_issue, related_issue=other).exists()


@pytest.mark.contract
class TestDraftScope:
    @pytest.mark.django_db
    def test_draft_cannot_target_non_member_container(self, session_client, workspace, secret):
        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/draft-issues/",
            {"name": "sneaky", "project_id": str(secret.id)},
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not DraftIssue.objects.filter(name="sneaky").exists()

    @pytest.mark.django_db
    def test_cannot_convert_someone_elses_draft(self, session_client, workspace, mine, owner):
        draft = DraftIssue(name="owner's draft", workspace=workspace, project=mine)
        draft.save(created_by_id=owner.id)
        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/draft-to-issue/{draft.id}/", {"name": "owner's draft"}, format="json"
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert not Issue.objects.filter(name="owner's draft").exists()

    @pytest.mark.django_db
    def test_cannot_convert_into_container_after_leaving_it(self, session_client, workspace, create_user, secret):
        draft = DraftIssue(name="left behind", workspace=workspace, project=secret)
        draft.save(created_by_id=create_user.id)
        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/draft-to-issue/{draft.id}/", {"name": "left behind"}, format="json"
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not Issue.objects.filter(name="left behind").exists()


@pytest.mark.contract
class TestExternalApiScope:
    @pytest.mark.django_db
    def test_project_summary_needs_membership(self, api_key_client, workspace, mine, secret):
        base = f"/api/v1/workspaces/{workspace.slug}/projects"
        assert api_key_client.get(f"{base}/{secret.id}/summary/").status_code == status.HTTP_404_NOT_FOUND
        assert api_key_client.get(f"{base}/{mine.id}/summary/").status_code == status.HTTP_200_OK

    @pytest.mark.django_db
    def test_label_create_needs_membership(self, api_key_client, workspace, secret):
        response = api_key_client.post(
            f"/api/v1/workspaces/{workspace.slug}/projects/{secret.id}/labels/", {"name": "injected"}, format="json"
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not Label.objects.filter(name="injected").exists()

    @pytest.mark.django_db
    def test_relations_hide_non_member_end(self, api_key_client, workspace, mine, my_issue, secret_issue):
        IssueRelation.objects.create(
            issue=my_issue, related_issue=secret_issue, relation_type="blocked_by", project=mine, workspace=workspace
        )
        response = api_key_client.get(
            f"/api/v1/workspaces/{workspace.slug}/projects/{mine.id}/work-items/{my_issue.id}/relations/"
        )
        assert response.status_code == status.HTTP_200_OK
        assert str(secret_issue.id) not in str(response.data)
