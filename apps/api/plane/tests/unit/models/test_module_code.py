# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for the Geotech3D module_code identity field and the WBS
default module layout.

Covers:
- the partial unique constraint on (module_code, project) while not deleted
- ModuleWriteSerializer normalization and duplicate validation
- the WBS layout default for module user properties (incl. migration 0126)
"""

import importlib

import pytest
from django.apps import apps as django_apps
from django.db import IntegrityError, transaction

from plane.app.serializers import ModuleWriteSerializer
from plane.db.models import Module, ModuleUserProperties, Project, ProjectMember
from plane.db.models.module import get_default_display_filters


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(
        name="Module Code Project",
        identifier="MCP",
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


@pytest.fixture
def other_project(db, workspace, create_user):
    project = Project.objects.create(
        name="Other Module Code Project",
        identifier="MCPO",
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


def _make_module(project, name, module_code=None):
    return Module.objects.create(
        name=name,
        project=project,
        workspace=project.workspace,
        module_code=module_code,
    )


@pytest.mark.unit
class TestModuleCodeConstraint:
    """The DB-level guarantee: unique per project while set and not deleted."""

    @pytest.mark.django_db
    def test_same_code_in_same_project_rejected(self, project):
        _make_module(project, "Survey", "GT3D-001")
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                _make_module(project, "Processing", "GT3D-001")

    @pytest.mark.django_db
    def test_same_code_across_projects_allowed(self, project, other_project):
        _make_module(project, "Survey", "GT3D-001")
        module = _make_module(other_project, "Survey", "GT3D-001")
        assert module.module_code == "GT3D-001"

    @pytest.mark.django_db
    def test_multiple_unset_codes_allowed(self, project):
        # NULL codes must never collide — the constraint only applies while set
        _make_module(project, "A", None)
        _make_module(project, "B", None)
        assert Module.objects.filter(project=project, module_code__isnull=True).count() == 2

    @pytest.mark.django_db
    def test_soft_deleted_module_frees_its_code(self, project):
        original = _make_module(project, "Survey", "GT3D-001")
        original.delete()  # Plane soft-delete: sets deleted_at
        replacement = _make_module(project, "Survey v2", "GT3D-001")
        assert replacement.module_code == "GT3D-001"


@pytest.mark.unit
class TestModuleWriteSerializerModuleCode:
    """Serializer-level normalization and the friendly duplicate error."""

    @pytest.mark.django_db
    def test_code_is_trimmed(self, project):
        serializer = ModuleWriteSerializer(
            data={"name": "Survey", "module_code": "  GT3D-001  "},
            context={"project": project},
        )
        assert serializer.is_valid(), serializer.errors
        assert serializer.validated_data["module_code"] == "GT3D-001"

    @pytest.mark.django_db
    def test_blank_code_normalized_to_none(self, project):
        serializer = ModuleWriteSerializer(
            data={"name": "Survey", "module_code": "   "},
            context={"project": project},
        )
        assert serializer.is_valid(), serializer.errors
        assert serializer.validated_data["module_code"] is None

    @pytest.mark.django_db
    def test_duplicate_code_rejected_case_insensitively(self, project):
        _make_module(project, "Survey", "gt3d-001")
        serializer = ModuleWriteSerializer(
            data={"name": "Processing", "module_code": "GT3D-001"},
            context={"project": project},
        )
        assert not serializer.is_valid()
        assert "module_code" in serializer.errors

    @pytest.mark.django_db
    def test_update_keeping_own_code_is_valid(self, project):
        module = _make_module(project, "Survey", "GT3D-001")
        serializer = ModuleWriteSerializer(
            instance=module,
            data={"module_code": "GT3D-001"},
            partial=True,
            context={"project": project},
        )
        assert serializer.is_valid(), serializer.errors
        assert serializer.validated_data["module_code"] == "GT3D-001"


@pytest.mark.unit
class TestWbsDefaultModuleLayout:
    """Every module opens in the WBS layout by default."""

    def test_default_display_filters_layout_is_wbs(self):
        assert get_default_display_filters()["layout"] == "wbs"

    @pytest.mark.django_db
    def test_new_module_user_properties_default_to_wbs(self, project, create_user):
        module = _make_module(project, "Survey")
        properties = ModuleUserProperties.objects.create(
            module=module,
            user=create_user,
            project=project,
            workspace=project.workspace,
        )
        assert properties.display_filters["layout"] == "wbs"

    @pytest.mark.django_db
    def test_migration_flips_existing_layouts_to_wbs(self, project, create_user):
        module_a = _make_module(project, "A")
        module_b = _make_module(project, "B")
        legacy = ModuleUserProperties.objects.create(
            module=module_a,
            user=create_user,
            project=project,
            workspace=project.workspace,
            display_filters={**get_default_display_filters(), "layout": "list", "order_by": "sort_order"},
        )
        current = ModuleUserProperties.objects.create(
            module=module_b,
            user=create_user,
            project=project,
            workspace=project.workspace,
        )

        migration = importlib.import_module("plane.db.migrations.0126_module_user_properties_default_wbs_layout")
        migration.set_module_layout_to_wbs(django_apps, None)

        legacy.refresh_from_db()
        current.refresh_from_db()
        assert legacy.display_filters["layout"] == "wbs"
        # the rest of the stored preferences must survive the flip
        assert legacy.display_filters["order_by"] == "sort_order"
        assert current.display_filters["layout"] == "wbs"
