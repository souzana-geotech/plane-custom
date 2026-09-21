# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: enforcement helpers for a fixed (admin-controlled) task due date.

``Issue.is_due_date_locked`` protects ``target_date`` only — ``start_date`` stays
editable by members by design. Because ``Issue.save()`` is bypassed by the two
``bulk_update`` call sites that write dates (the gantt bulk endpoint and the
dependency auto-shift task), there is no single chokepoint to hang this rule on.
The rule therefore lives in one place here and is called from four:

* ``IssueCreateSerializer.validate``            - app API create/update
* ``IssueBulkUpdateDateEndpoint.post``          - gantt bulk date writes
* ``IssueSerializer.validate`` (external API)   - ``/api/v1`` writes
* ``_is_shiftable`` in the auto-shift task      - dependency propagation

Only a *project admin* may change a locked due date directly. Everyone else goes
through the ``IssueDueDateChangeRequest`` approval workflow.
"""

# Python imports
from datetime import date, datetime

# Third party imports
from rest_framework import serializers

# Module imports
from plane.utils.error_codes import ERROR_CODES

# Key used to pass the override decision into serializer context. Absent means
# "not allowed to override", so a caller that forgets to pass it fails closed.
OVERRIDE_CONTEXT_KEY = "can_override_due_date_lock"

DUE_DATE_LOCKED_ERROR = {
    "error_code": ERROR_CODES["DUE_DATE_LOCKED"],
    "error_message": "DUE_DATE_LOCKED",
}


def normalize_date(value):
    """
    Coerce a date-ish value (``date``, ``datetime``, ISO string, ``None``) to a
    ``datetime.date`` so values coming from serializers, request bodies and the
    database can be compared consistently. Unparseable input returns ``None``.
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def is_due_date_change(issue, requested_target_date):
    """True when ``requested_target_date`` actually differs from the issue's."""
    return normalize_date(issue.target_date) != normalize_date(requested_target_date)


def is_due_date_locked(issue):
    """True when the task's due date is fixed by an admin."""
    return bool(getattr(issue, "is_due_date_locked", False))


def blocks_due_date_change(issue, requested_target_date, can_override=False):
    """
    The single rule. True when this change must be refused.

    Refused when the task's due date is locked, the caller may not override the
    lock, and the requested value would actually change the stored date. Sending
    the *same* date back is a no-op and is always allowed, so clients that PATCH
    a whole issue payload unchanged are never broken by the lock.
    """
    if can_override or not is_due_date_locked(issue):
        return False
    return is_due_date_change(issue, requested_target_date)


def assert_due_date_editable(issue, requested_target_date, can_override=False):
    """Serializer-side guard; raises ``ValidationError`` carrying the error code."""
    if blocks_due_date_change(issue, requested_target_date, can_override):
        raise serializers.ValidationError(DUE_DATE_LOCKED_ERROR)


def can_manage_due_date_lock(user, workspace_slug, project_id):
    """
    True when ``user`` may lock/unlock a due date and override a locked one.

    Project admins qualify. Workspace admins who are active members of the
    project also qualify, matching the escalation ``allow_permission`` already
    grants everywhere else in the app (see ``plane.app.permissions.base``).
    Task authorship grants nothing here - there is deliberately no creator
    bypass for the lock.
    """
    # imported lazily to keep this module importable from model-level code
    from plane.db.models import ProjectMember, WorkspaceMember
    from plane.db.models.project import ROLE

    if user is None or user.is_anonymous:
        return False

    if ProjectMember.objects.filter(
        member=user,
        workspace__slug=workspace_slug,
        project_id=project_id,
        role=ROLE.ADMIN.value,
        is_active=True,
    ).exists():
        return True

    return (
        ProjectMember.objects.filter(
            member=user,
            workspace__slug=workspace_slug,
            project_id=project_id,
            is_active=True,
        ).exists()
        and WorkspaceMember.objects.filter(
            member=user,
            workspace__slug=workspace_slug,
            role=ROLE.ADMIN.value,
            is_active=True,
        ).exists()
    )
