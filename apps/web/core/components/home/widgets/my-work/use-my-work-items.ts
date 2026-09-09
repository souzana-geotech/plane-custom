/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR, { mutate } from "swr";
// plane imports
import type { TIssuePriorities, TStateGroups } from "@plane/types";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
// services
import { WorkspaceService } from "@/services/workspace.service";

const workspaceService = new WorkspaceService();

/**
 * Fields used from the pre-existing workspace task endpoint
 * (`GET /api/workspaces/:slug/issues/`, `ViewIssueListSerializer`) — the same
 * endpoint that powers workspace views, permission filtered per project.
 */
export type TMyWorkItem = {
  id: string;
  name: string;
  sequence_id: number;
  project_id: string;
  state_id: string | null;
  priority: TIssuePriorities | null;
  target_date: string | null;
  updated_at: string;
  created_at: string;
};

/** Plain-language status used everywhere on My Work: shape + icon + color, never a raw state name. */
export type TVisualStatus = "todo" | "in_progress" | "done" | "overdue" | "cancelled";

/** How a due date relates to today; drives the due chip color and the summary counts. */
export type TDueBucket = "overdue" | "today" | "upcoming" | "later" | "none";

export const UPCOMING_WINDOW_DAYS = 7;

/** Only open work needs doing; completed items live behind the "Done" tab. */
export const OPEN_STATE_GROUPS = "backlog,unstarted,started";
const PAGE_SIZE = 100;
const DONE_PAGE_SIZE = 50;

/** Every My Work SWR key shares this prefix so a status change can revalidate all of them at once. */
const SWR_PREFIX = "HOME_MY_WORK_";

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

export const getDueBucket = (targetDate: string | null | undefined): TDueBucket => {
  if (!targetDate) return "none";
  const today = todayString();
  if (targetDate < today) return "overdue";
  if (targetDate === today) return "today";
  if (targetDate <= addDaysToDateString(today, UPCOMING_WINDOW_DAYS)) return "upcoming";
  return "later";
};

/** Maps a real state group to the simplified visual status; overdue wins over "to do" / "in progress". */
export const getVisualStatus = (
  group: TStateGroups | null | undefined,
  targetDate: string | null | undefined
): TVisualStatus => {
  if (group === "completed") return "done";
  if (group === "cancelled") return "cancelled";
  if (getDueBucket(targetDate) === "overdue") return "overdue";
  if (group === "started") return "in_progress";
  return "todo";
};

const fetchItems = async (workspaceSlug: string, params: Record<string, string | number>) => {
  const response = await workspaceService.getViewIssues(workspaceSlug, params);
  // the workspace endpoint never groups, so `results` is always a flat list
  return (response?.results ?? []) as unknown as TMyWorkItem[];
};

const isMyWorkKey = (key: unknown) => typeof key === "string" && key.startsWith(SWR_PREFIX);

/** Re-fetches every My Work list (open + done) after a task changes from a card. */
export const revalidateMyWork = () => mutate(isMyWorkKey, undefined, { revalidate: true });

/** Optimistically rewrites one item across every cached My Work list; the caller revalidates afterwards. */
export const patchMyWorkItemInCache = (itemId: string, patch: Partial<TMyWorkItem>) =>
  mutate(
    isMyWorkKey,
    (current?: TMyWorkItem[]) => current?.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    { revalidate: false }
  );

/**
 * The current user's own open tasks: the single fetch behind the summary cards, Today,
 * the task board and Coming Up, so nothing on the page requests the same list twice.
 */
export const useMyWorkItems = (workspaceSlug: string | undefined, currentUserId: string | undefined) => {
  const {
    data,
    isLoading,
    error,
    mutate: retry,
  } = useSWR(
    workspaceSlug && currentUserId ? `${SWR_PREFIX}${workspaceSlug}_${currentUserId}_open` : null,
    workspaceSlug && currentUserId
      ? () =>
          fetchItems(workspaceSlug, {
            assignees: currentUserId,
            state_group: OPEN_STATE_GROUPS,
            order_by: "target_date",
            per_page: PAGE_SIZE,
            cursor: `${PAGE_SIZE}:0:0`,
          })
      : null,
    { revalidateIfStale: true, revalidateOnFocus: false, revalidateOnReconnect: true }
  );

  return { workItems: data ?? [], isLoading, error, retry: () => void retry() };
};

/** Recently completed work, fetched lazily, only once the "Done" tab is opened. */
export const useMyDoneItems = (
  workspaceSlug: string | undefined,
  currentUserId: string | undefined,
  enabled: boolean
) => {
  const { data, isLoading } = useSWR(
    enabled && workspaceSlug && currentUserId ? `${SWR_PREFIX}${workspaceSlug}_${currentUserId}_done` : null,
    enabled && workspaceSlug && currentUserId
      ? () =>
          fetchItems(workspaceSlug, {
            assignees: currentUserId,
            state_group: "completed",
            order_by: "-updated_at",
            per_page: DONE_PAGE_SIZE,
            cursor: `${DONE_PAGE_SIZE}:0:0`,
          })
      : null,
    { revalidateIfStale: true, revalidateOnFocus: false, revalidateOnReconnect: true }
  );

  return { doneItems: data ?? [], isLoading };
};

/** Resolves an item's state group from the workspace state store (the list endpoint only sends the id). */
export const useItemStateGroup = () => {
  const { getStateById } = useProjectState();
  return (item: Pick<TMyWorkItem, "state_id">): TStateGroups | null => getStateById(item.state_id)?.group ?? null;
};
