/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
// plane imports
import type { TStateGroups } from "@plane/types";
// services
import { WorkspaceService } from "@/services/workspace.service";

const workspaceService = new WorkspaceService();

/**
 * Fields used from the pre-existing workspace work item endpoint
 * (`GET /api/workspaces/:slug/issues/`, `ViewIssueListSerializer`) — the same
 * endpoint that powers workspace views, permission filtered per project.
 */
export type TMyWorkItem = {
  id: string;
  name: string;
  sequence_id: number;
  project_id: string;
  state__group: TStateGroups | null;
  target_date: string | null;
};

/** Only open work needs doing; completed and cancelled items don't belong on a daily work page. */
export const OPEN_STATE_GROUPS = "backlog,unstarted,started";
const PAGE_SIZE = 100;

/** Local YYYY-MM-DD, comparable to the API's date-only `target_date` strings. */
export const todayString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
};

/** Adds `days` to a `YYYY-MM-DD` string without timezone drift. */
export const addDaysToDateString = (dateStr: string, days: number) => {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
};

/**
 * The current user's own open work items, shared by the Today and Coming Up sections of
 * My Work so they don't each fetch the same list separately.
 */
export const useMyWorkItems = (workspaceSlug: string | undefined, currentUserId: string | undefined) => {
  const { data, isLoading } = useSWR(
    workspaceSlug && currentUserId ? `HOME_MY_WORK_${workspaceSlug}_${currentUserId}` : null,
    workspaceSlug && currentUserId
      ? async () => {
          const response = await workspaceService.getViewIssues(workspaceSlug, {
            assignees: currentUserId,
            state_group: OPEN_STATE_GROUPS,
            order_by: "target_date",
            per_page: PAGE_SIZE,
            cursor: `${PAGE_SIZE}:0:0`,
          });
          // the workspace endpoint never groups, so `results` is always a flat list
          return (response?.results ?? []) as unknown as TMyWorkItem[];
        }
      : null,
    { revalidateIfStale: true, revalidateOnFocus: false, revalidateOnReconnect: true }
  );

  return { workItems: data ?? [], isLoading };
};
