# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseAPIView
from plane.utils.personal_project import NotEligibleForMySpace, get_or_create_my_space


class MySpaceEndpoint(BaseAPIView):
    """Open My Space: the caller's private workspace and its one container.

    Not workspace-scoped - My Space is the same from every company workspace.
    POST because the first call creates it. See ``plane.utils.personal_project``.
    """

    def post(self, request):
        try:
            workspace, project = get_or_create_my_space(request.user)
        except NotEligibleForMySpace:
            return Response(
                {"error": "My Space is available to workspace members and admins."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return Response(
            {
                "workspace": {"id": workspace.id, "slug": workspace.slug, "name": workspace.name},
                "project": {"id": project.id, "identifier": project.identifier, "name": project.name},
            },
            status=status.HTTP_200_OK,
        )
