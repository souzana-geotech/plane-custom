# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for the module_code field and the WBS default layout on
the app module endpoints.

POST  /api/workspaces/<slug>/projects/<project_id>/modules/
PATCH /api/workspaces/<slug>/projects/<project_id>/modules/<pk>/
GET   /api/workspaces/<slug>/projects/<project_id>/modules/
GET   /api/workspaces/<slug>/projects/<project_id>/modules/<module_id>/user-properties/
"""

import pytest
from rest_framework import status

from plane.db.models import Module, Project, ProjectMember


def _modules_url(slug, project_id):
    return f"/api/workspaces/{slug}/projects/{project_id}/modules/"


def _module_url(slug, project_id, pk):
    return f"/api/workspaces/{slug}/projects/{project_id}/modules/{pk}/"


def _user_properties_url(slug, project_id, module_id):
    return f"/api/workspaces/{slug}/projects/{project_id}/modules/{module_id}/user-properties/"


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(
        name="Module Code Contract Project",
        identifier="MCC",
        workspace=workspace,
        created_by=create_user,
        module_view=True,
    )
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=create_user,
        role=20,
        is_active=True,
    )
    return project


@pytest.mark.contract
class TestModuleCodeEndpoints:
    @pytest.mark.django_db
    def test_create_module_with_code_trims_and_echoes_it(self, session_client, workspace, project):
        response = session_client.post(
            _modules_url(workspace.slug, project.id),
            {"name": "Survey", "module_code": "  GT3D-001  "},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["module_code"] == "GT3D-001"
        assert Module.objects.get(pk=response.data["id"]).module_code == "GT3D-001"

    @pytest.mark.django_db
    def test_duplicate_code_rejected_case_insensitively(self, session_client, workspace, project):
        first = session_client.post(
            _modules_url(workspace.slug, project.id),
            {"name": "Survey", "module_code": "GT3D-001"},
            format="json",
        )
        assert first.status_code == status.HTTP_201_CREATED

        duplicate = session_client.post(
            _modules_url(workspace.slug, project.id),
            {"name": "Processing", "module_code": "gt3d-001"},
            format="json",
        )
        assert duplicate.status_code == status.HTTP_400_BAD_REQUEST
        assert "module_code" in duplicate.data

    @pytest.mark.django_db
    def test_blank_codes_stored_as_null_and_never_conflict(self, session_client, workspace, project):
        for name in ("A", "B"):
            response = session_client.post(
                _modules_url(workspace.slug, project.id),
                {"name": name, "module_code": ""},
                format="json",
            )
            assert response.status_code == status.HTTP_201_CREATED
            assert response.data["module_code"] is None

    @pytest.mark.django_db
    def test_update_can_set_and_clear_the_code(self, session_client, workspace, project):
        created = session_client.post(
            _modules_url(workspace.slug, project.id),
            {"name": "Survey"},
            format="json",
        )
        assert created.status_code == status.HTTP_201_CREATED
        module_id = created.data["id"]

        set_code = session_client.patch(
            _module_url(workspace.slug, project.id, module_id),
            {"module_code": "GT3D-002"},
            format="json",
        )
        assert set_code.status_code == status.HTTP_200_OK
        assert set_code.data["module_code"] == "GT3D-002"

        clear_code = session_client.patch(
            _module_url(workspace.slug, project.id, module_id),
            {"module_code": ""},
            format="json",
        )
        assert clear_code.status_code == status.HTTP_200_OK
        assert clear_code.data["module_code"] is None

    @pytest.mark.django_db
    def test_module_list_includes_the_code(self, session_client, workspace, project):
        session_client.post(
            _modules_url(workspace.slug, project.id),
            {"name": "Survey", "module_code": "GT3D-001"},
            format="json",
        )
        response = session_client.get(_modules_url(workspace.slug, project.id))
        assert response.status_code == status.HTTP_200_OK
        modules = response.data
        codes = {module["name"]: module.get("module_code") for module in modules}
        assert codes["Survey"] == "GT3D-001"

    @pytest.mark.django_db
    def test_module_user_properties_default_layout_is_wbs(self, session_client, workspace, project):
        created = session_client.post(
            _modules_url(workspace.slug, project.id),
            {"name": "Survey"},
            format="json",
        )
        assert created.status_code == status.HTTP_201_CREATED

        response = session_client.get(_user_properties_url(workspace.slug, project.id, created.data["id"]))
        assert response.status_code == status.HTTP_200_OK
        assert response.data["display_filters"]["layout"] == "wbs"
