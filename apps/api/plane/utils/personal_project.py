# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: "My Space" - one private container per person, in one shared
workspace, reached from every workspace.

There is a single **My Space workspace** (``Workspace.is_my_space``) for the
whole instance. It holds one **personal container** per person - an ordinary
``Project`` with ``is_personal=True`` and an ``owner`` - so tasks, states,
layouts, Jobs, cycles, views and pages all work unchanged. Every company workspace links to it; the
web app opens it there, with a way back.

The My Space workspace is nobody's to run: everyone in it is a MEMBER, nobody
is an admin, and it cannot be invited to, renamed, deleted, left, or given an
ordinary container. People join it only through ``get_or_create_my_space``.

Each personal container is private to its owner:

* **One per person**, created the first time they open My Space. Nothing is
  created at deploy time and no workspace-join path needs a hook.
* **Only the owner is a member.** Adding members, inviting, joining and
  changing the owner's membership are refused.
* **Hidden from everyone else**: the container list excludes other people's,
  and editing, deleting or archiving one by id is refused.
* **Never public**: it cannot be published, and ``network`` stays Secret.
* **Sealed off from other containers**: no task relation may cross into or out
  of it, and webhooks never carry its events.

**Who gets it**: ADMINs and MEMBERs of a company workspace. A pure guest does
not. Someone who stops being an ADMIN or MEMBER anywhere - they leave or are
removed from every company workspace, or are demoted to guest everywhere -
loses access (``close_my_space_if_ineligible``). The data stays and comes back
when they are an ADMIN or MEMBER again and open My Space.

Privacy for the rest of the API rests on the Phase 0 rule in
``plane.utils.project_access``: container data is read only by active members.
"""

# Python imports
import uuid

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Q

# Module imports
from plane.db.models import DEFAULT_STATES, Project, ProjectIdentifier, ProjectMember, State, Workspace, WorkspaceMember

ADMIN_ROLE = 20
MEMBER_ROLE = 15

PERSONAL_PROJECT_NAME = "Personal Space"
MY_SPACE_WORKSPACE_NAME = "Personal Space"
MY_SPACE_WORKSPACE_SLUG = "my-space"

# Error code for the container endpoints that refuse an operation on a
# personal container; the web app shows its own message for it.
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


def is_my_space_workspace(slug):
    if not slug:
        return False
    return Workspace.objects.filter(slug=slug, is_my_space=True).exists()


def is_reserved_workspace_slug(slug):
    """Company workspaces may not take the My Space workspace's slug."""
    return bool(slug) and slug.lower() == MY_SPACE_WORKSPACE_SLUG


def is_eligible_for_my_space(user):
    return WorkspaceMember.objects.filter(
        member=user, is_active=True, role__gte=MEMBER_ROLE, workspace__is_my_space=False
    ).exists()


def is_others_personal_project(project_id, user):
    """True for a personal container that does not belong to ``user``."""
    if project_id is None:
        return False
    return Project.objects.filter(pk=project_id, is_personal=True).exclude(owner=user).exists()


def _identifier_candidates(user):
    hex_id = uuid.UUID(str(user.id)).hex.upper()
    # 12 characters max, letters and digits only. Derived from the user id so
    # the same person gets the same identifier in every workspace.
    for length in (6, 8, 10):
        yield f"MY{hex_id[:length]}"
    while True:
        yield f"MY{uuid.uuid4().hex[:10].upper()}"


def _free_identifier(workspace_id, user):
    for candidate in _identifier_candidates(user):
        taken = (
            Project.all_objects.filter(workspace_id=workspace_id, identifier=candidate).exists()
            or ProjectIdentifier.objects.filter(workspace_id=workspace_id, name=candidate).exists()
        )
        if not taken:
            return candidate



