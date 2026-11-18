# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: duplicate a Job (Module) as a fresh starting point for a new one.

A Job that repeats keeps the same list of tasks, so the copy carries only what
is not specific to one run of it:

* each task's title and description,
* the task tree (parent / sub-task) and the order of the tasks.

Everything that belongs to a single run starts fresh: no dates, assignees,
labels, priority, estimates, cycles, comments, attachments, links or
dependencies. Every copied task starts in one state the caller picks (the
container's default state when none is given), and the new Job gets its own
name and code and starts in the container's default state like any new Job.
"""

# Python imports
import json

# Django imports
from django.db import transaction
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ModuleWriteSerializer
from plane.bgtasks.copy_s3_object import copy_s3_objects_of_description_and_assets
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import Issue, Module, ModuleIssue, Project, State
from plane.utils.host import base_host
from plane.utils.module_state import default_state_for_project

from .. import BaseAPIView


class ModuleDuplicateEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, module_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        # an archived Job is not offered for duplication
        if not Module.objects.filter(
            workspace__slug=slug, project_id=project_id, pk=module_id, archived_at__isnull=True
        ).exists():
            return Response({"error": "Project / Job not found"}, status=status.HTTP_404_NOT_FOUND)

        # The state every copied task starts in
        task_state_id = request.data.get("task_state_id")
        if task_state_id:
            task_state = State.objects.filter(project_id=project_id, pk=task_state_id, is_triage=False).first()
            if task_state is None:
                return Response(
                    {"task_state_id": "State must belong to this container"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            task_state = default_state_for_project(project_id)

        # The new Job: only a name and a code come from the caller, the rest
        # starts like any new Job in this container
        serializer = ModuleWriteSerializer(
            data={
                "name": request.data.get("name"),
                "module_code": request.data.get("module_code") or "",
                "description": project.job_description_template or "",
            },
            context={"project": project},
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # The tasks of the source Job, parents before their children so each
        # copy can point at its parent's copy
        source_tasks = list(
            Issue.issue_objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                issue_module__module_id=module_id,
                issue_module__deleted_at__isnull=True,
            )
            .distinct()
            .order_by("sort_order", "sequence_id")
        )
        source_ids = {task.id for task in source_tasks}
        ordered_tasks = _parents_first(source_tasks, source_ids)

        with transaction.atomic():
            module = serializer.save()

            copies = {}  # source task id -> new task
            for task in ordered_tasks:
                parent_copy = copies.get(task.parent_id) if task.parent_id in source_ids else None
                copy = Issue(
                    workspace_id=project.workspace_id,
                    project_id=project_id,
                    name=task.name,
                    description_html=task.description_html,
                    description_json=task.description_json,
                    description_binary=task.description_binary,
                    parent=parent_copy,
                    state=task_state,
                    type_id=task.type_id,
                )
                copy.save()
                copies[task.id] = copy

            # Issue.save() appends every new task to the end of its state, so
            # put back the source order explicitly. The WBS numbering and the
            # manual order both read sort_order among siblings.
            for task in ordered_tasks:
                copies[task.id].sort_order = task.sort_order
            Issue.objects.bulk_update(list(copies.values()), ["sort_order"], batch_size=100)

            ModuleIssue.objects.bulk_create(
                [
                    ModuleIssue(
                        module=module,
                        issue=copy,
                        project_id=project_id,
                        workspace_id=project.workspace_id,
                        created_by=request.user,
                        updated_by=request.user,
                    )
                    for copy in copies.values()
                ],
                batch_size=100,
            )

            new_task_ids = [str(copies[task.id].id) for task in ordered_tasks]
            tasks_with_images = [
                str(copies[task.id].id) for task in ordered_tasks if "image-component" in (task.description_html or "")
            ]
            transaction.on_commit(
                lambda: _record_activity(
                    request=request,
                    project_id=str(project_id),
                    module_id=str(module.id),
                    task_ids=new_task_ids,
                    tasks_with_images=tasks_with_images,
                    slug=slug,
                )
            )

        return Response(
            {"id": str(module.id), "name": module.name, "task_count": len(copies)},
            status=status.HTTP_201_CREATED,
        )


def _parents_first(tasks, source_ids):
    """
    Order tasks so a parent always comes before its children. A task whose
    parent is not in the Job is a root of the copy.
    """
    children = {}
    roots = []
    for task in tasks:
        if task.parent_id in source_ids and task.parent_id != task.id:
            children.setdefault(task.parent_id, []).append(task)
        else:
            roots.append(task)

    ordered = []
    seen = set()
    stack = list(reversed(roots))
    while stack:
        task = stack.pop()
        if task.id in seen:
            continue
        seen.add(task.id)
        ordered.append(task)
        stack.extend(reversed(children.get(task.id, [])))

    # A parent cycle has no root to reach it from; copy those tasks flat
    # rather than dropping them
    for task in tasks:
        if task.id not in seen:
            seen.add(task.id)
            ordered.append(task)
    return ordered


def _record_activity(request, project_id, module_id, task_ids, tasks_with_images, slug):
    """History for the new tasks, queued once the copy is committed."""
    epoch = int(timezone.now().timestamp())
    origin = base_host(request=request, is_app=True)
    actor_id = str(request.user.id)
    for task_id in task_ids:
        issue_activity.delay(
            type="issue.activity.created",
            requested_data=json.dumps({"module_id": module_id}),
            actor_id=actor_id,
            issue_id=task_id,
            project_id=project_id,
            current_instance=None,
            epoch=epoch,
            notification=False,
            origin=origin,
        )
        issue_activity.delay(
            type="module.activity.created",
            requested_data=json.dumps({"module_id": module_id}),
            actor_id=actor_id,
            issue_id=task_id,
            project_id=project_id,
            current_instance=None,
            epoch=epoch,
            notification=False,
            origin=origin,
        )
    # Images in a description are files of the source task; give each copy its
    # own files so deleting the source Job never breaks the copy
    for task_id in tasks_with_images:
        copy_s3_objects_of_description_and_assets.delay(
            entity_name="ISSUE",
            entity_identifier=task_id,
            project_id=project_id,
            slug=slug,
            user_id=actor_id,
        )
