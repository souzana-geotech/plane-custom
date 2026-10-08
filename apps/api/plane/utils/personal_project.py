# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: "My Space" - one private place per person, the same from every
workspace.

My Space is a **personal workspace** (``Workspace.is_personal``) owned by one
person and holding exactly one **personal container** (``Project.is_personal``,
identifier ``MY``, so tasks read MY-1, MY-2). Every company workspace links to
it; the web app opens it with a way back to the workspace you came from.

Living in its own workspace is what keeps it private: workspace admins of the
company workspaces have no role in it at all, and the rest of the API already
scopes every read to the workspace in the URL plus active membership (see
``plane.utils.project_access``). The rules below keep it that way:

* **One per person**, created the first time its owner opens it
  (``get_or_create_my_space``). Nothing is created at deploy time.
* **Only for ADMIN or MEMBER of a company workspace** - a pure guest does not
  get one. Someone demoted later keeps theirs: it is their own data and lives
  outside the workspace they were demoted in.
* **Only the owner is ever a member** - of the workspace and of the container.
  Workspace invites, joins and member changes are refused, and so are
  container member adds, invites, joins and changes.
* **Fixed shape**: the workspace cannot be renamed, deleted or given a second
  container; the container cannot be deleted, archived, published or made
  public.
* **Sealed**: no task relation crosses into or out of the container, webhooks
  never carry its events, and the instance-admin (god-mode) workspace list
  leaves personal workspaces out.
"""

# Python imports
import uuid

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Q

# Module imports
from plane.db.models import (
    Project,
    ProjectIdentifier,
    ProjectMember,
    State,
    Workspace,
    WorkspaceMember,
)
from plane.db.models.state import DEFAULT_STATES

ADMIN_ROLE = 20
MEMBER_ROLE = 15

MY_SPACE_NAME = "My Space"
MY_SPACE_IDENTIFIER = "MY"
# Personal workspace slugs. Reserved: company workspaces may not use it.
MY_SPACE_SLUG_PREFIX = "my-space-"
# Error code for refused operations on My Space; the web app shows its own
# message for it.
PERSONAL_PROJECT_ERROR = "PERSONAL_PROJECT_LOCKED"


class NotEligibleForMySpace(Exception):
    """The user is not an ADMIN or MEMBER of any company workspace."""


def personal_project_error(message):
    return {"error": message, "error_code": PERSONAL_PROJECT_ERROR}


def hidden_personal_projects_q(user, prefix=""):
    """``Q`` matching the personal containers ``user`` must not see.

    ``prefix`` is the lookup path to the Project, e.g. ``"project__"``.
    Use with ``.exclude(...)``.
    """
    return Q(**{f"{prefix}is_personal": True}) & ~Q(**{f"{prefix}owner": user})


def is_personal_project(project_id):
    if project_id is None:
        return False
    return Project.objects.filter(pk=project_id, is_personal=True).exists()


def is_others_personal_project(project_id, user):
    """True for a personal container that does not belong to ``user``."""
    if project_id is None:
        return False
    return Project.objects.filter(pk=project_id, is_personal=True).exclude(owner=user).exists()


def is_personal_workspace(slug):
    if not slug:
        return False
    return Workspace.objects.filter(slug=slug, is_personal=True).exists()


def is_reserved_workspace_slug(slug):
    return bool(slug) and slug.lower().startswith(MY_SPACE_SLUG_PREFIX)


def is_eligible_for_my_space(user):
    return (
        WorkspaceMember.objects.filter(
            member=user, is_active=True, role__gte=MEMBER_ROLE, workspace__is_personal=False
        )
        .exists()
    )


def _my_space_slug(user):
    # Derived from the user id: stable, unique, and reveals nothing about
    # who the user is. 9 + 32 characters fits the 48-character slug field.
    return f"{MY_SPACE_SLUG_PREFIX}{uuid.UUID(str(user.id)).hex}"


def _create_my_space(user):
    with transaction.atomic():
        workspace = Workspace.objects.create(
            name=MY_SPACE_NAME,
            slug=_my_space_slug(user),
            owner=user,
            is_personal=True,
            timezone=getattr(user, "user_timezone", None) or "UTC",
        )
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=ADMIN_ROLE)

        project = Project.objects.create(
            name=MY_SPACE_NAME,
            identifier=MY_SPACE_IDENTIFIER,
            workspace=workspace,
            network=0,
            is_personal=True,
            owner=user,
            # Tasks and pages only: Jobs, cycles, views and requests are team
            # features.
            module_view=False,
            cycle_view=False,
            issue_views_view=False,
            intake_view=False,
            page_view=True,
        )
        ProjectIdentifier.objects.create(name=project.identifier, project=project, workspace=workspace)
        # ``save`` (not ``bulk_create``) so ProjectMember creates the
        # ProjectUserProperty row the web app expects.
        ProjectMember.objects.create(project=project, member=user, workspace=workspace, role=ADMIN_ROLE)
        State.objects.bulk_create(
            [
                State(
                    name=state["name"],
                    color=state["color"],
                    project=project,
                    sequence=state["sequence"],
                    workspace=workspace,
                    group=state["group"],
                    default=state.get("default", False),
                    created_by=user,
                )
                for state in DEFAULT_STATES
            ]
        )
    return workspace


def _ensure_owner_membership(manager, user, **lookup):
    """The owner is always an active admin of their own workspace/container."""
    membership = manager.filter(member=user, **lookup).order_by("-created_at").first()
    if membership.is_active and membership.role == ADMIN_ROLE and membership.deleted_at is None:
        return
    membership.is_active = True
    membership.role = ADMIN_ROLE
    membership.deleted_at = None
    membership.save(update_fields=["is_active", "role", "deleted_at", "updated_at"])


def get_or_create_my_space(user):
    """Return ``(workspace, project)`` for ``user``'s My Space, creating it once.

    Raises ``NotEligibleForMySpace`` when a user without one is not an ADMIN or
    MEMBER of any company workspace.
    """
    workspace = Workspace.objects.filter(owner=user, is_personal=True).first()
    if workspace is None:
        if not is_eligible_for_my_space(user):
            raise NotEligibleForMySpace()
        try:
            workspace = _create_my_space(user)
        except IntegrityError:
            # Two first opens raced; the partial unique constraint let exactly
            # one through.
            workspace = Workspace.objects.get(owner=user, is_personal=True)

    project = Project.objects.get(workspace=workspace, is_personal=True)
    _ensure_owner_membership(WorkspaceMember.all_objects, user, workspace=workspace)
    _ensure_owner_membership(ProjectMember.all_objects, user, project=project)
    return workspace, project
