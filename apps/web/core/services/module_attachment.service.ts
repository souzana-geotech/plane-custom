/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Geotech3D: documents (PDF, TXT, Word) uploaded onto a Job (module).
import type { AxiosRequestConfig } from "axios";
import { API_BASE_URL } from "@plane/constants";
import { generateFileUploadPayload } from "@plane/services";
import type { TFileSignedURLResponse } from "@plane/types";
// services
import { APIService } from "@/services/api.service";
import { FileUploadService } from "@/services/file-upload.service";

export type TModuleDocument = {
  id: string;
  attributes: {
    name: string;
    size: number;
    type?: string;
  };
  asset_url: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type TModuleDocumentUploadResponse = TFileSignedURLResponse & {
  attachment: TModuleDocument;
};

export class ModuleAttachmentService extends APIService {
  private fileUploadService: FileUploadService;

  constructor() {
    super(API_BASE_URL);
    this.fileUploadService = new FileUploadService();
  }

  private baseUrl(workspaceSlug: string, projectId: string, moduleId: string) {
    return `/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/attachments/`;
  }

  async list(workspaceSlug: string, projectId: string, moduleId: string): Promise<TModuleDocument[]> {
    return this.get(this.baseUrl(workspaceSlug, projectId, moduleId))
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** The server types the file from its extension, so only the name and size are sent. */
  async upload(
    workspaceSlug: string,
    projectId: string,
    moduleId: string,
    file: File,
    uploadProgressHandler?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<TModuleDocument> {
    const url = this.baseUrl(workspaceSlug, projectId, moduleId);
    return this.post(url, { name: file.name, size: file.size })
      .then(async (response) => {
        const signedURLResponse: TModuleDocumentUploadResponse = response?.data;
        const fileUploadPayload = generateFileUploadPayload(signedURLResponse, file);
        await this.fileUploadService.uploadFile(
          signedURLResponse.upload_data.url,
          fileUploadPayload,
          uploadProgressHandler
        );
        await this.patch(`${url}${signedURLResponse.asset_id}/`);
        return signedURLResponse.attachment;
      })
      .catch((error) => {
        throw error?.response?.data ?? error;
      });
  }

  async remove(workspaceSlug: string, projectId: string, moduleId: string, documentId: string): Promise<void> {
    return this.delete(`${this.baseUrl(workspaceSlug, projectId, moduleId)}${documentId}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
