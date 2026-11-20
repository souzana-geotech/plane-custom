# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for Geotech3D's Job documents (``ModuleAttachmentEndpoint``).

A Job (Module) can carry uploaded files - drawings, PDFs, specs - that the team
opens from the Job page. What this file pins:

* members and admins can request an upload slot, confirm it, list and download;
* guests can't touch a Job's documents at all;
* only PDF, TXT and Word (doc/docx) are accepted, typed by extension, since the
  browser sends no type for a .txt and a generic one for an old .doc;
* the list is scoped to the one Job and hides unconfirmed uploads;
* only the uploader confirms an upload; the uploader or an admin deletes it,
  another member can't.
"""

from unittest import mock
from uuid import uuid4

import pytest
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import FileAsset, Module, Project, ProjectMember, User, WorkspaceMember

S3_STORAGE_PATH = "plane.app.views.module.attachment.S3Storage"
METADATA_TASK_PATH = "plane.app.views.module.attachment.get_asset_object_metadata"
LIST_URL = "/api/assets/v2/workspaces/{slug}/projects/{project_id}/modules/{module_id}/attachments/"
DETAIL_URL = LIST_URL + "{pk}/"
FIVE_MB = 5 * 1024 * 1024


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(
        name="Docs Container", identifier="DOC", workspace=workspace, created_by=create_user
    )
    ProjectMember.objects.create(project=project, member=create_user, workspace=workspace, role=20)
    return project


@pytest.fixture
def job(project, workspace, create_user):
    return Module.objects.create(name="Site A", project=project, workspace=workspace, created_by=create_user)


@pytest.fixture
def other_job(project, workspace, create_user):
    return Module.objects.create(name="Site B", project=project, workspace=workspace, created_by=create_user)


def _member_client(workspace, project, role):
    uid = uuid4().hex[:8]
    user = User.objects.create(email=f"u-{uid}@plane.so", username=f"u_{uid}")
    user.set_password("pw")
    user.save()
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    ProjectMember.objects.create(project=project, member=user, workspace=workspace, role=role)
    client = APIClient()
    client.force_authenticate(user=user)
    return user, client


@pytest.fixture
def storage():
    with mock.patch(S3_STORAGE_PATH) as storage_cls, mock.patch(METADATA_TASK_PATH):
        instance = storage_cls.return_value
        instance.generate_presigned_post.return_value = {"url": "https://s3.test/upload", "fields": {"key": "k"}}
        instance.generate_presigned_url.return_value = "https://s3.test/download"
        yield instance


def _document(job, project, workspace, user, name="plan.pdf", uploaded=True):
    doc = FileAsset.objects.create(
        attributes={"name": name, "type": "application/pdf", "size": 10},
        asset=f"{workspace.id}/{uuid4().hex}-{name}",
        size=10,
        workspace=workspace,
        project=project,
        created_by=user,
        entity_type=FileAsset.EntityTypeContext.MODULE_ATTACHMENT,
        entity_identifier=str(job.id),
        is_uploaded=uploaded,
    )
    # BaseModel.save stamps created_by from the request user, which is None here
    FileAsset.objects.filter(id=doc.id).update(created_by=user)
    doc.refresh_from_db()
    return doc


@pytest.mark.contract
class TestModuleAttachments:
    @pytest.mark.django_db
    def test_member_requests_an_upload_slot(self, session_client, workspace, project, job, storage):
        url = LIST_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id)
        response = session_client.post(
            url, {"name": "plan.pdf", "type": "application/pdf", "size": 1000}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK, response.data
        asset = FileAsset.objects.get(id=response.data["asset_id"])
        assert asset.entity_type == FileAsset.EntityTypeContext.MODULE_ATTACHMENT
        assert asset.entity_identifier == str(job.id)
        assert asset.project_id == project.id
        assert asset.is_uploaded is False
        assert response.data["asset_url"].endswith(f"/modules/{job.id}/attachments/{asset.id}/")

    @pytest.mark.django_db
    @pytest.mark.parametrize(
        "name, sent_type, stored_type",
        [
            ("spec.pdf", "application/pdf", "application/pdf"),
            ("notes.txt", "", "text/plain"),
            ("old.DOC", "application/x-cfb", "application/msword"),
            ("report.docx", "", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ],
    )
    def test_documents_are_typed_by_extension(
        self, session_client, workspace, project, job, storage, name, sent_type, stored_type
    ):
        url = LIST_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id)
        response = session_client.post(url, {"name": name, "type": sent_type, "size": 1000}, format="json")

        assert response.status_code == status.HTTP_200_OK, response.data
        asset = FileAsset.objects.get(id=response.data["asset_id"])
        assert asset.attributes["type"] == stored_type

    @pytest.mark.django_db
    @pytest.mark.parametrize(
        "name, sent_type",
        [("site.dwg", ""), ("photo.png", "image/png"), ("sheet.xlsx", ""), ("README", "text/plain")],
    )
    def test_anything_else_is_refused(self, session_client, workspace, project, job, storage, name, sent_type):
        url = LIST_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id)
        response = session_client.post(url, {"name": name, "type": sent_type}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not FileAsset.objects.filter(entity_type=FileAsset.EntityTypeContext.MODULE_ATTACHMENT).exists()

    @pytest.mark.django_db
    def test_a_file_of_exactly_5_mb_is_accepted(self, session_client, workspace, project, job, storage):
        url = LIST_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id)
        with override_settings(FILE_SIZE_LIMIT=50 * 1024 * 1024):
            response = session_client.post(
                url, {"name": "plan.pdf", "type": "application/pdf", "size": FIVE_MB}, format="json"
            )

        assert response.status_code == status.HTTP_200_OK, response.data
        # Storage is told the same cap, so the upload itself can't go bigger
        assert storage.generate_presigned_post.call_args.kwargs["file_size"] == FIVE_MB

    @pytest.mark.django_db
    def test_a_file_over_5_mb_is_refused_even_if_the_instance_allows_more(
        self, session_client, workspace, project, job, storage
    ):
        url = LIST_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id)
        with override_settings(FILE_SIZE_LIMIT=50 * 1024 * 1024):
            response = session_client.post(
                url, {"name": "big.pdf", "type": "application/pdf", "size": FIVE_MB + 1}, format="json"
            )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["error"] == "Files can be up to 5 MB."
        assert not FileAsset.objects.filter(entity_type=FileAsset.EntityTypeContext.MODULE_ATTACHMENT).exists()
        storage.generate_presigned_post.assert_not_called()

    @pytest.mark.django_db
    def test_a_smaller_instance_limit_still_wins(self, session_client, workspace, project, job, storage):
        url = LIST_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id)
        with override_settings(FILE_SIZE_LIMIT=2 * 1024 * 1024):
            response = session_client.post(
                url, {"name": "plan.pdf", "type": "application/pdf", "size": 3 * 1024 * 1024}, format="json"
            )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["error"] == "Files can be up to 2 MB."

    @pytest.mark.django_db
    def test_unknown_job_is_404(self, session_client, workspace, project, storage):
        url = LIST_URL.format(slug=workspace.slug, project_id=project.id, module_id=uuid4())
        response = session_client.post(url, {"name": "plan.pdf", "type": "application/pdf"}, format="json")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.django_db
    def test_list_is_scoped_to_the_job_and_hides_pending(
        self, session_client, create_user, workspace, project, job, other_job
    ):
        mine = _document(job, project, workspace, create_user)
        _document(job, project, workspace, create_user, name="pending.pdf", uploaded=False)
        _document(other_job, project, workspace, create_user, name="other.pdf")

        url = LIST_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id)
        response = session_client.get(url)

        assert response.status_code == status.HTTP_200_OK
        assert [str(row["id"]) for row in response.data] == [str(mine.id)]

    @pytest.mark.django_db
    def test_download_redirects(self, session_client, create_user, workspace, project, job, storage):
        doc = _document(job, project, workspace, create_user)
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id, pk=doc.id)
        response = session_client.get(url)
        assert response.status_code == status.HTTP_302_FOUND
        assert response["Location"] == "https://s3.test/download"

    @pytest.mark.django_db
    def test_document_of_another_job_is_404(self, session_client, create_user, workspace, project, job, other_job):
        doc = _document(other_job, project, workspace, create_user)
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id, pk=doc.id)
        assert session_client.get(url).status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.django_db
    def test_uploader_confirms_upload(self, session_client, create_user, workspace, project, job, storage):
        doc = _document(job, project, workspace, create_user, uploaded=False)
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id, pk=doc.id)
        response = session_client.patch(url)
        assert response.status_code == status.HTTP_204_NO_CONTENT
        doc.refresh_from_db()
        assert doc.is_uploaded is True

    @pytest.mark.django_db
    def test_another_member_cannot_confirm_someone_elses_upload(self, create_user, workspace, project, job, storage):
        doc = _document(job, project, workspace, create_user, uploaded=False)
        _, client = _member_client(workspace, project, role=15)
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id, pk=doc.id)
        assert client.patch(url).status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_guest_cannot_list_or_upload(self, create_user, workspace, project, job, storage):
        _document(job, project, workspace, create_user)
        _, guest = _member_client(workspace, project, role=5)
        url = LIST_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id)
        assert guest.get(url).status_code == status.HTTP_403_FORBIDDEN
        assert (
            guest.post(url, {"name": "a.pdf", "type": "application/pdf"}, format="json").status_code
            == status.HTTP_403_FORBIDDEN
        )

    @pytest.mark.django_db
    def test_member_deletes_own_document(self, workspace, project, job):
        user, client = _member_client(workspace, project, role=15)
        doc = _document(job, project, workspace, user)
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id, pk=doc.id)
        assert client.delete(url).status_code == status.HTTP_204_NO_CONTENT
        assert not FileAsset.objects.filter(id=doc.id).exists()

    @pytest.mark.django_db
    def test_member_cannot_delete_someone_elses_document(self, create_user, workspace, project, job):
        doc = _document(job, project, workspace, create_user)
        _, client = _member_client(workspace, project, role=15)
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id, pk=doc.id)
        assert client.delete(url).status_code == status.HTTP_403_FORBIDDEN
        assert FileAsset.objects.filter(id=doc.id).exists()

    @pytest.mark.django_db
    def test_admin_deletes_any_document(self, session_client, workspace, project, job):
        user, _ = _member_client(workspace, project, role=15)
        doc = _document(job, project, workspace, user)
        url = DETAIL_URL.format(slug=workspace.slug, project_id=project.id, module_id=job.id, pk=doc.id)
        assert session_client.delete(url).status_code == status.HTTP_204_NO_CONTENT
