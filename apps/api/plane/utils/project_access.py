# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: which containers a user may read data from.

Plane has no queryset-level chokepoint for container privacy - every endpoint
that returns container data filters on project membership by hand. Endpoints
that forgot leaked a Secret container's data to people outside it: workspace
analytics, the publish (deploy board) endpoint, export history, the workspace
estimates, profile-stats cycles, task relations and a handful of asset routes.

The rule those endpoints now share: **a user reads a container's data only
while they are an active member of it**. A workspace admin gets no bypass;
admins join a container like anyone else. This is what the project-level
``allow_permission`` already enforces for every per-container endpoint.

``member_project_ids`` is a subquery rather than a join on
``project__project_projectmember`` on purpose: the join multiplies rows in
aggregated and annotated querysets (analytics counts, ``Sum("point")``).
"""

# Module imports
from plane.db.models import ProjectMember


def member_project_ids(user, slug=None):
    """Ids of the containers ``user`` is an active member of, as a subquery."""
    memberships = ProjectMember.objects.filter(member=user, is_active=True)
    if slug is not None:
        memberships = memberships.filter(workspace__slug=slug)
    return memberships.values("project_id")


def is_active_project_member(user, project_id):
    """True when ``user`` is an active member of the container ``project_id``."""
    if project_id is None:
        return False
    return ProjectMember.objects.filter(member=user, project_id=project_id, is_active=True).exists()
