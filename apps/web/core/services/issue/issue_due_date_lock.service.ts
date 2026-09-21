/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  TDueDateChangeRequestPayload,
  TIssue,
  TIssueDueDateChangeRequest,
  TWorkspaceDueDateChangeRequest,
} from "@plane/types";
// services
import { APIService } from "@/services/api.service";

/**
 * Geotech3D: fixed (admin-controlled) due dates and the member change-request
 * workflow that sits behind them.
 *
 * Locking is admin only and is enforced server side — the disabled controls in
 * the UI are a courtesy, not the boundary.
 */
export class IssueDueDateLockService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  /** Admin only: fix a task's due date. Never changes the date itself. */
  async lock(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssue> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/due-date-lock/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Admin only: release a fixed due date. */
  async unlock(workspaceSlug: string, projectId: string, issueId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/due-date-lock/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async listRequests(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssueDueDateChangeRequest[]> {
    return this.get(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/due-date-change-requests/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Member: ask an admin to change a fixed due date. Never changes the date. */
  async createRequest(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: TDueDateChangeRequestPayload
  ): Promise<TIssueDueDateChangeRequest> {
    return this.post(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/due-date-change-requests/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Admin only: approving applies the requested date through the normal pipeline. */
  async reviewRequest(
    workspaceSlug: string,
    projectId: string,
    requestId: string,
    action: "approve" | "reject",
    reviewComment?: string
  ): Promise<TIssueDueDateChangeRequest> {
    return this.post(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/due-date-change-requests/${requestId}/${action}/`,
      { review_comment: reviewComment ?? "" }
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Admin review queue across every project the user administers. */
  async listWorkspaceRequests(
    workspaceSlug: string,
    status: "pending" | "approved" | "rejected" = "pending"
  ): Promise<TWorkspaceDueDateChangeRequest[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/due-date-change-requests/`, { params: { status } })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
