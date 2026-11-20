# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Geotech3D: documents attached to a Job (Module).

Files people upload straight onto a Job (PDF, TXT or Word only) so the whole
team finds them from the Job page. Same presigned-upload flow as a task
attachment: POST asks for an upload slot, the browser sends the file to
storage, PATCH marks it uploaded, GET with a pk redirects to a download link.

`FileAsset` has no module foreign key, so a Job document is a
`MODULE_ATTACHMENT` asset whose `entity_identifier` is the module id, scoped to
the module's container by `project_id`. Members and admins only: guests see
just the tasks assigned to them, not the Job's papers.
"""

# Python imports
import uuid

# Django imports
from django.conf import settings
from django.http import HttpResponseRedirect
from django.utils import timezone

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .. import BaseAPIView
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import IssueAttachmentSerializer
from plane.bgtasks.storage_metadata_task import get_asset_object_metadata
from plane.db.models import FileAsset, Module, Workspace
from plane.settings.storage import S3Storage
from plane.utils.path_validator import sanitize_filename

# Job documents are papers, not drawings or media: PDF, plain text and Word.
# The type is decided by the extension, not by what the browser sends - the
# client-side sniffer can't type a .txt (it has no signature) and reports an
# old .doc as a generic OLE container.
DOCUMENT_TYPES = {
    "pdf": "application/pdf",
    "txt": "text/plain",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


# A Job document can be at most 5 MB, even when FILE_SIZE_LIMIT allows more.
JOB_DOCUMENT_MAX_SIZE = 5 * 1024 * 1024


def document_type(name):
    extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return DOCUMENT_TYPES.get(extension)


class ModuleAttachmentEndpoint(BaseAPIView):
    serializer_class = IssueAttachmentSerializer
    model = FileAsset

    def _documents(self, slug, project_id, module_id):
        return FileAsset.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            entity_type=FileAsset.EntityTypeContext.MODULE_ATTACHMENT,
            entity_identifier=str(module_id),
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, module_id):
        if not Module.objects.filter(id=module_id, project_id=project_id, workspace__slug=slug).exists():
            return Response({"error": "Job not found."}, status=status.HTTP_404_NOT_FOUND)

        name = sanitize_filename(request.data.get("name")) or "unnamed"
        type = document_type(name)
        max_size = min(JOB_DOCUMENT_MAX_SIZE, settings.FILE_SIZE_LIMIT)
        try:
            size = int(request.data.get("size", max_size))
        except (TypeError, ValueError):
            size = max_size

        if not type:
            return Response(
                {"error": "Only PDF, TXT and Word documents can be added to a Job.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Refused up front so no empty asset row is left behind. Storage also
        # rejects a body over the presigned size, so a wrong `size` can't sneak past.
        if size > max_size:
            return Response(
                {"error": f"Files can be up to {max_size // (1024 * 1024)} MB.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        workspace = Workspace.objects.get(slug=slug)
        asset_key = f"{workspace.id}/{uuid.uuid4().hex}-{name}"
        size_limit = max(1, min(size, max_size))

        asset = FileAsset.objects.create(
            attributes={"name": name, "type": type, "size": size_limit},
            asset=asset_key,
            size=size_limit,
            workspace_id=workspace.id,
            project_id=project_id,
            created_by=request.user,
            entity_type=FileAsset.EntityTypeContext.MODULE_ATTACHMENT,
            entity_identifier=str(module_id),
        )

        storage = S3Storage(request=request)
        presigned_url = storage.generate_presigned_post(object_name=asset_key, file_type=type, file_size=size_limit)

        return Response(
            {
                "upload_data": presigned_url,
                "asset_id": str(asset.id),
                "attachment": IssueAttachmentSerializer(asset).data,
                "asset_url": asset.asset_url,
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, module_id, pk=None):
        if pk:
            asset = self._documents(slug, project_id, module_id).filter(id=pk).first()
            if not asset:
                return Response({"error": "Document not found."}, status=status.HTTP_404_NOT_FOUND)
            if not asset.is_uploaded:
                return Response(
                    {"error": "The asset is not uploaded.", "status": False},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            storage = S3Storage(request=request)
            presigned_url = storage.generate_presigned_url(
                object_name=asset.asset.name,
                disposition="attachment",
                filename=asset.attributes.get("name"),
            )
            return HttpResponseRedirect(presigned_url)

        documents = self._documents(slug, project_id, module_id).filter(is_uploaded=True)
        serializer = IssueAttachmentSerializer(documents, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, module_id, pk):
        asset = self._documents(slug, project_id, module_id).filter(id=pk).first()
        if not asset:
            return Response({"error": "Document not found."}, status=status.HTTP_404_NOT_FOUND)

        # Only the uploader confirms their own upload; created_by is never
        # reassigned (GHSA-5mxw-g5mw-3v3w).
        if asset.created_by_id != request.user.id:
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        asset.is_uploaded = True
        if not asset.storage_metadata:
            get_asset_object_metadata.delay(str(asset.id))
        asset.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN], creator=True, model=FileAsset)
    def delete(self, request, slug, project_id, module_id, pk):
        asset = self._documents(slug, project_id, module_id).filter(id=pk).first()
        if not asset:
            return Response({"error": "Document not found."}, status=status.HTTP_404_NOT_FOUND)
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        asset.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