def _create_personal_project(user, workspace):
    with transaction.atomic():
        project = Project.objects.create(
            # Every personal container has the same name; personal containers
            # are exempt from the per-workspace name uniqueness constraint.
            name=PERSONAL_PROJECT_NAME,
            identifier=_free_identifier(workspace.id, user),
            workspace=workspace,
            network=0,
            is_personal=True,
            owner=user,
            # New tasks with nobody assigned go to the owner. It is the
            # container's ordinary "default assignee" setting.
            default_assignee=user,
            # An ordinary container: Jobs, cycles, views and pages, as the
            # company's containers have them. Requests (intake) are for work
            # coming in from others, so they start off.
            module_view=True,
            cycle_view=True,
            issue_views_view=True,
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
    return project


def _ensure_owner_membership(project, user):
    """The owner is always an active admin of their own container."""
    membership = ProjectMember.all_objects.filter(project=project, member=user).order_by("-created_at").first()
    if membership is None:
        ProjectMember.objects.create(
            project=project, member=user, workspace_id=project.workspace_id, role=ADMIN_ROLE
        )
        return
    if membership.is_active and membership.role == ADMIN_ROLE and membership.deleted_at is None:
        return
    membership.is_active = True
    membership.role = ADMIN_ROLE
    membership.deleted_at = None
    membership.save(update_fields=["is_active", "role", "deleted_at", "updated_at"])


def _my_space_workspace(user):
    """The one My Space workspace, created by whoever opens My Space first."""
    workspace = Workspace.objects.filter(is_my_space=True).first()
    if workspace is not None:
        return workspace
    slug = MY_SPACE_WORKSPACE_SLUG
    if Workspace.all_objects.filter(slug=slug).exists():
        slug = f"{MY_SPACE_WORKSPACE_SLUG}-{uuid.uuid4().hex[:8]}"
    try:
        with transaction.atomic():
            # ``owner`` is required by the model; it grants nothing here - the
            # owner joins as a MEMBER like everyone else.
            return Workspace.objects.create(name=MY_SPACE_WORKSPACE_NAME, slug=slug, owner=user, is_my_space=True)
    except IntegrityError:
        # Two first opens raced; the partial unique constraint let one through.
        return Workspace.objects.get(is_my_space=True)


def _ensure_workspace_membership(workspace, user):
    """Everyone in the My Space workspace is an active MEMBER, never an admin."""
    membership = WorkspaceMember.all_objects.filter(workspace=workspace, member=user).order_by("-created_at").first()
    if membership is None:
        try:
            with transaction.atomic():
                WorkspaceMember.objects.create(workspace=workspace, member=user, role=MEMBER_ROLE)
        except IntegrityError:
            pass  # a concurrent open created it
        return
    if membership.is_active and membership.role == MEMBER_ROLE and membership.deleted_at is None:
        return
    membership.is_active = True
    membership.role = MEMBER_ROLE
    membership.deleted_at = None
    membership.save(update_fields=["is_active", "role", "deleted_at", "updated_at"])


def get_or_create_my_space(user):
    """Return ``user``'s personal container, setting up whatever is missing.

    Raises ``NotEligibleForMySpace`` for someone who is not an ADMIN or MEMBER
    of any company workspace.
    """
    if not is_eligible_for_my_space(user):
        raise NotEligibleForMySpace()

    workspace = _my_space_workspace(user)
    _ensure_workspace_membership(workspace, user)

    for _attempt in range(3):
        project = Project.objects.filter(workspace=workspace, owner=user, is_personal=True).first()
        if project is not None:
            break
        try:
            project = _create_personal_project(user, workspace)
            break
        except IntegrityError:
            # Either two first opens raced (the partial unique constraint let
            # one through - the next lookup finds it), or someone else took the
            # name or identifier in between (the next attempt picks another).
            continue
    else:
        raise IntegrityError("Could not create the personal container")

    _ensure_owner_membership(project, user)
    return project


def close_my_space_if_ineligible(user_id):
    """Shut My Space for someone who is no longer an ADMIN or MEMBER anywhere.

    Called after a company workspace membership ends or is demoted. Only the
    memberships are deactivated; the container and its data stay, and opening
    My Space later restores access if the person is eligible again.
    """
    if WorkspaceMember.objects.filter(
        member_id=user_id, is_active=True, role__gte=MEMBER_ROLE, workspace__is_my_space=False
    ).exists():
        return
    WorkspaceMember.objects.filter(member_id=user_id, workspace__is_my_space=True, is_active=True).update(
        is_active=False
    )
    ProjectMember.objects.filter(
        member_id=user_id, project__is_personal=True, project__workspace__is_my_space=True, is_active=True
    ).update(is_active=False)
