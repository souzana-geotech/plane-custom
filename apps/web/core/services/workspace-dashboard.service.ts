/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
import { renderFormattedPayloadDate } from "@plane/utils";
// services
import { APIService } from "./api.service";

export type TAnalyticsAssigneeDetail = {
  assignees__avatar_url: string | null;
  assignees__display_name: string;
  assignees__first_name: string;
  assignees__last_name: string;
  assignees__id: string;
};

export type TOverdueByAssigneeResponse = {
  total: number;
  distribution: Record<string, { dimension: string | null; count: number }[]>;
  extras: {
    assignee_details: TAnalyticsAssigneeDetail[];
  };
};

export class WorkspaceDashboardService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  /**
   * Overdue work items grouped by assignee: due date strictly before today,
   * limited to states that are not completed or cancelled.
   */
  async getOverdueByAssignee(workspaceSlug: string): Promise<TOverdueByAssigneeResponse> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return this.get(`/api/workspaces/${workspaceSlug}/analytics/`, {
      params: {
        x_axis: "assignees__id",
        y_axis: "issue_count",
        target_date: `${renderFormattedPayloadDate(yesterday)};before`,
        state_group: "backlog,unstarted,started",
      },
    })
      .then((res) => res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }
}
