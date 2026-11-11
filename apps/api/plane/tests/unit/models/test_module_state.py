# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Geotech3D: Jobs (modules) use their container's task States.

Covers:
- migration 0132 mapping every legacy status onto the container's states
- new Jobs starting in the default state; `status` derived from the state
- the serializer rules (own container's state only; legacy `status` mapped)
- deleting a state a Job uses is refused; a group change re-syncs `status`
- Job priority
"""

import importlib

import pytest
from django.apps import apps as django_apps
from rest_framework.exceptions import ValidationError

from plane.app.serializers import ModuleWriteSerializer
from plane.db.models import Label, Module, Project, ProjectMember, State


def _project(workspace, user, name, identifier):
    project = Project.objects.create(
        name=name, identifier=identifier, workspace=workspace, created_by=user, module_view=True
    )
    ProjectMember.objects.create(workspace=workspace, project=project, member=user, role=20, is_active=True)
    return project


def _states(project):
    rows = [
        ("Backlog", "backlog", 15000, False),
        ("Todo", "unstarted", 25000, True),
        ("In Progress", "started", 35000, False),
        ("Done", "completed", 45000, False),
        ("Cancelled", "cancelled", 55000, False),
    ]
    return {
        name: State.objects.create(
            name=name,
            group=group,
            sequence=seq,
            default=default,
            color="#000000",
            project=project,
            workspace=project.workspace,
        )
        for name, group, seq, default in rows
    }


@pytest.fixture
def project(db, workspace, create_user):
    return _project(workspace, create_user, "Job State Project", "JSP")


@pytest.fixture
def states(project):
    return _states(project)


def _job(project, name, **kwargs):
    return Module.objects.create(name=name, project=project, workspace=project.workspace, **kwargs)


def _run_migration():
    migration = importlib.import_module("plane.db.migrations.0132_module_state_priority")
    migration.assign_states(django_apps, None)


@pytest.mark.unit
class TestMigration:
    @pytest.mark.django_db
    def test_each_status_maps_to_matching_state(self, project, states):
        jobs = {}
        for status in ["backlog", "planned", "in-progress", "completed", "cancelled"]:
            job = _job(project, f"Job {status}")
            # Simulate a pre-migration row: legacy status, no state
            Module.all_objects.filter(pk=job.pk).update(status=status, state=None)
            jobs[status] = job

        _run_migration()

        expected = {
            "backlog": "Backlog",
            "planned": "Todo",
            "in-progress": "In Progress",
            "completed": "Done",
            "cancelled": "Cancelled",
        }
        for status, job in jobs.items():
            job.refresh_from_db()
            assert job.state.name == expected[status]
            # the legacy column is left exactly as it was
            assert job.status == status

    @pytest.mark.django_db
    def test_paused_gets_a_new_paused_state_in_started_group(self, project, states):
        job = _job(project, "Paused job")
        Module.all_objects.filter(pk=job.pk).update(status="paused", state=None)

        _run_migration()

        job.refresh_from_db()
        assert job.state.name == "Paused"
        assert job.state.group == "started"
        assert job.state.project_id == project.id
        assert job.status == "paused"

    @pytest.mark.django_db
    def test_paused_state_only_created_where_needed(self, workspace, create_user, project, states):
        other = _project(workspace, create_user, "No Paused Jobs", "NPJ")
        _states(other)
        job = _job(other, "Planned job")
        Module.all_objects.filter(pk=job.pk).update(status="planned", state=None)

        _run_migration()

        assert not State.objects.filter(project=other, name="Paused").exists()

    @pytest.mark.django_db
    def test_missing_group_creates_state_instead_of_misfiling(self, project, states):
        states["Cancelled"].delete()
        job = _job(project, "Cancelled job")
        Module.all_objects.filter(pk=job.pk).update(status="cancelled", state=None)

        _run_migration()

        job.refresh_from_db()
        assert job.state.group == "cancelled"
        assert job.state.deleted_at is None

    @pytest.mark.django_db
    def test_archived_and_soft_deleted_jobs_are_migrated(self, project, states):
        archived = _job(project, "Archived")
        deleted = _job(project, "Deleted")
        Module.all_objects.filter(pk=archived.pk).update(status="completed", state=None, archived_at="2026-01-01T00:00Z")
        Module.all_objects.filter(pk=deleted.pk).update(status="backlog", state=None, deleted_at="2026-01-01T00:00Z")

        _run_migration()

        assert Module.all_objects.get(pk=archived.pk).state.name == "Done"
        assert Module.all_objects.get(pk=deleted.pk).state.name == "Backlog"

    @pytest.mark.django_db
    def test_rerun_changes_nothing(self, project, states):
        job = _job(project, "Moved job", state=states["Done"])
        _run_migration()
        job.refresh_from_db()
        assert job.state == states["Done"]


@pytest.mark.unit
class TestModelSync:
    @pytest.mark.django_db
    def test_new_job_starts_in_default_state(self, project, states):
        job = _job(project, "New")
        assert job.state == states["Todo"]
        assert job.status == "planned"

    @pytest.mark.django_db
    def test_status_follows_state_group(self, project, states):
        job = _job(project, "Job")
        job.state = states["Done"]
        job.save()
        job.refresh_from_db()
        assert job.status == "completed"

    @pytest.mark.django_db
    def test_state_group_change_resyncs_jobs(self, project, states):
        job = _job(project, "Job", state=states["In Progress"])
        state = states["In Progress"]
        state.group = "completed"
        state.save()
        job.refresh_from_db()
        assert job.status == "completed"

    @pytest.mark.django_db
    def test_priority_defaults_to_none(self, project, states):
        assert _job(project, "Job").priority == "none"


@pytest.mark.unit
class TestSerializer:
    @pytest.mark.django_db
    def test_state_from_other_container_rejected(self, workspace, create_user, project, states):
        other = _project(workspace, create_user, "Other", "OTH")
        foreign = _states(other)["Done"]
        job = _job(project, "Job")
        serializer = ModuleWriteSerializer(job, data={"state_id": str(foreign.id)}, partial=True)
        assert not serializer.is_valid()
        assert "state_id" in serializer.errors

    @pytest.mark.django_db
    def test_state_id_sets_state_and_status(self, project, states):
        job = _job(project, "Job")
        serializer = ModuleWriteSerializer(job, data={"state_id": str(states["Done"].id)}, partial=True)
        assert serializer.is_valid(), serializer.errors
        serializer.save()
        job.refresh_from_db()
        assert job.state == states["Done"]
        assert job.status == "completed"

    @pytest.mark.django_db
    def test_legacy_status_maps_to_state(self, project, states):
        job = _job(project, "Job")
        serializer = ModuleWriteSerializer(job, data={"status": "cancelled"}, partial=True)
        assert serializer.is_valid(), serializer.errors
        serializer.save()
        job.refresh_from_db()
        assert job.state == states["Cancelled"]
        assert job.status == "cancelled"

    @pytest.mark.django_db
    def test_new_job_without_state_gets_default(self, project, states):
        serializer = ModuleWriteSerializer(data={"name": "Fresh", "state_id": None}, context={"project": project})
        assert serializer.is_valid(), serializer.errors
        job = serializer.save()
        assert job.state == states["Todo"]

    @pytest.mark.django_db
    def test_existing_job_cannot_clear_state(self, project, states):
        job = _job(project, "Job")
        serializer = ModuleWriteSerializer(job, data={"state_id": None}, partial=True)
        assert not serializer.is_valid()

    @pytest.mark.django_db
    def test_priority_is_writable(self, project, states):
        job = _job(project, "Job")
        serializer = ModuleWriteSerializer(job, data={"priority": "urgent"}, partial=True)
        assert serializer.is_valid(), serializer.errors
        serializer.save()
        job.refresh_from_db()
        assert job.priority == "urgent"

    @pytest.mark.django_db
    def test_bad_priority_rejected(self, project, states):
        job = _job(project, "Job")
        serializer = ModuleWriteSerializer(job, data={"priority": "asap"}, partial=True)
        assert not serializer.is_valid()


@pytest.mark.contract
class TestStateDelete:
    @pytest.mark.django_db
    def test_state_used_by_job_cannot_be_deleted(self, session_client, workspace, project, states):
        _job(project, "Job", state=states["In Progress"])
        url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/states/{states['In Progress'].id}/"
        response = session_client.delete(url)
        assert response.status_code == 400
        assert "Job" in response.data["error"]
        assert State.objects.filter(pk=states["In Progress"].id).exists()

    @pytest.mark.django_db
    def test_unused_state_can_be_deleted(self, session_client, workspace, project, states):
        url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/states/{states['Cancelled'].id}/"
        response = session_client.delete(url)
        assert response.status_code == 204


def _label(project, name):
    return Label.objects.create(name=name, project=project, workspace=project.workspace, color="#ff0000")


@pytest.mark.unit
class TestJobLabels:
    @pytest.mark.django_db
    def test_labels_set_on_create_and_replaced_on_update(self, project, states):
        survey, urgent, client = _label(project, "Survey"), _label(project, "Urgent"), _label(project, "Client A")
        serializer = ModuleWriteSerializer(
            data={"name": "Labelled", "label_ids": [str(survey.id), str(urgent.id)]}, context={"project": project}
        )
        assert serializer.is_valid(), serializer.errors
        job = serializer.save()
        assert set(job.labels.all()) == {survey, urgent}
        assert set(serializer.data["label_ids"]) == {str(survey.id), str(urgent.id)}

        serializer = ModuleWriteSerializer(job, data={"label_ids": [str(client.id)]}, partial=True)
        assert serializer.is_valid(), serializer.errors
        serializer.save()
        assert list(job.labels.all()) == [client]

    @pytest.mark.django_db
    def test_empty_list_clears_and_omitted_keeps(self, project, states):
        survey = _label(project, "Survey")
        job = _job(project, "Job")
        job.labels.set([survey])

        serializer = ModuleWriteSerializer(job, data={"priority": "high"}, partial=True)
        assert serializer.is_valid(), serializer.errors
        serializer.save()
        assert list(job.labels.all()) == [survey]

        serializer = ModuleWriteSerializer(job, data={"label_ids": []}, partial=True)
        assert serializer.is_valid(), serializer.errors
        serializer.save()
        assert job.labels.count() == 0

    @pytest.mark.django_db
    def test_label_from_other_container_rejected(self, workspace, create_user, project, states):
        other = _project(workspace, create_user, "Other Labels", "OTL")
        foreign = _label(other, "Foreign")
        job = _job(project, "Job")
        serializer = ModuleWriteSerializer(job, data={"label_ids": [str(foreign.id)]}, partial=True)
        assert not serializer.is_valid()
        assert "label_ids" in serializer.errors


@pytest.mark.contract
class TestJobLabelsEndpoint:
    @pytest.mark.django_db
    def test_list_and_patch_return_label_ids(self, session_client, workspace, project, states):
        survey = _label(project, "Survey")
        job = _job(project, "Job")
        base = f"/api/workspaces/{workspace.slug}/projects/{project.id}/modules/"

        response = session_client.patch(f"{base}{job.id}/", {"label_ids": [str(survey.id)]}, format="json")
        assert response.status_code == 200, response.data
        assert [str(x) for x in response.data["label_ids"]] == [str(survey.id)]

        listed = session_client.get(base)
        assert listed.status_code == 200
        row = next(m for m in listed.data if str(m["id"]) == str(job.id))
        assert [str(x) for x in row["label_ids"]] == [str(survey.id)]
        assert row["state_id"] is not None
        assert row["priority"] == "none"

    @pytest.mark.django_db
    def test_workspace_jobs_endpoint_returns_new_fields(self, session_client, workspace, project, states):
        survey = _label(project, "Survey")
        job = _job(project, "Job")
        job.labels.set([survey])
        response = session_client.get(f"/api/workspaces/{workspace.slug}/modules/")
        assert response.status_code == 200
        row = next(m for m in response.data if str(m["id"]) == str(job.id))
        assert [str(x) for x in row["label_ids"]] == [str(survey.id)]
        assert str(row["state_id"]) == str(states["Todo"].id)


@pytest.mark.unit
class TestReviewFixes:
    """Edge cases found in review of the shared-states change."""

    @pytest.mark.django_db
    def test_deleted_job_never_adds_a_state(self, project, states):
        states["Cancelled"].delete()
        job = _job(project, "Old cancelled job")
        Module.all_objects.filter(pk=job.pk).update(status="cancelled", state=None, deleted_at="2026-01-01T00:00Z")

        _run_migration()

        assert not State.objects.filter(project=project, group="cancelled").exists()
        assert Module.all_objects.get(pk=job.pk).state is None

    @pytest.mark.django_db
    def test_deleted_container_gets_no_new_states(self, project, states):
        states["Cancelled"].delete()
        job = _job(project, "Job")
        Module.all_objects.filter(pk=job.pk).update(status="cancelled", state=None)
        Project.all_objects.filter(pk=project.pk).update(deleted_at="2026-01-01T00:00Z")

        _run_migration()

        assert not State.all_state_objects.filter(project=project, group="cancelled", deleted_at__isnull=True).exists()

    @pytest.mark.django_db
    def test_same_name_in_other_group_is_not_used_and_name_stays_unique(self, project, states):
        # a "Paused" state exists, but in the Unstarted group
        State.objects.create(
            name="Paused", group="unstarted", color="#000", project=project, workspace=project.workspace
        )
        job = _job(project, "Paused job")
        Module.all_objects.filter(pk=job.pk).update(status="paused", state=None)

        _run_migration()

        job = Module.all_objects.get(pk=job.pk)
        assert job.state.group == "started"
        assert job.state.name == "Paused 2"

    @pytest.mark.django_db
    def test_paused_state_reports_paused_status(self, project, states):
        paused = State.objects.create(
            name="Paused", group="started", color="#000", project=project, workspace=project.workspace
        )
        job = _job(project, "Job", state=paused)
        assert job.status == "paused"

        paused.color = "#111"
        paused.save()
        job.refresh_from_db()
        assert job.status == "paused"

    @pytest.mark.django_db
    def test_job_without_a_state_can_still_be_edited(self, project, states):
        job = _job(project, "Stateless")
        Module.all_objects.filter(pk=job.pk).update(state=None)
        job.refresh_from_db()
        serializer = ModuleWriteSerializer(job, data={"name": "Renamed", "state_id": None}, partial=True)
        assert serializer.is_valid(), serializer.errors

    @pytest.mark.django_db
    def test_legacy_status_without_matching_state_is_refused(self, project, states):
        states["Cancelled"].delete()
        job = _job(project, "Job")
        serializer = ModuleWriteSerializer(job, data={"status": "cancelled"}, partial=True)
        assert not serializer.is_valid()
        assert "status" in serializer.errors

    @pytest.mark.django_db
    def test_refused_update_does_not_save_labels(self, project, states):
        survey = _label(project, "Survey")
        _job(project, "Taken name")
        job = _job(project, "Job")
        serializer = ModuleWriteSerializer(
            job, data={"name": "Taken name", "label_ids": [str(survey.id)]}, partial=True
        )
        assert serializer.is_valid(), serializer.errors
        with pytest.raises(Exception):
            serializer.save()
        assert job.labels.count() == 0
