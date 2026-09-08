/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import useSWR from "swr";
// hooks
import { useMember } from "@/hooks/store/use-member";
// services
import { EmployeeGanttService } from "@/services/employee-gantt.service";
// local imports
import type { TEmployeeGanttContext } from "./context";
import { applyDisplayFilters, buildSchedules, getDataRange, summarise } from "./schedule";
import { buildTimelineScale, getTodayDayNumber } from "./timeline";
import type { TEmployeeGanttFilters, TEmployeeGanttZoom } from "./types";

const employeeGanttService = new EmployeeGanttService();

const EMPTY_FILTERS: TEmployeeGanttFilters = {
  projectId: null,
  employeeId: null,
  search: "",
  todayOnly: false,
  includeCompleted: false,
  hideEmptyEmployees: false,
  onlyOverlaps: false,
};

const EMPTY_MEMBER_IDS: string[] = [];

/**
 * Loads the workspace-wide work item list once and derives every employee lane from it.
 *
 * Members come from the member store, which the workspace wrapper already populates, so the only
 * request this page makes is the cross-project work item list.
 */
export const useEmployeeGanttData = (workspaceSlug: string): TEmployeeGanttContext => {
  // store hooks
  const {
    getUserDetails,
    workspace: { workspaceMemberIds },
  } = useMember();
  // local state
  const [filters, setFilters] = useState<TEmployeeGanttFilters>(EMPTY_FILTERS);
  const [zoom, setZoom] = useState<TEmployeeGanttZoom>("week");

  const {
    data: workItems,
    error,
    isLoading,
    mutate: refetch,
  } = useSWR(
    workspaceSlug ? `EMPLOYEE_GANTT_WORK_ITEMS_${workspaceSlug}` : null,
    workspaceSlug ? () => employeeGanttService.getWorkspaceWorkItems(workspaceSlug) : null,
    { revalidateOnFocus: false }
  );

  const retry = useCallback(() => {
    if (error) refetch();
  }, [error, refetch]);

  // the chart owns the scroll container, so it registers the handler the toolbar button calls
  const scrollToTodayRef = useRef<(() => void) | null>(null);
  const registerScrollToToday = useCallback((handler: (() => void) | null) => {
    scrollToTodayRef.current = handler;
  }, []);
  const scrollToToday = useCallback(() => scrollToTodayRef.current?.(), []);

  const updateFilters = useCallback((patch: Partial<TEmployeeGanttFilters>) => {
    setFilters((previous) => ({ ...previous, ...patch }));
  }, []);

  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const today = getTodayDayNumber();
  const employeeIds = workspaceMemberIds ?? EMPTY_MEMBER_IDS;

  // resolved outside the memo so a member arriving later re-runs the build
  const memberKey = employeeIds.join(",");

  const allSchedules = useMemo(
    () =>
      buildSchedules({
        workItems: workItems ?? [],
        employeeIds,
        getEmployee: (userId) => {
          const member = getUserDetails(userId);
          return {
            displayName: member?.display_name ?? userId,
            avatarUrl: member?.avatar_url ?? "",
          };
        },
        filters,
        today,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workItems, memberKey, getUserDetails, filters, today]
  );

  const schedules = useMemo(() => applyDisplayFilters(allSchedules, filters), [allSchedules, filters]);

  const summary = useMemo(() => summarise(schedules), [schedules]);

  const scale = useMemo(() => {
    // the window is sized from every lane, not just the visible ones, so switching a filter
    // does not make the timeline jump around
    const { startDay, endDay } = getDataRange(allSchedules);
    return buildTimelineScale(zoom, startDay, endDay, today);
  }, [allSchedules, zoom, today]);

  const hasActiveFilters =
    filters.projectId !== null ||
    filters.employeeId !== null ||
    filters.search.trim() !== "" ||
    filters.todayOnly ||
    filters.includeCompleted ||
    filters.hideEmptyEmployees ||
    filters.onlyOverlaps;

  // "empty" means the workspace genuinely has nothing scheduled. An empty result while a filter is
  // on is a filter outcome, not an empty workspace, and the root renders its own message for that.
  const isEmpty =
    !isLoading && !error && !hasActiveFilters && allSchedules.every((schedule) => schedule.assignments.length === 0);

  return {
    workspaceSlug,
    isLoading,
    error,
    retry,
    schedules,
    summary,
    scale,
    zoom,
    setZoom,
    filters,
    updateFilters,
    clearFilters,
    hasActiveFilters,
    isEmpty,
    scrollToToday,
    registerScrollToToday,
  };
};
