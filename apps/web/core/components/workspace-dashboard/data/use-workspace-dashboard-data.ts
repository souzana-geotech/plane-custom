/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
// plane imports
import { WORKSPACE_LABELS } from "@plane/constants";
import type { IModule, IState } from "@plane/types";
// hooks
import { useLabel } from "@/hooks/store/use-label";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
// services
import { ModuleService } from "@/services/module.service";
import { WorkspaceDashboardService } from "@/services/workspace-dashboard.service";
// local imports
import type { TWorkspaceDashboardContext } from "./context";
import {
  applyModuleFilters,
  applyWorkItemFilters,
  computeMetrics,
  enrichWorkItems,
  getTodayDayNumber,
} from "./metrics";
import type { TWorkspaceDashboardFilters } from "./types";

const moduleService = new ModuleService();
const workspaceDashboardService = new WorkspaceDashboardService();

const EMPTY_FILTERS: TWorkspaceDashboardFilters = {
  projectId: null,
  moduleId: null,
  labelId: null,
  assigneeId: null,
};

const EMPTY_MODULES: IModule[] = [];
const EMPTY_STATES: IState[] = [];

/**
 * Loads everything the dashboard needs through existing endpoints and stores:
 *  - modules of all joined projects (workspace modules endpoint)
 *  - tasks with relations of every joined project (project issues-detail endpoint)
 *  - workspace labels (label store) and states (state store, already loaded by the workspace wrapper)
 * and derives the filtered metrics from them.
 */
export const useWorkspaceDashboardData = (workspaceSlug: string): TWorkspaceDashboardContext => {
  // store hooks
  const { joinedProjectIds } = useProject();
  const { workspaceStates } = useProjectState();
  const { fetchWorkspaceLabels } = useLabel();
  // filters
  const [filters, setFilters] = useState<TWorkspaceDashboardFilters>(EMPTY_FILTERS);

  const projectKey = joinedProjectIds.join(",");

  const {
    data: modules,
    error: modulesError,
    isLoading: isModulesLoading,
    mutate: refetchModules,
  } = useSWR(
    workspaceSlug ? `WORKSPACE_DASHBOARD_MODULES_${workspaceSlug}` : null,
    workspaceSlug ? () => moduleService.getWorkspaceModules(workspaceSlug) : null,
    { revalidateOnFocus: false }
  );

  const {
    data: workItems,
    error: workItemsError,
    isLoading: isWorkItemsLoading,
    mutate: refetchWorkItems,
  } = useSWR(
    workspaceSlug ? `WORKSPACE_DASHBOARD_WORK_ITEMS_${workspaceSlug}_${projectKey}` : null,
    workspaceSlug
      ? async () => {
          const perProject = await Promise.all(
            joinedProjectIds.map((projectId) => workspaceDashboardService.getProjectWorkItems(workspaceSlug, projectId))
          );
          return perProject.flat();
        }
      : null,
    { revalidateOnFocus: false }
  );

  const {
    error: labelsError,
    isLoading: isLabelsLoading,
    mutate: refetchLabels,
  } = useSWR(
    workspaceSlug ? WORKSPACE_LABELS(workspaceSlug) : null,
    workspaceSlug ? () => fetchWorkspaceLabels(workspaceSlug) : null,
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  const retry = useCallback(() => {
    if (modulesError) refetchModules();
    if (workItemsError) refetchWorkItems();
    if (labelsError) refetchLabels();
  }, [labelsError, modulesError, refetchLabels, refetchModules, refetchWorkItems, workItemsError]);

  const updateFilters = useCallback((patch: Partial<TWorkspaceDashboardFilters>) => {
    setFilters((previous) => ({ ...previous, ...patch }));
  }, []);

  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const today = getTodayDayNumber();
  const states = workspaceStates ?? EMPTY_STATES;

  const allModules = useMemo(() => modules ?? EMPTY_MODULES, [modules]);

  const stateGroupById = useMemo(() => new Map(states.map((state) => [state.id, state.group])), [states]);

  const allWorkItems = useMemo(
    () => enrichWorkItems(workItems ?? [], (stateId) => (stateId && stateGroupById.get(stateId)) || null, today),
    [workItems, stateGroupById, today]
  );

  const metrics = useMemo(
    () =>
      computeMetrics({
        modules: applyModuleFilters(allModules, filters),
        workItems: applyWorkItemFilters(allWorkItems, filters),
        states,
        today,
      }),
    [allModules, allWorkItems, filters, states, today]
  );

  const hasActiveFilters = Object.values(filters).some((value) => value !== null);

  return {
    workspaceSlug,
    isLoading: isModulesLoading || isWorkItemsLoading || isLabelsLoading || workspaceStates === undefined,
    error: modulesError ?? workItemsError ?? labelsError,
    retry,
    allModules,
    allWorkItems,
    filters,
    updateFilters,
    clearFilters,
    hasActiveFilters,
    metrics,
  };
};
