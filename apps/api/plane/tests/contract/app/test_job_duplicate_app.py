# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for Geotech3D's "Duplicate Job".

A Job that repeats gets copied as a fresh starting point. The copy keeps each
task's title and description, the task tree and the task order, and nothing
that belongs to one run of the Job: no dates, assignees, labels, priority or
dependencies. Every copied task starts in one chosen state.
"""

from datetime import date
from unittest import mock

import pytest
from rest_framework import status

from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueLabel,
    IssueRelation,
    Label,
    Module,
    ModuleIssue,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)

URL = "/api/workspaces/{slug}/projects/{project_id}/modules/{module_id}/duplicate/"


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(
        name="Survey Container",
        identifier="SC",
        workspace=workspace,
        created_by=create_user,
        job_description_template="SCOPE OF WORK",
    )
    ProjectMember.objects.create(project=project, member=create_user, workspace=workspace, role=20)
    return project


@pytest.fixture
def states(project):
    backlog = State.objects.create(
        name="Backlog", group="backlog", project=project, workspace=project.workspace, default=True, sequence=1
    )
    todo = State.objects.create(
        name="Todo", group="unstarted", project=project, workspace=project.workspace, sequence=2
    )
    doing = State.objects.create(
        name="In Progress", group="started", project=project, workspace=project.workspace, sequence=3
    )
    return {"backlog": backlog, "todo": todo, "doing": doing}


def _task(project, module, name, sort_order, state, parent=None, **fields):
    task = Issue.objects.create(
        project=project,
        workspace=project.workspace,
        name=name,
        state=state,
        parent=parent,
        description_html=f"<p>{name} description</p>",
        **fields,
    )
    Issue.objects.filter(pk=task.pk).update(sort_order=sort_order)
    task.refresh_from_db()
    if module is not None:
        ModuleIssue.objects.create(module=module, issue=task, project=project, workspace=project.workspace)
    return task


@pytest.fixture
def source_job(project, states, create_user):
    """
    A Job with a small task tree:

        Mobilise            (sort 1000)
          Order equipment   (sort 3000)
          Book travel       (sort 2000)   <- comes first among siblings
        Survey              (sort 5000)
        Report              (sort 9000, child of a task outside the Job)
    """
    job = Module.objects.create(
        name="Survey Job 1",
        module_code="SJ-001",
        project=project,
        workspace=project.workspace,
        start_date=date(2026, 1, 5),
        target_date=date(2026, 2, 5),
        lead=create_user,
    )
    doing = states["doing"]
    mobilise = _task(
        project,
        job,
        "Mobilise",
        1000,
        doing,
        priority="high",
        start_date=date(2026, 1, 5),
        target_date=date(2026, 1, 9),
    )
    _task(project, job, "Order equipment", 3000, doing, parent=mobilise)
    _task(project, job, "Book travel", 2000, doing, parent=mobilise)
    survey = _task(project, job, "Survey", 5000, doing, priority="urgent")
    outside = _task(project, None, "Outside parent", 100, doing)
    _task(project, job, "Report", 9000, doing, parent=outside)

    IssueAssignee.objects.create(issue=mobilise, assignee=create_user, project=project, workspace=project.workspace)
    label = Label.objects.create(name="Field", project=project, workspace=project.workspace)
    IssueLabel.objects.create(issue=survey, label=label, project=project, workspace=project.workspace)
    IssueRelation.objects.create(
        issue=survey,
        related_issue=mobilise,
        relation_type="blocked_by",
        project=project,
        workspace=project.workspace,
    )

    archived = _task(project, job, "Archived task", 7000, doing)
    Issue.objects.filter(pk=archived.pk).update(archived_at=date(2026, 1, 1))
    return job


def _post(session_client, workspace, project, job, payload, capture=None):
    url = URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id)
    with (
        mock.patch("plane.app.views.module.duplicate.issue_activity.delay") as activity,
        mock.patch("plane.app.views.module.duplicate.copy_s3_objects_of_description_and_assets.delay") as copy_files,
    ):
        if capture is not None:
            with capture(execute=True):
                response = session_client.post(url, payload, format="json")
        else:
            response = session_client.post(url, payload, format="json")
    return response, activity, copy_files


def _copied_tasks(module_id):
    return Issue.objects.filter(issue_module__module_id=module_id, issue_module__deleted_at__isnull=True)


@pytest.mark.contract
class TestDuplicateJob:
    @pytest.mark.django_db
    def test_copies_titles_descriptions_tree_and_order(
        self, session_client, workspace, project, states, source_job, django_capture_on_commit_callbacks
    ):
        response, _, _ = _post(
            session_client,
            workspace,
            project,
            source_job,
            {"name": "Survey Job 2", "module_code": "SJ-002"},
            capture=django_capture_on_commit_callbacks,
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data["task_count"] == 5

        job = Module.objects.get(pk=response.data["id"])
        assert job.name == "Survey Job 2"
        assert job.module_code == "SJ-002"

        tasks = {task.name: task for task in _copied_tasks(job.id)}
        assert set(tasks) == {"Mobilise", "Order equipment", "Book travel", "Survey", "Report"}
        assert tasks["Survey"].description_html == "<p>Survey description</p>"

        # the tree: children point at the copy of their parent
        assert tasks["Order equipment"].parent_id == tasks["Mobilise"].id
        assert tasks["Book travel"].parent_id == tasks["Mobilise"].id
        # a parent outside the Job is not copied, so that task is a root
        assert tasks["Report"].parent_id is None
        assert tasks["Mobilise"].parent_id is None

        # the order: the source sort_order values come across unchanged
        assert tasks["Book travel"].sort_order < tasks["Order equipment"].sort_order
        assert [t.name for t in sorted(tasks.values(), key=lambda t: t.sort_order) if t.parent_id is None] == [
            "Mobilise",
            "Survey",
            "Report",
        ]

        # the copies are new tasks, not the source ones moved
        assert _copied_tasks(source_job.id).count() == 6

    @pytest.mark.django_db
    def test_nothing_specific_to_one_run_is_copied(self, session_client, workspace, project, states, source_job):
        response, _, _ = _post(session_client, workspace, project, source_job, {"name": "Survey Job 2"})
        assert response.status_code == status.HTTP_201_CREATED, response.data

        job = Module.objects.get(pk=response.data["id"])
        assert job.start_date is None and job.target_date is None
        assert job.lead_id is None
        assert job.description == "SCOPE OF WORK"
        assert job.state_id == states["backlog"].id

        tasks = list(_copied_tasks(job.id))
        assert all(t.start_date is None and t.target_date is None for t in tasks)
        assert all(t.priority == "none" for t in tasks)
        assert not IssueAssignee.objects.filter(issue__in=tasks).exists()
        assert not IssueLabel.objects.filter(issue__in=tasks).exists()
        assert not IssueRelation.objects.filter(issue__in=tasks).exists()
        assert not IssueRelation.objects.filter(related_issue__in=tasks).exists()

    @pytest.mark.django_db
    def test_tasks_start_in_the_default_state(self, session_client, workspace, project, states, source_job):
        response, _, _ = _post(session_client, workspace, project, source_job, {"name": "Survey Job 2"})
        assert response.status_code == status.HTTP_201_CREATED
        assert {t.state_id for t in _copied_tasks(response.data["id"])} == {states["backlog"].id}

    @pytest.mark.django_db
    def test_tasks_start_in_the_chosen_state(self, session_client, workspace, project, states, source_job):
        response, _, _ = _post(
            session_client,
            workspace,
            project,
            source_job,
            {"name": "Survey Job 2", "task_state_id": str(states["todo"].id)},
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert {t.state_id for t in _copied_tasks(response.data["id"])} == {states["todo"].id}

    @pytest.mark.django_db
    def test_a_state_from_another_container_is_refused(
        self, session_client, workspace, project, states, source_job, create_user
    ):
        other = Project.objects.create(name="Other", identifier="OT", workspace=workspace, created_by=create_user)
        foreign = State.objects.create(name="Todo", group="unstarted", project=other, workspace=workspace)

        response, _, _ = _post(
            session_client,
            workspace,
            project,
            source_job,
            {"name": "Survey Job 2", "task_state_id": str(foreign.id)},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Module.objects.filter(name="Survey Job 2").exists()

    @pytest.mark.django_db
    def test_a_taken_name_or_code_is_refused_and_nothing_is_created(
        self, session_client, workspace, project, states, source_job
    ):
        before = Issue.objects.count()

        same_name, _, _ = _post(session_client, workspace, project, source_job, {"name": "Survey Job 1"})
        same_code, _, _ = _post(
            session_client, workspace, project, source_job, {"name": "Survey Job 2", "module_code": "sj-001"}
        )
        no_name, _, _ = _post(session_client, workspace, project, source_job, {"name": ""})

        assert same_name.status_code == status.HTTP_400_BAD_REQUEST
        assert same_code.status_code == status.HTTP_400_BAD_REQUEST
        assert no_name.status_code == status.HTTP_400_BAD_REQUEST
        assert Module.objects.filter(project=project).count() == 1
        assert Issue.objects.count() == before

    @pytest.mark.django_db
    def test_history_is_recorded_without_notifications(
        self, session_client, workspace, project, states, source_job, django_capture_on_commit_callbacks
    ):
        response, activity, copy_files = _post(
            session_client,
            workspace,
            project,
            source_job,
            {"name": "Survey Job 2"},
            capture=django_capture_on_commit_callbacks,
        )
        assert response.status_code == status.HTTP_201_CREATED

        calls = activity.call_args_list
        # a "created" and an "added to the Job" entry per task
        assert len(calls) == 10
        assert {c.kwargs["type"] for c in calls} == {"issue.activity.created", "module.activity.created"}
        assert all(c.kwargs["notification"] is False for c in calls)
        # no description has images, so no files are copied
        copy_files.assert_not_called()

    @pytest.mark.django_db
    def test_images_in_a_description_get_their_own_copy(
        self, session_client, workspace, project, states, source_job, django_capture_on_commit_callbacks
    ):
        Issue.objects.filter(name="Survey", project=project).update(
            description_html='<p>map</p><image-component src="abc"></image-component>'
        )

        response, _, copy_files = _post(
            session_client,
            workspace,
            project,
            source_job,
            {"name": "Survey Job 2"},
            capture=django_capture_on_commit_callbacks,
        )
        assert response.status_code == status.HTTP_201_CREATED

        survey_copy = _copied_tasks(response.data["id"]).get(name="Survey")
        copy_files.assert_called_once()
        assert copy_files.call_args.kwargs["entity_name"] == "ISSUE"
        assert copy_files.call_args.kwargs["entity_identifier"] == str(survey_copy.id)

    @pytest.mark.django_db
    def test_a_guest_cannot_duplicate(self, api_client, workspace, project, states, source_job):
        guest = User.objects.create(email="guest@example.com", username="guest-user")
        guest.set_password("guest-password")
        guest.save()
        WorkspaceMember.objects.create(workspace=workspace, member=guest, role=5)
        ProjectMember.objects.create(project=project, member=guest, workspace=workspace, role=5)
        api_client.force_authenticate(user=guest)

        response, _, _ = _post(api_client, workspace, project, source_job, {"name": "Survey Job 2"})

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not Module.objects.filter(name="Survey Job 2").exists()

    @pytest.mark.django_db
    def test_an_unknown_job_is_not_found(self, session_client, workspace, project, states):
        url = URL.format(slug=workspace.slug, project_id=project.id, module_id="00000000-0000-0000-0000-000000000000")
        response = session_client.post(url, {"name": "Copy"}, format="json")
        assert response.status_code == status.HTTP_404_NOT_FOUND
