/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createContext, useContext } from "react";
import type { IModule } from "@plane/types";
import type { TDashboardWorkItem, TWorkspaceDashboardFilters, TWorkspaceDashboardMetrics } from "./types";

export type TWorkspaceDashboardContext = {
  workspaceSlug: string;
  /** true until modules, tasks and labels have all loaded for the first time */
  isLoading: boolean;
  /** set when any of the underlying requests failed */
  error: unknown;
  /** re-runs the failed requests */
  retry: () => void;
  /** every active module of the joined projects, before filters */
  allModules: IModule[];
  /** every task of the joined projects, before filters */
  allWorkItems: TDashboardWorkItem[];
  filters: TWorkspaceDashboardFilters;
  updateFilters: (patch: Partial<TWorkspaceDashboardFilters>) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;
  /** metrics computed from the filtered dataset */
  metrics: TWorkspaceDashboardMetrics;
};

export const WorkspaceDashboardContext = createContext<TWorkspaceDashboardContext | undefined>(undefined);

export const useWorkspaceDashboard = (): TWorkspaceDashboardContext => {
  const context = useContext(WorkspaceDashboardContext);
  if (context === undefined) throw new Error("useWorkspaceDashboard must be used within WorkspaceDashboardRoot");
  return context;
};
