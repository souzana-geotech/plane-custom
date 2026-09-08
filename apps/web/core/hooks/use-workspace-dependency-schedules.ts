/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import useSWR from "swr";
// plane imports
import type { TWorkspaceDependencySchedule } from "@plane/types";
// services
import { IssueDependencyScheduleService } from "@/services/issue/issue_dependency_schedule.service";

const issueDependencyScheduleService = new IssueDependencyScheduleService();

/**
 * Dependency-delay projections of the workspace, keyed by work item id.
 *
 * Purely decorative data: consumers render identically with an empty map, so the
 * request never retries on error and a failure degrades silently. The SWR key is
 * shared, so multiple consumers on one page cause a single request.
 */
export const useWorkspaceDependencySchedules = (
  workspaceSlug: string | undefined
): Map<string, TWorkspaceDependencySchedule> => {
  const { data } = useSWR(
    workspaceSlug ? `WORKSPACE_DEPENDENCY_SCHEDULES_${workspaceSlug}` : null,
    workspaceSlug ? () => issueDependencyScheduleService.listWorkspace(workspaceSlug) : null,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  return useMemo(() => {
    const map = new Map<string, TWorkspaceDependencySchedule>();
    for (const row of data ?? []) map.set(row.issue_id, row);
    return map;
  }, [data]);
};
