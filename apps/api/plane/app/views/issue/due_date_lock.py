# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: admin lock/unlock for a task due date, plus the member-facing change
request workflow that sits behind a locked date.

Locking never changes ``target_date`` itself — it only flips the flag that makes
``plane.utils.date_lock`` refuse member edits. Approving a request *does* change
the date, and does so through the same serializer + activity pipeline the normal
issue update endpoint uses, so activity, notifications, webhooks and dependency
auto-shift all behave exactly as they do for a hand-edited due date.
"""

# Python imports
import json

# Django imports
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import (
    IssueCreateSerializer,
    IssueDetailSerializer,
    IssueDueDateChangeRequestCreateSerializer,
    IssueDueDateChangeRequestReviewSerializer,
    IssueDueDateChangeRequestSerializer,
)
from plane.bgtasks.due_date_request_task import notify_due_date_change_request
from plane.bgtasks.issue_activities_task import issue_activity
from plane.bgtasks.webhook_task import model_activity
from plane.db.models import Issue, IssueDueDateChangeRequest
from plane.utils.date_lock import OVERRIDE_CONTEXT_KEY, normalize_date
from plane.utils.error_codes import ERROR_CODES
from plane.utils.host import base_host

from .. import BaseAPIView


def _error(code, status_code=status.HTTP_400_BAD_REQUEST, **extra):
    return Response(
        {"error_code": ERROR_CODES[code], "error_message": code, **extra},
        status=status_code,
    )


class IssueDueDateLockEndpoint(BaseAPIView):
    """
    Admin-only lock/unlock of a task's due date.

    ``POST``   fixes the due date
    ``DELETE`` releases it

    ``@allow_permission([ROLE.ADMIN])`` is the whole authorisation story here:
    there is deliberately **no** ``creator=True``, so a member or guest who
    created the task gains nothing. (As everywhere else in the app, a workspace
    admin who is an active project member is also treated as an admin.)
    """

    def _get_issue(self, slug, project_id, issue_id):
        return Issue.objects.filter(workspace__slug=slug, project_id=project_id, pk=issue_id).first()

    def _dispatch_activity(self, request, issue, slug, project_id, locked):
        """
        Record the lock change in the normal issue history. ``notification`` is
        left at its default (False) so flipping a lock does not raise in-app
        notifications or property-change emails — it is a governance action, not
        a change to the task's content.
        """
        issue_activity.delay(
            type="issue.activity.updated",
            requested_data=json.dumps({"is_due_date_locked": locked}),
            current_instance=json.dumps({"is_due_date_locked": not locked}),
            issue_id=str(issue.id),
            actor_id=str(request.user.id),
            project_id=str(project_id),
            epoch=int(timezone.now().timestamp()),
            origin=base_host(request=request, is_app=True),
        )

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id, issue_id):
        issue = self._get_issue(slug, project_id, issue_id)
        if issue is None:
            return Response({"error": "Issue not found"}, status=status.HTTP_404_NOT_FOUND)

        if issue.is_due_date_locked:
            return Response(IssueDetailSerializer(issue).data, status=status.HTTP_200_OK)

        issue.is_due_date_locked = True
        issue.due_date_locked_by = request.user
        issue.due_date_locked_at = timezone.now()
        # Explicit field list: locking must never write target_date.
        issue.save(update_fields=["is_due_date_locked", "due_date_locked_by", "due_date_locked_at", "updated_at"])

        self._dispatch_activity(request, issue, slug, project_id, locked=True)
        return Response(IssueDetailSerializer(issue).data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN])
    def delete(self, request, slug, project_id, issue_id):
        issue = self._get_issue(slug, project_id, issue_id)
        if issue is None:
            return Response({"error": "Issue not found"}, status=status.HTTP_404_NOT_FOUND)

        if not issue.is_due_date_locked:
            return _error("DUE_DATE_NOT_LOCKED")

        issue.is_due_date_locked = False
        issue.due_date_locked_by = None
        issue.due_date_locked_at = None
        issue.save(update_fields=["is_due_date_locked", "due_date_locked_by", "due_date_locked_at", "updated_at"])

        self._dispatch_activity(request, issue, slug, project_id, locked=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueDueDateChangeRequestEndpoint(BaseAPIView):
    """
    Member-facing request workflow for a fixed due date.

    ``GET``  lists this task's requests (newest first)
    ``POST`` raises a new ``PENDING`` request

    Submitting a request never touches ``target_date``.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        requests = (
            IssueDueDateChangeRequest.objects.filter(
                workspace__slug=slug, project_id=project_id, issue_id=issue_id
            )
            .select_related("requested_by", "reviewed_by")
            .order_by("-created_at")
        )
        return Response(
            IssueDueDateChangeRequestSerializer(requests, many=True).data,
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, issue_id):
        issue = Issue.objects.filter(workspace__slug=slug, project_id=project_id, pk=issue_id).first()
        if issue is None:
            return Response({"error": "Issue not found"}, status=status.HTTP_404_NOT_FOUND)

        if not issue.is_due_date_locked:
            # Nothing to request: the date is editable, the caller should just edit it.
            return _error("DUE_DATE_NOT_LOCKED")

        serializer = IssueDueDateChangeRequestCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        requested_target_date = serializer.validated_data["requested_target_date"]
        if normalize_date(requested_target_date) == normalize_date(issue.target_date):
            return _error("DUE_DATE_CHANGE_REQUEST_SAME_DATE")

        try:
            # The failed INSERT must be contained, otherwise the constraint
            # violation marks the surrounding transaction unusable and the
            # 409 response below cannot be built.
            with transaction.atomic():
                change_request = IssueDueDateChangeRequest.objects.create(
                    workspace_id=issue.workspace_id,
                    project_id=issue.project_id,
                    issue=issue,
                    requested_by=request.user,
                    requested_target_date=requested_target_date,
                    current_target_date=issue.target_date,
                    reason=serializer.validated_data.get("reason", ""),
                )
        except IntegrityError:
            # The partial unique constraint keeps one PENDING request per task.
            return _error("DUE_DATE_CHANGE_REQUEST_EXISTS", status_code=status.HTTP_409_CONFLICT)

        notify_due_date_change_request.delay(
            change_request_id=str(change_request.id),
            event="requested",
            actor_id=str(request.user.id),
        )
        return Response(
            IssueDueDateChangeRequestSerializer(change_request).data,
            status=status.HTTP_201_CREATED,
        )


