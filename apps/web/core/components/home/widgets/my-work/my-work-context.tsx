/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { observer } from "mobx-react";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUser } from "@/hooks/store/user";
// local imports
import { getDueBucket, useMyDoneItems, useMyWorkItems, type TMyWorkItem } from "./use-my-work-items";

/** The queue filters. `all` is the prioritised full workload; `done` is the recently completed list. */
export type TQueueFilter = "all" | "overdue" | "due_today" | "in_progress" | "upcoming" | "done";

/** The four attention buckets that carry a count in the filter bar. */
export type TCountedFilter = Exclude<TQueueFilter, "all" | "done">;

export type TMyWorkSummary = Record<TCountedFilter, number> & { all: number };

type TMyWorkContext = {
  workspaceSlug: string;
  /** The user's open work, already narrowed by the project filter. */
  workItems: TMyWorkItem[];
  /** Recently completed work; only fetched once the Done filter is opened. */
  doneItems: TMyWorkItem[];
  isLoading: boolean;
  isDoneLoading: boolean;
  error: unknown;
  retry: () => void;
  summary: TMyWorkSummary;
  filter: TQueueFilter;
  setFilter: (filter: TQueueFilter) => void;
  projectFilter: string | null;
  setProjectFilter: (projectId: string | null) => void;
  /** Whether an item falls into a counted bucket; shared by the filter bar and the queue. */
  matchesFilter: (item: TMyWorkItem, filter: TCountedFilter) => boolean;
};

const MyWorkContext = createContext<TMyWorkContext | undefined>(undefined);

export const useMyWork = () => {
  const context = useContext(MyWorkContext);
  if (!context) throw new Error("useMyWork must be used within MyWorkProvider");
  return context;
};

type TMyWorkProviderProps = {
  workspaceSlug: string;
  children: React.ReactNode;
};

/**
 * One fetch and one set of filters shared by the whole page, so the filter bar counts, the
 * queue and the header's project filter always describe the same list.
 */
export const MyWorkProvider = observer(function MyWorkProvider(props: TMyWorkProviderProps) {
  const { workspaceSlug, children } = props;
  const { data: currentUser } = useUser();
  const { getStateById } = useProjectState();
  const [filter, setFilter] = useState<TQueueFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const { workItems: allItems, isLoading, error, retry } = useMyWorkItems(workspaceSlug, currentUser?.id);
  const { doneItems: allDoneItems, isLoading: isDoneLoading } = useMyDoneItems(
    workspaceSlug,
    currentUser?.id,
    filter === "done"
  );

  const matchesFilter = useCallback(
    (item: TMyWorkItem, target: TCountedFilter) => {
      const bucket = getDueBucket(item.target_date);
      switch (target) {
        case "overdue":
          return bucket === "overdue";
        case "due_today":
          return bucket === "today";
        case "upcoming":
          return bucket === "upcoming";
        case "in_progress":
          return getStateById(item.state_id)?.group === "started";
        default:
          return false;
      }
    },
    [getStateById]
  );

  const byProject = useCallback(
    (items: TMyWorkItem[]) => (projectFilter ? items.filter((item) => item.project_id === projectFilter) : items),
    [projectFilter]
  );
  const workItems = useMemo(() => byProject(allItems), [allItems, byProject]);
  const doneItems = useMemo(() => byProject(allDoneItems), [allDoneItems, byProject]);

  const summary = useMemo<TMyWorkSummary>(
    () => ({
      all: workItems.length,
      overdue: workItems.filter((item) => matchesFilter(item, "overdue")).length,
      due_today: workItems.filter((item) => matchesFilter(item, "due_today")).length,
      in_progress: workItems.filter((item) => matchesFilter(item, "in_progress")).length,
      upcoming: workItems.filter((item) => matchesFilter(item, "upcoming")).length,
    }),
    [workItems, matchesFilter]
  );

  const value = useMemo<TMyWorkContext>(
    () => ({
      workspaceSlug,
      workItems,
      doneItems,
      isLoading,
      isDoneLoading,
      error,
      retry,
      summary,
      filter,
      setFilter,
      projectFilter,
      setProjectFilter,
      matchesFilter,
    }),
    [
      workspaceSlug,
      workItems,
      doneItems,
      isLoading,
      isDoneLoading,
      error,
      retry,
      summary,
      filter,
      projectFilter,
      matchesFilter,
    ]
  );

  return <MyWorkContext.Provider value={value}>{children}</MyWorkContext.Provider>;
});
