/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import type { TIssuesResponse, TStateGroups } from "@plane/types";
// services
import { WorkspaceService } from "./workspace.service";

/**
 * Work item shape consumed by the employee resource gantt.
 *
 * These are exactly the fields the pre-existing workspace work item endpoint
 * (`GET /api/workspaces/:slug/issues/`, serialised by `ViewIssueListSerializer`) already
 * returns. Nothing here is gantt specific and no backend change was needed.
 */
export type TEmployeeGanttWorkItem = {
  id: string;
  name: string;
  sequence_id: number;
  project_id: string;
  state_id: string | null;
  /** state group resolved server side, so states of other projects need not be loaded */
  state__group: TStateGroups | null;
  priority: string | null;
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  assignee_ids: string[];
  module_ids: string[];
  label_ids: string[];
};

// hard cap so a runaway workspace can never keep the page paging forever
const MAX_PAGES = 20;
const PAGE_SIZE = 1000;

/**
 * Read-only client for the employee resource gantt.
 *
 * It composes the existing `WorkspaceService` instead of defining a new endpoint: without an
 * `expand` param `getViewIssues` resolves to `/api/workspaces/:slug/issues/`, the cross-project
 * work item list that already powers workspace views. That endpoint is permission filtered per
 * project by the backend and already excludes archived, draft and triage work items.
 */
export class EmployeeGanttService {
  private readonly workspaceService: WorkspaceService;

  constructor() {
    this.workspaceService = new WorkspaceService();
  }

  /**
   * Fetches every work item of the workspace the current user is allowed to see, paging through
   * the cursor based response until it reports no further pages.
   */
  async getWorkspaceWorkItems(workspaceSlug: string): Promise<TEmployeeGanttWorkItem[]> {
    const workItems: TEmployeeGanttWorkItem[] = [];
    let cursor = `${PAGE_SIZE}:0:0`;
    for (let page = 0; page < MAX_PAGES; page++) {
      // oxlint-disable-next-line no-await-in-loop -- each page's cursor comes from the previous response
      const response: TIssuesResponse = await this.workspaceService.getViewIssues(workspaceSlug, {
        per_page: PAGE_SIZE,
        cursor,
        order_by: "start_date",
      });
      // the workspace endpoint never groups, so `results` is always a flat list
      const results = (response?.results ?? []) as unknown as TEmployeeGanttWorkItem[];
      workItems.push(...results);
      if (!response?.next_page_results || !response?.next_cursor) break;
      cursor = response.next_cursor;
    }
    return workItems;
  }
}
