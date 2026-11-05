# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import datetime, timezone
from importlib import import_module

import pytest
from django.apps import apps

from plane.db.models import Cycle, Project, Workspace


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

    def make_cycle(self, project, user):
        return Cycle.objects.create(
            name="Sprint",
            project=project,
            workspace=project.workspace,
            owned_by=user,
            start_date=datetime(2026, 11, 1, 0, 0, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 11, 14, 23, 59, tzinfo=timezone.utc),
        )

    def test_changing_the_workspace_keeps_the_dates_cycles_show(self, workspace, create_user):
        cycle = self.make_cycle(make_container(workspace, "ONE"), create_user)

        workspace.timezone = "Asia/Dubai"
        workspace.save()

        cycle.refresh_from_db()
        assert cycle.start_date == datetime(2026, 10, 31, 20, 0, 1, tzinfo=timezone.utc)
        assert cycle.end_date == datetime(2026, 11, 14, 19, 59, tzinfo=timezone.utc)

    def test_undated_cycle_and_other_workspaces_cycles_are_left_alone(self, workspace, other_workspace, create_user):
        undated = Cycle.objects.create(
            name="Undated", project=make_container(workspace, "ONE"), workspace=workspace, owned_by=create_user
        )
        unrelated = self.make_cycle(make_container(other_workspace, "TWO"), create_user)

        workspace.timezone = "Asia/Dubai"
        workspace.save()

        undated.refresh_from_db()
        unrelated.refresh_from_db()
        assert undated.end_date is None
        assert unrelated.end_date == datetime(2026, 11, 14, 23, 59, tzinfo=timezone.utc)

    def test_one_time_migration_keeps_the_dates_cycles_show(self, workspace, create_user):
        cycle = self.make_cycle(make_container(workspace, "ONE"), create_user)
        Workspace.objects.filter(pk=workspace.pk).update(timezone="Asia/Dubai")

        migration = import_module("plane.db.migrations.0131_containers_follow_workspace_timezone")
        migration.align_container_timezones(apps, None)

        cycle.refresh_from_db()
        assert cycle.end_date == datetime(2026, 11, 14, 19, 59, tzinfo=timezone.utc)

    def test_bad_stored_timezones_do_not_fail_the_migration(self, workspace, other_workspace, create_user):
        bad_container = make_container(workspace, "ONE")
        cycle = self.make_cycle(bad_container, create_user)
        Project.objects.filter(pk=bad_container.pk).update(timezone="")
        Workspace.objects.filter(pk=workspace.pk).update(timezone="Asia/Dubai")
        kept = make_container(other_workspace, "TWO")
        Workspace.objects.filter(pk=other_workspace.pk).update(timezone="Bad/Zone")

        migration = import_module("plane.db.migrations.0131_containers_follow_workspace_timezone")
        migration.align_container_timezones(apps, None)

        bad_container.refresh_from_db()
        cycle.refresh_from_db()
        kept.refresh_from_db()
        assert bad_container.timezone == "Asia/Dubai"
        assert cycle.end_date == datetime(2026, 11, 14, 19, 59, tzinfo=timezone.utc)
        assert kept.timezone == "UTC"
