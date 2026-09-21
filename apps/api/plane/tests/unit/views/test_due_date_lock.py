# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: tests for the fixed (admin-controlled) due date and the member
change-request workflow.

Covers the business rules rather than the plumbing: who may lock, who may move a
locked date, that every *write* path is guarded (app PATCH, the gantt bulk date
endpoint and the external API — not just the serializer), that a member can
still move ``start_date`` while the due date is fixed, and the approve/reject
workflow including its one-pending-per-task rule.
"""

from datetime import date
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from plane.db.models import (
    Issue,
    IssueDueDateChangeRequest,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.db.models.api import APIToken

ADMIN, MEMBER, GUEST = 20, 15, 5


class Env:
    """Workspace + project with one user per role, and a task factory."""

    def __init__(self):
        suffix = uuid4().hex[:8]
        self.owner = User.objects.create(email=f"owner-{suffix}@geotech3d.test", username=f"owner_{suffix}")
        self.workspace = Workspace.objects.create(
            name=f"WS {suffix}", owner=self.owner, slug=f"ws-{suffix}"
        )
        self.project = Project.objects.create(
            name=f"Project {suffix}",
            workspace=self.workspace,
            identifier=f"P{suffix[:4].upper()}",
            timezone="UTC",
        )
        self.state = State.objects.create(
            project=self.project, workspace=self.workspace, name="In Progress", group="started", color="#000"
        )

        self.admin = self._user("admin", suffix, ADMIN)
        self.member = self._user("member", suffix, MEMBER)
        self.guest = self._user("guest", suffix, GUEST)

    def _user(self, role_name, suffix, role):
        user = User.objects.create(
            email=f"{role_name}-{suffix}@geotech3d.test", username=f"{role_name}_{suffix}"
        )
        # Workspace role mirrors the project role so the workspace-admin
        # escalation in allow_permission never silently promotes a member.
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=role, is_active=True)
        ProjectMember.objects.create(
            workspace=self.workspace, project=self.project, member=user, role=role, is_active=True
        )
        return user

    def issue(self, *, created_by=None, start=None, target=date(2026, 9, 10), locked=False):
        issue = Issue.objects.create(
            project=self.project,
            workspace=self.workspace,
            name="Borehole log",
            state=self.state,
            start_date=start,
            target_date=target,
            is_due_date_locked=locked,
        )
        if created_by is not None:
            # BaseModel.save() derives created_by from the request user, which is
            # absent here, so set it after the fact.
            Issue.objects.filter(pk=issue.pk).update(created_by=created_by)
            issue.refresh_from_db()
        return issue

    def client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    # --- URL helpers -----------------------------------------------------
    @property
    def base(self):
        return f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}"

    def issue_url(self, issue):
        return f"{self.base}/issues/{issue.id}/"

    def lock_url(self, issue):
        return f"{self.base}/issues/{issue.id}/due-date-lock/"

    def request_url(self, issue):
        return f"{self.base}/issues/{issue.id}/due-date-change-requests/"

    def review_url(self, change_request, action):
        return f"{self.base}/due-date-change-requests/{change_request.id}/{action}/"

    @property
    def bulk_dates_url(self):
        return f"{self.base}/issue-dates/"

    def external_issue_url(self, issue):
        return f"/api/v1/workspaces/{self.workspace.slug}/projects/{self.project.id}/issues/{issue.id}/"


@pytest.fixture
def env(db, monkeypatch):
    # Celery is not running in tests; the lock rules under test are synchronous.
    for target in (
        "plane.bgtasks.issue_activities_task.issue_activity.delay",
        "plane.bgtasks.webhook_task.model_activity.delay",
        "plane.bgtasks.issue_description_version_task.issue_description_version_task.delay",
        "plane.bgtasks.due_date_request_task.notify_due_date_change_request.delay",
    ):
        monkeypatch.setattr(target, lambda *a, **k: None)
    return Env()


def _target(issue):
    issue.refresh_from_db()
    return issue.target_date


@pytest.mark.unit
class TestLockPermissions:
    def test_admin_can_lock(self, env):
        issue = env.issue()
        response = env.client(env.admin).post(env.lock_url(issue))
        assert response.status_code == 200
        issue.refresh_from_db()
        assert issue.is_due_date_locked is True
        assert issue.due_date_locked_by_id == env.admin.id
        assert issue.due_date_locked_at is not None

    def test_admin_can_unlock(self, env):
        issue = env.issue(locked=True)
        response = env.client(env.admin).delete(env.lock_url(issue))
        assert response.status_code == 204
        issue.refresh_from_db()
        assert issue.is_due_date_locked is False
        assert issue.due_date_locked_by_id is None
        assert issue.due_date_locked_at is None

    def test_member_cannot_lock(self, env):
        issue = env.issue()
        assert env.client(env.member).post(env.lock_url(issue)).status_code == 403
        assert _target(issue) == date(2026, 9, 10)
        issue.refresh_from_db()
        assert issue.is_due_date_locked is False

    def test_member_cannot_unlock(self, env):
        issue = env.issue(locked=True)
        assert env.client(env.member).delete(env.lock_url(issue)).status_code == 403
        issue.refresh_from_db()
        assert issue.is_due_date_locked is True

    def test_guest_cannot_lock(self, env):
        issue = env.issue()
        assert env.client(env.guest).post(env.lock_url(issue)).status_code == 403

    def test_creator_who_is_not_admin_cannot_lock_or_unlock(self, env):
        """The lock endpoint deliberately has no ``creator=True`` bypass."""
        issue = env.issue(created_by=env.member)
        assert env.client(env.member).post(env.lock_url(issue)).status_code == 403

        locked = env.issue(created_by=env.member, locked=True)
        assert env.client(env.member).delete(env.lock_url(locked)).status_code == 403
        locked.refresh_from_db()
        assert locked.is_due_date_locked is True

    def test_locking_does_not_change_target_date(self, env):
        issue = env.issue(target=date(2026, 9, 10))
        env.client(env.admin).post(env.lock_url(issue))
        assert _target(issue) == date(2026, 9, 10)


@pytest.mark.unit
class TestManualDateEditing:
    def test_member_cannot_change_locked_due_date(self, env):
        issue = env.issue(locked=True)
        response = env.client(env.member).patch(
            env.issue_url(issue), {"target_date": "2026-10-01"}, format="json"
        )
        assert response.status_code == 400
        assert response.json()["error_message"] == "DUE_DATE_LOCKED"
        assert _target(issue) == date(2026, 9, 10)

    def test_creator_member_cannot_change_locked_due_date(self, env):
        """`creator=True` on partial_update must not become a lock bypass."""
        issue = env.issue(created_by=env.member, locked=True)
        response = env.client(env.member).patch(
            env.issue_url(issue), {"target_date": "2026-10-01"}, format="json"
        )
        assert response.status_code == 400
        assert _target(issue) == date(2026, 9, 10)

    def test_admin_can_change_locked_due_date(self, env):
        issue = env.issue(locked=True)
        response = env.client(env.admin).patch(
            env.issue_url(issue), {"target_date": "2026-10-01"}, format="json"
        )
        assert response.status_code == 204
        assert _target(issue) == date(2026, 10, 1)

    def test_member_can_change_unlocked_due_date(self, env):
        issue = env.issue()
        response = env.client(env.member).patch(
            env.issue_url(issue), {"target_date": "2026-10-01"}, format="json"
        )
        assert response.status_code == 204
        assert _target(issue) == date(2026, 10, 1)

    def test_resending_the_same_locked_date_is_a_noop_not_an_error(self, env):
        """A full-issue PATCH that happens to echo the date must not be rejected."""
        issue = env.issue(locked=True)
        response = env.client(env.member).patch(
            env.issue_url(issue), {"target_date": "2026-09-10", "name": "Renamed"}, format="json"
        )
        assert response.status_code == 204
        issue.refresh_from_db()
        assert issue.name == "Renamed"
        assert issue.target_date == date(2026, 9, 10)


@pytest.mark.unit
class TestStartDateEdgeCase:
    def test_member_can_change_start_date_while_due_date_is_locked(self, env):
        issue = env.issue(start=date(2026, 9, 1), locked=True)
        response = env.client(env.member).patch(
            env.issue_url(issue), {"start_date": "2026-09-03"}, format="json"
        )
        assert response.status_code == 204
        issue.refresh_from_db()
        assert issue.start_date == date(2026, 9, 3)
        assert issue.target_date == date(2026, 9, 10)

    def test_start_date_change_carrying_a_recalculated_target_is_rejected(self, env):
        """
        The duration-driven working-days flow can send target_date alongside
        start_date. The lock must still refuse the due-date part rather than
        letting a start-date edit quietly move a fixed date.
        """
        issue = env.issue(start=date(2026, 9, 1), locked=True)
        response = env.client(env.member).patch(
            env.issue_url(issue),
            {"start_date": "2026-09-03", "target_date": "2026-09-15"},
            format="json",
        )
        assert response.status_code == 400
        assert response.json()["error_message"] == "DUE_DATE_LOCKED"
        issue.refresh_from_db()
        assert issue.start_date == date(2026, 9, 1)
        assert issue.target_date == date(2026, 9, 10)


@pytest.mark.unit
class TestGanttBulkDateEndpoint:
    def test_member_cannot_move_locked_date_through_bulk_endpoint(self, env):
        issue = env.issue(locked=True)
        response = env.client(env.member).post(
            env.bulk_dates_url,
            {"updates": [{"id": str(issue.id), "target_date": "2026-10-01"}]},
            format="json",
        )
        assert response.status_code == 400
        assert response.json()["error_message"] == "DUE_DATE_LOCKED"
        assert str(issue.id) in response.json()["issue_ids"]
        assert _target(issue) == date(2026, 9, 10)

    def test_client_supplied_auto_shift_marker_cannot_bypass_the_lock(self, env):
        issue = env.issue(locked=True)
        response = env.client(env.member).post(
            env.bulk_dates_url,
            {
                "updates": [
                    {"id": str(issue.id), "target_date": "2026-10-01", "dependency_auto_shift": True}
                ]
            },
            format="json",
        )
        assert response.status_code == 400
        assert _target(issue) == date(2026, 9, 10)

    def test_whole_batch_is_rejected_so_a_drag_never_half_lands(self, env):
        locked = env.issue(locked=True)
        free = env.issue()
        response = env.client(env.member).post(
            env.bulk_dates_url,
            {
                "updates": [
                    {"id": str(free.id), "target_date": "2026-10-05"},
                    {"id": str(locked.id), "target_date": "2026-10-01"},
                ]
            },
            format="json",
        )
        assert response.status_code == 400
        assert _target(free) == date(2026, 9, 10)
        assert _target(locked) == date(2026, 9, 10)

    def test_member_can_move_start_date_of_a_locked_task_through_bulk_endpoint(self, env):
        issue = env.issue(start=date(2026, 9, 1), locked=True)
        response = env.client(env.member).post(
            env.bulk_dates_url,
            {"updates": [{"id": str(issue.id), "start_date": "2026-09-02"}]},
            format="json",
        )
        assert response.status_code == 200
        issue.refresh_from_db()
        assert issue.start_date == date(2026, 9, 2)
        assert issue.target_date == date(2026, 9, 10)

    def test_admin_can_move_locked_date_through_bulk_endpoint(self, env):
        issue = env.issue(locked=True)
        response = env.client(env.admin).post(
            env.bulk_dates_url,
            {"updates": [{"id": str(issue.id), "target_date": "2026-10-01"}]},
            format="json",
        )
        assert response.status_code == 200
        assert _target(issue) == date(2026, 10, 1)


@pytest.mark.unit
class TestExternalApi:
    def _token_client(self, user):
        token = APIToken.objects.create(user=user, label="test", token=f"tok-{uuid4().hex}")
        client = APIClient()
        client.credentials(HTTP_X_API_KEY=token.token)
        return client

    def test_member_cannot_change_locked_due_date_via_external_api(self, env):
        issue = env.issue(locked=True)
        response = self._token_client(env.member).patch(
            env.external_issue_url(issue), {"target_date": "2026-10-01"}, format="json"
        )
        assert response.status_code == 400
        assert _target(issue) == date(2026, 9, 10)

    def test_admin_can_change_locked_due_date_via_external_api(self, env):
        issue = env.issue(locked=True)
        response = self._token_client(env.admin).patch(
            env.external_issue_url(issue), {"target_date": "2026-10-01"}, format="json"
        )
        assert response.status_code == 200
        assert _target(issue) == date(2026, 10, 1)

    def test_lock_flag_is_not_writable_through_the_generic_update(self, env):
        """A member must not be able to unlock themselves in the same payload."""
        issue = env.issue(locked=True)
        response = self._token_client(env.member).patch(
            env.external_issue_url(issue),
            {"is_due_date_locked": False, "target_date": "2026-10-01"},
            format="json",
        )
        assert response.status_code == 400
        issue.refresh_from_db()
        assert issue.is_due_date_locked is True
        assert issue.target_date == date(2026, 9, 10)


@pytest.mark.unit
class TestChangeRequestWorkflow:
    def _submit(self, env, issue, user=None, target="2026-10-01", reason="Rig delayed"):
        return env.client(user or env.member).post(
            env.request_url(issue),
            {"requested_target_date": target, "reason": reason},
            format="json",
        )

    def test_member_can_submit_a_request_for_a_locked_task(self, env):
        issue = env.issue(locked=True)
        response = self._submit(env, issue)
        assert response.status_code == 201

        change_request = IssueDueDateChangeRequest.objects.get(issue=issue)
        assert change_request.status == IssueDueDateChangeRequest.Status.PENDING
        assert change_request.requested_by_id == env.member.id
        assert change_request.requested_target_date == date(2026, 10, 1)
        assert change_request.current_target_date == date(2026, 9, 10)
        assert change_request.reason == "Rig delayed"
        assert change_request.reviewed_by_id is None
        assert change_request.reviewed_at is None
        # Submitting must never touch the task itself.
        assert _target(issue) == date(2026, 9, 10)

    def test_request_on_an_unlocked_task_is_rejected(self, env):
        issue = env.issue()
        response = self._submit(env, issue)
        assert response.status_code == 400
        assert response.json()["error_message"] == "DUE_DATE_NOT_LOCKED"

    def test_request_for_the_same_date_is_rejected(self, env):
        issue = env.issue(locked=True)
        response = self._submit(env, issue, target="2026-09-10")
        assert response.status_code == 400
        assert response.json()["error_message"] == "DUE_DATE_CHANGE_REQUEST_SAME_DATE"

    def test_duplicate_pending_request_is_prevented(self, env):
        issue = env.issue(locked=True)
        assert self._submit(env, issue).status_code == 201
        second = self._submit(env, issue, target="2026-10-09")
        assert second.status_code == 409
        assert second.json()["error_message"] == "DUE_DATE_CHANGE_REQUEST_EXISTS"
        assert IssueDueDateChangeRequest.objects.filter(issue=issue).count() == 1

    def test_admin_can_approve_and_the_due_date_actually_changes(self, env):
        issue = env.issue(locked=True)
        self._submit(env, issue)
        change_request = IssueDueDateChangeRequest.objects.get(issue=issue)

        response = env.client(env.admin).post(env.review_url(change_request, "approve"), {}, format="json")
        assert response.status_code == 200

        change_request.refresh_from_db()
        assert change_request.status == IssueDueDateChangeRequest.Status.APPROVED
        assert change_request.reviewed_by_id == env.admin.id
        assert change_request.reviewed_at is not None
        assert _target(issue) == date(2026, 10, 1)
        # The task stays locked; approving grants one change, not a permanent unlock.
        issue.refresh_from_db()
        assert issue.is_due_date_locked is True

    def test_admin_can_reject_without_changing_the_due_date(self, env):
        issue = env.issue(locked=True)
        self._submit(env, issue)
        change_request = IssueDueDateChangeRequest.objects.get(issue=issue)

        response = env.client(env.admin).post(
            env.review_url(change_request, "reject"), {"review_comment": "Client committed"}, format="json"
        )
        assert response.status_code == 200

        change_request.refresh_from_db()
        assert change_request.status == IssueDueDateChangeRequest.Status.REJECTED
        assert change_request.reviewed_by_id == env.admin.id
        assert change_request.reviewed_at is not None
        assert change_request.review_comment == "Client committed"
        assert _target(issue) == date(2026, 9, 10)

    def test_member_cannot_approve(self, env):
        issue = env.issue(locked=True)
        self._submit(env, issue)
        change_request = IssueDueDateChangeRequest.objects.get(issue=issue)

        response = env.client(env.member).post(env.review_url(change_request, "approve"), {}, format="json")
        assert response.status_code == 403
        assert _target(issue) == date(2026, 9, 10)

    def test_requester_cannot_approve_their_own_request(self, env):
        issue = env.issue(locked=True)
        self._submit(env, issue)
        change_request = IssueDueDateChangeRequest.objects.get(issue=issue)
        assert env.client(env.member).post(env.review_url(change_request, "reject"), {}, format="json").status_code == 403

    def test_reviewing_a_settled_request_is_rejected(self, env):
        issue = env.issue(locked=True)
        self._submit(env, issue)
        change_request = IssueDueDateChangeRequest.objects.get(issue=issue)
        env.client(env.admin).post(env.review_url(change_request, "approve"), {}, format="json")

        second = env.client(env.admin).post(env.review_url(change_request, "reject"), {}, format="json")
        assert second.status_code == 400
        assert second.json()["error_message"] == "DUE_DATE_CHANGE_REQUEST_NOT_PENDING"

    def test_a_new_request_is_allowed_once_the_previous_one_is_settled(self, env):
        issue = env.issue(locked=True)
        self._submit(env, issue)
        change_request = IssueDueDateChangeRequest.objects.get(issue=issue)
        env.client(env.admin).post(env.review_url(change_request, "reject"), {}, format="json")

        assert self._submit(env, issue, target="2026-11-02").status_code == 201
        assert IssueDueDateChangeRequest.objects.filter(issue=issue).count() == 2

    def test_workspace_review_queue_is_admin_scoped(self, env):
        issue = env.issue(locked=True)
        self._submit(env, issue)
        url = f"/api/workspaces/{env.workspace.slug}/due-date-change-requests/"

        admin_rows = env.client(env.admin).get(url).json()
        assert len(admin_rows) == 1
        assert admin_rows[0]["issue_detail"]["sequence_id"] == issue.sequence_id

        # A member is not an admin of any project, so the queue is empty for them.
        assert env.client(env.member).get(url).json() == []


@pytest.mark.unit
class TestLockFlagIsSerialised:
    """
    The web client decides whether to show a member the date picker or the
    "fixed" affordance from ``is_due_date_locked`` on whatever payload hydrated
    the task. Every *list* endpoint therefore has to carry the flag, not just the
    detail one: a list that omits it makes the store read ``undefined``, the
    member gets an editable picker, and the only feedback is the server refusing
    the write. These endpoints each build their field set by hand, so a new one
    silently reintroduces that gap.
    """

    def _rows(self, response):
        payload = response.json()
        rows = payload.get("results", payload) if isinstance(payload, dict) else payload
        # grouped layouts nest the rows one level deeper
        if isinstance(rows, dict):
            rows = next(iter(rows.values()), [])
        return rows

    def _row_for(self, response, issue):
        return next((r for r in self._rows(response) if str(r["id"]) == str(issue.id)), None)

    def test_detail_endpoint_exposes_the_flag(self, env):
        issue = env.issue(locked=True)
        body = env.client(env.member).get(env.issue_url(issue)).json()
        assert body["is_due_date_locked"] is True

    def test_project_issue_list_exposes_the_flag(self, env):
        issue = env.issue(locked=True)
        row = self._row_for(env.client(env.member).get(f"{env.base}/issues/"), issue)
        assert row is not None, "task missing from the project list"
        assert row["is_due_date_locked"] is True

    def test_workspace_issue_list_exposes_the_flag(self, env):
        """Feeds "My Work" and the global views, via ViewIssueListSerializer."""
        issue = env.issue(locked=True)
        response = env.client(env.member).get(f"/api/workspaces/{env.workspace.slug}/issues/")
        row = self._row_for(response, issue)
        assert row is not None, "task missing from the workspace list"
        assert row["is_due_date_locked"] is True

    def test_unlocked_task_reports_false_not_missing(self, env):
        """An absent key and ``False`` are the same thing to the client, so the
        unlocked case has to be explicit rather than merely falsy."""
        issue = env.issue(locked=False)
        row = self._row_for(env.client(env.member).get(f"{env.base}/issues/"), issue)
        assert "is_due_date_locked" in row
        assert row["is_due_date_locked"] is False
