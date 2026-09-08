# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db.models import Q

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseAPIView
from plane.app.permissions import ProjectEntityPermission, WorkspaceEntityPermission
from plane.db.models import IssueDependencySchedule


class IssueDependencyScheduleEndpoint(BaseAPIView):
    """
    Read-only projection of the dependency-aware schedule for one work item.

    Returns whether the work item is *dependency delayed* — pushed forward by a
    delayed ``blocked_by`` dependency — together with the adjusted dates and the
    upstream work item causing the delay. The projection is maintained by
    ``plane.bgtasks.dependency_schedule_task``; the work item's own dates are
    never modified.
    """

    permission_classes = [ProjectEntityPermission]

    def get(self, request, slug, project_id, issue_id):
        schedule = (
            IssueDependencySchedule.objects.filter(
                workspace__slug=slug, project_id=project_id, issue_id=issue_id
            )
            .select_related("delayed_by", "delayed_by__project")
            .first()
        )
        if schedule is None:
            return Response({"is_dependency_delayed": False}, status=status.HTTP_200_OK)

        delayed_by = schedule.delayed_by
        return Response(
            {
                "is_dependency_delayed": True,
                "dependency_finish_date": schedule.dependency_finish_date,
                "adjusted_start_date": schedule.adjusted_start_date,
                "adjusted_target_date": schedule.adjusted_target_date,
                "delayed_by": {
                    "id": str(delayed_by.id),
                    "name": delayed_by.name,
                    "sequence_id": delayed_by.sequence_id,
                    "project_id": str(delayed_by.project_id),
                    "project_identifier": delayed_by.project.identifier,
                },
                "updated_at": schedule.updated_at,
            },
            status=status.HTTP_200_OK,
        )


class WorkspaceDependencyScheduleEndpoint(BaseAPIView):
    """
    Read-only list of every dependency-delay projection the user is allowed to see
    in a workspace. Powers cross-project surfaces such as the employee resource
    gantt, which would otherwise have to call the per-issue endpoint once per bar.

    Visibility mirrors the workspace work item list: full members see every
    project they belong to; guests see projects with ``guest_view_all_features``
    or only work items they created.
    """

    permission_classes = [WorkspaceEntityPermission]

    def get(self, request, slug):
        schedules = (
            IssueDependencySchedule.objects.filter(
                Q(
                    Q(
                        project__project_projectmember__role=5,
                        project__guest_view_all_features=True,
                    )
                    | Q(
                        project__project_projectmember__role=5,
                        project__guest_view_all_features=False,
                        issue__created_by=request.user,
                    )
                    | Q(project__project_projectmember__role__gt=5),
                    project__project_projectmember__member=request.user,
                    project__project_projectmember__is_active=True,
                ),
                workspace__slug=slug,
                project__archived_at__isnull=True,
            )
            .select_related("delayed_by", "delayed_by__project")
            .distinct()
        )
        return Response(
            [
                {
                    "issue_id": str(schedule.issue_id),
                    "dependency_finish_date": schedule.dependency_finish_date,
                    "adjusted_start_date": schedule.adjusted_start_date,
                    "adjusted_target_date": schedule.adjusted_target_date,
                    "delayed_by": {
                        "id": str(schedule.delayed_by.id),
                        "name": schedule.delayed_by.name,
                        "sequence_id": schedule.delayed_by.sequence_id,
                        "project_id": str(schedule.delayed_by.project_id),
                        "project_identifier": schedule.delayed_by.project.identifier,
                    },
                }
                for schedule in schedules
            ],
            status=status.HTTP_200_OK,
        )
