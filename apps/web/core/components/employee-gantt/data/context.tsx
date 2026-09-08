/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createContext, useContext } from "react";
// local imports
import type { TTimelineScale } from "./timeline";
import type { TEmployeeGanttFilters, TEmployeeGanttSummary, TEmployeeGanttZoom, TEmployeeSchedule } from "./types";

export type TEmployeeGanttContext = {
  workspaceSlug: string;
  /** true until the work item list has loaded for the first time */
  isLoading: boolean;
  /** set when the work item request failed */
  error: unknown;
  /** re-runs the failed request */
  retry: () => void;
  /** employee lanes after filters, in display order */
  schedules: TEmployeeSchedule[];
  /** roll-up of the filtered lanes */
  summary: TEmployeeGanttSummary;
  /** the shared horizontal scale every row and the header are drawn against */
  scale: TTimelineScale;
  zoom: TEmployeeGanttZoom;
  setZoom: (zoom: TEmployeeGanttZoom) => void;
  filters: TEmployeeGanttFilters;
  updateFilters: (patch: Partial<TEmployeeGanttFilters>) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;
  /** true when the workspace has no scheduled work at all and no filter is responsible */
  isEmpty: boolean;
  /** scrolls the chart back to today; the chart registers the implementation on mount */
  scrollToToday: () => void;
  registerScrollToToday: (handler: (() => void) | null) => void;
};

export const EmployeeGanttContext = createContext<TEmployeeGanttContext | undefined>(undefined);

export const useEmployeeGantt = (): TEmployeeGanttContext => {
  const context = useContext(EmployeeGanttContext);
  if (context === undefined) throw new Error("useEmployeeGantt must be used within EmployeeGanttRoot");
  return context;
};
