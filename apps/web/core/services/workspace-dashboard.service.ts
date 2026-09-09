/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
import type { TIssueRelationTypes, TIssuesResponse } from "@plane/types";
// services
import { APIService } from "./api.service";

/**
 * Relation entry returned by the project task list when `expand=issue_relation` is requested.
 * `relation_type` describes how the listed task relates to `id` (e.g. `blocked_by` = the listed
 * task is blocked by `id`).
 */
export type TWorkspaceDashboardRelation = {
  id: string;
  project_id: string;
  sequence_id: number;
  name: string;
  relation_type: TIssueRelationTypes;
  state_id: string | null;
  priority: string | null;
};

/**
 * Task shape consumed by the workspace dashboard. It mirrors the fields the existing
 * project-level `issues-detail` endpoint already returns; nothing here is dashboard specific.
 */
export type TWorkspaceDashboardWorkItem = {
  id: string;
  name: string;
  sequence_id: number;
  project_id: string;
  state_id: string | null;
  priority: string | null;
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  assignee_ids: string[];
  label_ids: string[];
  module_ids: string[];
  is_draft: boolean;
  archived_at: string | null;
  issue_relation?: TWorkspaceDashboardRelation[];
};

type TWorkItemsPage = Omit<TIssuesResponse, "results"> & {
  results: TWorkspaceDashboardWorkItem[];
};

// hard cap so a runaway workspace can never keep the dashboard paging forever
const MAX_PAGES_PER_PROJECT = 10;
const PAGE_SIZE = 1000;

export class WorkspaceDashboardService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  /**
   * Fetches every non-archived, non-draft task of a project together with its relations,
   * paging through the existing `issues-detail` endpoint until it reports no further pages.
   */
  async getProjectWorkItems(workspaceSlug: string, projectId: string): Promise<TWorkspaceDashboardWorkItem[]> {
    const workItems: TWorkspaceDashboardWorkItem[] = [];
    let cursor = `${PAGE_SIZE}:0:0`;
    for (let page = 0; page < MAX_PAGES_PER_PROJECT; page++) {
      // oxlint-disable-next-line no-await-in-loop -- each page's cursor comes from the previous response
      const response: TWorkItemsPage = await this.get(
        `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues-detail/`,
        {
          params: {
            expand: "issue_relation",
            per_page: PAGE_SIZE,
            cursor,
          },
        }
      )
        .then((res) => res?.data)
        .catch((err) => {
          throw err?.response?.data;
        });
      workItems.push(...(response?.results ?? []));
      if (!response?.next_page_results || !response?.next_cursor) break;
      cursor = response.next_cursor;
    }
    return workItems;
  }
}
