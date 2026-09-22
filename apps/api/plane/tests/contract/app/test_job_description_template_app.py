# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for Geotech3D's per-container Job description template.

`Project.job_description_template` is the starting text a new Job (Module) gets
in its description field. A container admin edits it in the Jobs feature
settings; the web app reads it off the container payload and copies it into the
create form. So the contract this file pins is narrow but load-bearing:

* an admin can write the template through the container PATCH,
* it comes back on the container list payload the web app reads,
* it defaults to empty, so a container that never set one changes nothing.

Copying it into a Job is the web app's job and is deliberately not enforced
server-side - a Job's description stays whatever its creator typed.
"""

import pytest
from rest_framework import status

from plane.db.models import Project, ProjectMember

DETAIL_URL = "/api/workspaces/{slug}/projects/{project_id}/"
LIST_URL = "/api/workspaces/{slug}/projects/"

TEMPLATE = "SCOPE OF WORK\n-------------\n\nSITE\n----\n"


@pytest.fixture
def project(db, workspace, create_user):
    """A container the requesting user is an admin of."""
    project = Project.objects.create(
        name="Template Container",
        identifier="TC",
        workspace=workspace,
        created_by=create_user,
    )
    ProjectMember.objects.create(project=project, member=create_user, workspace=workspace, role=20)
    return project


@pytest.mark.contract
class TestJobDescriptionTemplate:
    @pytest.mark.django_db
    def test_defaults_to_empty(self, project):
        assert project.job_description_template == ""

    @pytest.mark.django_db
    def test_admin_can_set_the_template(self, session_client, workspace, project):
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id)
        response = session_client.patch(url, {"job_description_template": TEMPLATE}, format="json")

        assert response.status_code == status.HTTP_200_OK, (
            f"Got {response.status_code}: {getattr(response, 'data', None)!r}"
        )
        project.refresh_from_db()
        assert project.job_description_template == TEMPLATE

    @pytest.mark.django_db
    def test_template_is_returned_on_the_list_payload(self, session_client, workspace, project):
        """The web app reads the template off the container list, so it must ship there."""
        project.job_description_template = TEMPLATE
        project.save(update_fields=["job_description_template"])

        response = session_client.get(LIST_URL.format(slug=workspace.slug))

        assert response.status_code == status.HTTP_200_OK
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        row = next(row for row in rows if str(row["id"]) == str(project.id))
        assert row["job_description_template"] == TEMPLATE

    @pytest.mark.django_db
    def test_clearing_the_template_is_allowed(self, session_client, workspace, project):
        project.job_description_template = TEMPLATE
        project.save(update_fields=["job_description_template"])

        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id)
        response = session_client.patch(url, {"job_description_template": ""}, format="json")

        assert response.status_code == status.HTTP_200_OK
        project.refresh_from_db()
        assert project.job_description_template == ""
