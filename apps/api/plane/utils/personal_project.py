# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: "My Space" - one private container per person.

A personal container is an ordinary ``Project`` row with ``is_personal=True``
and an ``owner``, so tasks, states, layouts and pages all work unchanged. What
makes it personal is a set of rules, enforced where each operation lives:

* **One per person per workspace**, created the first time its owner opens it
  (``get_or_create_personal_project``). Nothing is created at deploy time and
  no workspace-join path needs a hook.
* **Only the owner is a member.** Adding members, inviting, joining (including
  a workspace admin joining a Secret container) and changing the owner's
  membership are refused.
* **Hidden from everyone else**, workspace admins included: the container list
  excludes it, and editing, deleting or archiving it by id is refused.
* **Never public**: it cannot be published, and ``network`` stays Secret.
* **Sealed off from other containers**: no task relation may cross into or out
  of it, and webhooks never carry its events.

Guests do not get one. A member demoted to guest keeps their personal container
and its data, but their membership of it is deactivated; opening My Space after
being promoted again reactivates it.

Privacy for the rest of the API rests on the Phase 0 rule in
``plane.utils.project_access``: container data is read only by active members.
"""

# Python imports
import uuid

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Q

# Module imports
from plane.db.models import Project, ProjectIdentifier, ProjectMember, State
from plane.db.models.state import DEFAULT_STATES

ADMIN_ROLE = 20

PERSONAL_PROJECT_NAME = "My Space"
# Error code for the container endpoints that refuse an operation on a
# personal container; the web app shows its own message for it.
PERSONAL_PROJECT_ERROR = "PERSONAL_PROJECT_LOCKED"


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


def _free_name(workspace_id, user):
    # Container names are unique per workspace. Only the owner ever sees this
    # one, and the web app labels it "My Space" regardless.
    base = f"{PERSONAL_PROJECT_NAME} - {user.display_name or user.email}"[:240]
    name = base
    while Project.objects.filter(workspace_id=workspace_id, name=name).exists():
        name = f"{base} {uuid.uuid4().hex[:6]}"
    return name


def _create_personal_project(user, workspace):
    with transaction.atomic():
        project = Project.objects.create(
            name=_free_name(workspace.id, user),
            identifier=_free_identifier(workspace.id, user),
            workspace=workspace,
            network=0,
            is_personal=True,
            owner=user,
            # Tasks and pages only: Jobs, cycles, views and requests are team
            # features. The owner may switch them on later.
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


def get_or_create_personal_project(user, workspace):
    """Return ``user``'s personal container in ``workspace``, creating it once."""
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
