# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: what a guest is allowed to see and change.

Upstream Plane treats a guest as a spectator. On a container with
``guest_view_all_features=False`` a guest only ever sees the tasks they created
themselves, and may never edit a task. Geotech3D hands guests real work: an
external collaborator gets a task assigned to them, moves it along its states
and comments on it. So the scope widens to "created by me **or** assigned to
me", and a guest may change the *state* of a task assigned to them - nothing
else. A guest still cannot create, delete or otherwise edit tasks.

The visibility rule has no single chokepoint - every endpoint that returns
tasks re-implements it - so it lives here and is called from each of them:

* ``IssueViewSet.list`` / ``.retrieve``          - app/views/issue/base.py
* ``IssueListEndpoint.get``                      - the ids-in-query list
* ``IssueDetailEndpoint`` / ``IssueDetailIdentifierEndpoint``
* ``IssuePaginatedViewSet.list``                 - the sync/pagination feed
* ``IssueCommentViewSet.create``                 - who may comment
* ``WorkItemDescriptionVersionEndpoint.get``     - description history
* ``WorkspaceViewIssuesViewSet``                 - workspace-level saved views
* ``WorkspaceDependencyScheduleEndpoint``        - cross-container gantt

The write rule has one: ``IssueViewSet.partial_update``, which reaches a guest
only through the ``assignee=True`` bypass in ``allow_permission``.

``guest_view_all_features=True`` short-circuits all of it: that guest reads the
whole container, as before.
"""

# Django imports
from django.db.models import Q

# Module imports
from plane.db.models import IssueAssignee, ProjectMember, WorkspaceMember

# Member roles. Mirrors ``ROLE`` in ``plane.app.permissions``, duplicated here
# to keep this module free of a dependency on the app layer.
GUEST_ROLE = 5
ADMIN_ROLE = 20

# The only fields a guest may change on a task assigned to them. Everything
# else in the payload is dropped before it reaches the serializer.
GUEST_ASSIGNEE_EDITABLE_FIELDS = frozenset({"state_id"})


def assigned_issue_ids(user):
    """Issue ids ``user`` is currently an assignee of, as a subquery."""
    return IssueAssignee.objects.filter(assignee=user, deleted_at__isnull=True).values("issue_id")


def guest_issue_scope_q(user, prefix=""):
    """``Q`` selecting the tasks a restricted guest may see.

    ``prefix`` is the lookup path to the Issue from the model being filtered,
    e.g. ``"issue__"`` when filtering ``IssueDependencySchedule``.
    """
    return Q(**{f"{prefix}created_by": user}) | Q(**{f"{prefix}id__in": assigned_issue_ids(user)})


def is_restricted_guest(user, slug, project_id):
    """True when ``user`` is a guest on this container without full view access."""
    return ProjectMember.objects.filter(
        workspace__slug=slug,
        project_id=project_id,
        member=user,
        role=GUEST_ROLE,
        is_active=True,
        project__guest_view_all_features=False,
    ).exists()


def is_guest(user, slug, project_id):
    """True when ``user`` acts as a guest on this container, view access aside.

    A workspace admin listed as a guest on the container is not one:
    ``allow_permission`` already lets them through with full rights, so the
    write restrictions below must not clamp them.
    """
    if WorkspaceMember.objects.filter(workspace__slug=slug, member=user, role=ADMIN_ROLE, is_active=True).exists():
        return False
    return ProjectMember.objects.filter(
        workspace__slug=slug,
        project_id=project_id,
        member=user,
        role=GUEST_ROLE,
        is_active=True,
    ).exists()


def is_issue_in_guest_scope(issue, user):
    """True when a restricted guest may see this one task."""
    return issue.created_by_id == user.id or is_issue_assignee(issue, user)


def is_issue_assignee(issue, user):
    """True when ``user`` is currently an assignee of ``issue``."""
    return IssueAssignee.objects.filter(issue_id=issue.id, assignee=user, deleted_at__isnull=True).exists()


def narrow_payload_for_guest_assignee(data):
    """Keep only the fields a guest assignee may write.

    Mirrors how ``IntakeIssueViewSet.partial_update`` narrows a guest's payload:
    extra fields are dropped rather than rejected, so a UI that bundles a few
    into one PATCH still moves the state. The caller answers 403 when nothing
    writable is left - a guest asking only for something they may not change.
    """
    return {key: value for key, value in data.items() if key in GUEST_ASSIGNEE_EDITABLE_FIELDS}
