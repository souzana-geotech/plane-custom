# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from importlib import import_module

import pytest
from django.apps import apps

from plane.db.models import Project, Workspace


@pytest.fixture
def workspace(create_user):
    return Workspace.objects.create(name="Main", slug="tz-main", owner=create_user)


@pytest.fixture
def other_workspace(create_user):
    return Workspace.objects.create(name="Other", slug="tz-other", owner=create_user)


def make_container(workspace, identifier, **kwargs):
    return Project.objects.create(name=identifier, identifier=identifier, workspace=workspace, **kwargs)


@pytest.mark.unit
@pytest.mark.django_db
class TestContainersFollowWorkspaceTimezone:
    def test_new_container_takes_the_workspace_timezone(self, workspace):
        workspace.timezone = "Asia/Dubai"
        workspace.save()
        assert make_container(workspace, "NEW").timezone == "Asia/Dubai"

    def test_changing_the_workspace_updates_its_containers_only(self, workspace, other_workspace):
        container = make_container(workspace, "ONE")
        hand_set = make_container(workspace, "TWO", timezone="Asia/Tokyo")
        unrelated = make_container(other_workspace, "THREE")

        workspace.timezone = "Asia/Dubai"
        workspace.save()

        for project in (container, hand_set, unrelated):
            project.refresh_from_db()
        assert container.timezone == "Asia/Dubai"
        assert hand_set.timezone == "Asia/Dubai"
        assert unrelated.timezone == "UTC"

    def test_saving_without_a_timezone_change_keeps_a_container_override(self, workspace):
        container = make_container(workspace, "ONE", timezone="Asia/Tokyo")

        workspace.name = "Renamed"
        workspace.save()

        container.refresh_from_db()
        assert container.timezone == "Asia/Tokyo"

    def test_save_that_excludes_timezone_does_not_propagate(self, workspace):
        container = make_container(workspace, "ONE")

        workspace.timezone = "Asia/Dubai"
        workspace.name = "Renamed"
        workspace.save(update_fields=["name"])

        container.refresh_from_db()
        assert container.timezone == "UTC"

    def test_one_time_migration_aligns_existing_containers(self, workspace, other_workspace):
        Workspace.objects.filter(pk=workspace.pk).update(timezone="Asia/Dubai")
        container = make_container(workspace, "ONE", timezone="UTC")
        other = make_container(other_workspace, "TWO", timezone="Asia/Tokyo")

        migration = import_module("plane.db.migrations.0131_containers_follow_workspace_timezone")
        migration.align_container_timezones(apps, None)

        container.refresh_from_db()
        other.refresh_from_db()
        assert container.timezone == "Asia/Dubai"
        assert other.timezone == "UTC"
