# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: a Job (module) uses its container's task States.

`Module.state` is the source of truth. `Module.status` is kept as a value
derived from the state's group, so anything that still reads the old field
(dashboard metrics, the public API, the archive rule) keeps working.
"""

from rest_framework.exceptions import ValidationError

# State group -> legacy module status
GROUP_TO_STATUS = {
    "backlog": "backlog",
    "unstarted": "planned",
    "started": "in-progress",
    "completed": "completed",
    "cancelled": "cancelled",
}

# Legacy module status -> state group
STATUS_TO_GROUP = {
    "backlog": "backlog",
    "planned": "unstarted",
    "in-progress": "started",
    "paused": "started",
    "completed": "completed",
    "cancelled": "cancelled",
}

PAUSED_STATE_NAME = "Paused"


def status_for_group(group):
    return GROUP_TO_STATUS.get(group, "planned")


def status_for_state(state):
    """
    The legacy status a Job in `state` reports. A started-group state named
    "Paused" keeps reporting "paused", so readers of the old field still see
    paused Jobs as paused rather than in progress.
    """
    if state.group == "started" and (state.name or "").strip().lower() == PAUSED_STATE_NAME.lower():
        return "paused"
    return status_for_group(state.group)


def default_state_for_project(project_id):
    """The container's default state, else its first non-triage state."""
    from plane.db.models import State

    states = State.objects.filter(project_id=project_id, is_triage=False)
    return states.filter(default=True).first() or states.order_by("sequence").first()


def state_for_status(project_id, status):
    """
    The state a legacy `status` value maps to in this container, used when a
    client still sends `status` instead of `state_id`. Returns None if the
    container has no state in that group.
    """
    from plane.db.models import State

    group = STATUS_TO_GROUP.get(status)
    if group is None:
        return None
    states = State.objects.filter(project_id=project_id, is_triage=False)
    if status == "paused":
        paused = states.filter(name__iexact=PAUSED_STATE_NAME).first()
        if paused:
            return paused
    in_group = states.filter(group=group)
    if group == "unstarted":
        # "planned" was the old default, so prefer the container's default state
        default = in_group.filter(default=True).first()
        if default:
            return default
    return in_group.order_by("sequence").first()


def validate_module_state(serializer, data):
    """
    Geotech3D: a Job's state must be one of its own container's (non-triage)
    states. A client that still sends only the legacy `status` gets the state
    that status maps to, so its change is not lost.
    """
    project = serializer.context.get("project") or getattr(serializer.instance, "project", None)
    project_id = getattr(project, "id", None) or serializer.context.get("project_id")
    if "state" in data:
        state = data["state"]
        if state is None:
            if serializer.instance is None or serializer.instance.state_id is None:
                # A new Job with no state picked starts in the container's default
                # state; a Job that has none yet (e.g. its container had no states)
                # can still be edited, the form just sends its empty state back.
                data.pop("state")
                data.pop("status", None)
                return data
            raise ValidationError({"state_id": "A Job must have a state"})
        if state.is_triage or (project_id is not None and str(state.project_id) != str(project_id)):
            raise ValidationError({"state_id": "State does not belong to this container"})
        data.pop("status", None)
    elif "status" in data and project_id is not None:
        state = state_for_status(project_id, data["status"])
        if state is None:
            # Saying "OK" while changing nothing would be worse than refusing
            raise ValidationError({"status": "This container has no state for that status"})
        data["state"] = state
    return data
