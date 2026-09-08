/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TIssueDependencySchedule, TWorkspaceDependencySchedule } from "@plane/types";
// services
import { APIService } from "@/services/api.service";

export class IssueDependencyScheduleService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async retrieve(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssueDependencySchedule> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/dependency-schedule/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Every dependency-delay projection the user can see in the workspace. */
  async listWorkspace(workspaceSlug: string): Promise<TWorkspaceDependencySchedule[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/dependency-schedules/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
