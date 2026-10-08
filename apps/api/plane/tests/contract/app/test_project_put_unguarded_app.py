# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests: ``PUT`` is not a way around the app API's permissions.

Thirteen app routes mapped ``put`` to DRF's default ``ModelViewSet.update``.
The viewsets guard ``partial_update`` (``allow_permission`` decorators, admin
checks, the guest clamp, the fixed-due-date lock), never ``update`` - and most
of them have only the base ``IsAuthenticated`` permission class. So any
logged-in user, even one outside the workspace, could rewrite a container
(rename it, flip Secret to Public), a task or a Job by id, and read the task
back in the response.

The web app never sends ``PUT`` to any of these, so none of them route it now.
"""

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, Module, Project, ProjectMember, User


@pytest.fixture
def secret(db, workspace, create_user):
    project = Project.objects.create(
        name="Secret", identifier="SEC", workspace=workspace, network=0, created_by=create_user
    )
    ProjectMember.objects.create(project=project, member=create_user, workspace=workspace, role=20)
    return project


@pytest.fixture
def outsider_client(db):
    unique_id = uuid4().hex[:8]
    user = User.objects.create(email=f"outsider-{unique_id}@plane.so", username=f"outsider_{unique_id}")
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.contract
class TestProjectPutIsNotRouted:
    @pytest.mark.django_db
    def test_outsider_cannot_put_a_container(self, outsider_client, workspace, secret):
        response = outsider_client.put(
            f"/api/workspaces/{workspace.slug}/projects/{secret.id}/",
            {"name": "Hijacked", "identifier": "HIJ", "network": 2},
            format="json",
        )
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        secret.refresh_from_db()
        assert (secret.name, secret.identifier, secret.network) == ("Secret", "SEC", 0)

    @pytest.mark.django_db
    def test_admin_still_updates_with_patch(self, session_client, workspace, secret):
        response = session_client.patch(
            f"/api/workspaces/{workspace.slug}/projects/{secret.id}/", {"name": "Renamed"}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK
        secret.refresh_from_db()
        assert secret.name == "Renamed"


UNROUTED_PUT_PATHS = [
    "projects/{project}/",
    "projects/{project}/cycles/{any}/",
    "projects/{project}/cycles/{any}/cycle-issues/{any}/",
    "projects/{project}/issues/{any}/",
    "projects/{project}/issue-labels/{any}/",
    "projects/{project}/issues/{any}/issue-links/{any}/",
    "projects/{project}/issues/{any}/comments/{any}/",
    "projects/{project}/modules/{any}/",
    "projects/{project}/modules/{any}/issues/{any}/",
    "projects/{project}/modules/{any}/module-links/{any}/",
    "projects/{project}/views/{any}/",
    "views/{any}/",
]


@pytest.mark.contract
class TestPutIsNotRoutedAnywhere:
    @pytest.mark.django_db
    @pytest.mark.parametrize("path", UNROUTED_PUT_PATHS)
    def test_put_is_method_not_allowed(self, session_client, workspace, secret, path):
        url = f"/api/workspaces/{workspace.slug}/" + path.format(project=secret.id, any=uuid4())
        response = session_client.put(url, {"name": "x"}, format="json")
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED, url

    @pytest.mark.django_db
    def test_workspace_put_is_method_not_allowed(self, session_client, workspace):
        response = session_client.put(f"/api/workspaces/{workspace.slug}/", {"name": "x"}, format="json")
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED

    @pytest.mark.django_db
    def test_outsider_cannot_rewrite_a_task_or_job(self, outsider_client, workspace, create_user, secret):
        issue = Issue(name="secret task", project=secret, workspace=workspace)
        issue.save(created_by_id=create_user.id)
        job = Module.objects.create(name="secret job", project=secret, workspace=workspace)
        base = f"/api/workspaces/{workspace.slug}/projects/{secret.id}"

        task_response = outsider_client.put(f"{base}/issues/{issue.id}/", {"name": "pwned"}, format="json")
        job_response = outsider_client.put(f"{base}/modules/{job.id}/", {"name": "pwned"}, format="json")

        assert task_response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        assert job_response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        issue.refresh_from_db()
        job.refresh_from_db()
        assert (issue.name, job.name) == ("secret task", "secret job")