class IssueDueDateChangeRequestReviewEndpoint(BaseAPIView):
    """
    Admin approve/reject for a pending fixed-due-date change request.

    Approval applies the requested date through ``IssueCreateSerializer`` with
    the lock override set, then fires the same ``issue_activity`` and
    ``model_activity`` events ``IssueViewSet.partial_update`` fires — so the
    existing due-date side effects (activity row, subscriber notifications,
    property-change email, webhook, dependency auto-shift) all run unchanged.
    """

    def _get_pending(self, slug, project_id, pk):
        return (
            IssueDueDateChangeRequest.objects.filter(workspace__slug=slug, project_id=project_id, pk=pk)
            .select_related("issue")
            .first()
        )

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id, pk, action):
        if action not in ("approve", "reject"):
            return Response({"error": "Invalid action"}, status=status.HTTP_404_NOT_FOUND)

        change_request = self._get_pending(slug, project_id, pk)
        if change_request is None:
            return Response({"error": "Request not found"}, status=status.HTTP_404_NOT_FOUND)

        if change_request.status != IssueDueDateChangeRequest.Status.PENDING:
            return _error("DUE_DATE_CHANGE_REQUEST_NOT_PENDING")

        serializer = IssueDueDateChangeRequestReviewSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        review_comment = serializer.validated_data.get("review_comment", "")

        if action == "reject":
            change_request.status = IssueDueDateChangeRequest.Status.REJECTED
            change_request.reviewed_by = request.user
            change_request.reviewed_at = timezone.now()
            change_request.review_comment = review_comment
            change_request.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_comment", "updated_at"])

            notify_due_date_change_request.delay(
                change_request_id=str(change_request.id),
                event="rejected",
                actor_id=str(request.user.id),
            )
            return Response(
                IssueDueDateChangeRequestSerializer(change_request).data,
                status=status.HTTP_200_OK,
            )

        # --- approve ---
        issue = Issue.objects.filter(
            workspace__slug=slug, project_id=project_id, pk=change_request.issue_id
        ).first()
        if issue is None:
            return Response({"error": "Issue not found"}, status=status.HTTP_404_NOT_FOUND)

        current_instance = json.dumps(IssueDetailSerializer(issue).data, cls=DjangoJSONEncoder)
        payload = {"target_date": change_request.requested_target_date.isoformat()}

        issue_serializer = IssueCreateSerializer(
            issue,
            data=payload,
            partial=True,
            context={
                "project_id": project_id,
                # The reviewer is an admin, so the lock is overridden here by design.
                OVERRIDE_CONTEXT_KEY: True,
            },
        )
        if not issue_serializer.is_valid():
            return Response(issue_serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        issue_serializer.save()

        change_request.status = IssueDueDateChangeRequest.Status.APPROVED
        change_request.reviewed_by = request.user
        change_request.reviewed_at = timezone.now()
        change_request.review_comment = review_comment
        change_request.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_comment", "updated_at"])

        # Same two dispatches IssueViewSet.partial_update makes, so no due-date
        # side effect is bypassed by going through the approval route.
        issue_activity.delay(
            type="issue.activity.updated",
            requested_data=json.dumps(payload, cls=DjangoJSONEncoder),
            actor_id=str(request.user.id),
            issue_id=str(issue.id),
            project_id=str(project_id),
            current_instance=current_instance,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        model_activity.delay(
            model_name="issue",
            model_id=str(issue.id),
            requested_data=payload,
            current_instance=current_instance,
            actor_id=request.user.id,
            slug=slug,
            origin=base_host(request=request, is_app=True),
        )

        notify_due_date_change_request.delay(
            change_request_id=str(change_request.id),
            event="approved",
            actor_id=str(request.user.id),
        )
        return Response(
            IssueDueDateChangeRequestSerializer(change_request).data,
            status=status.HTTP_200_OK,
        )


class WorkspaceDueDateChangeRequestEndpoint(BaseAPIView):
    """
    Cross-project list of fixed-due-date change requests for the admin review UI.

    Scoped to projects where the caller is an active admin, so a member calling
    it simply sees an empty list rather than another project's governance queue.
    Defaults to pending requests; ``?status=`` narrows to any other status.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        requested_status = request.query_params.get("status", IssueDueDateChangeRequest.Status.PENDING)

        requests = (
            IssueDueDateChangeRequest.objects.filter(
                Q(project__project_projectmember__member=request.user),
                Q(project__project_projectmember__role=ROLE.ADMIN.value),
                Q(project__project_projectmember__is_active=True),
                workspace__slug=slug,
                status=requested_status,
                project__archived_at__isnull=True,
            )
            .select_related("requested_by", "reviewed_by", "issue", "issue__project")
            .distinct()
            .order_by("-created_at")
        )

        data = []
        for change_request in requests:
            row = IssueDueDateChangeRequestSerializer(change_request).data
            row["issue_detail"] = {
                "id": str(change_request.issue_id),
                "name": change_request.issue.name,
                "sequence_id": change_request.issue.sequence_id,
                "project_id": str(change_request.issue.project_id),
                "project_identifier": change_request.issue.project.identifier,
            }
            data.append(row)
        return Response(data, status=status.HTTP_200_OK)
