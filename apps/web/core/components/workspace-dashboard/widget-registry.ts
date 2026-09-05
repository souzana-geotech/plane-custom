/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type React from "react";

import { CreatedVsResolvedWidget } from "./widgets/created-vs-resolved";
import { OverdueByAssigneeWidget } from "./widgets/overdue-by-assignee";
import { OverviewStatsWidget } from "./widgets/overview-stats";
import { PriorityBreakdownWidget } from "./widgets/priority-breakdown";
import { ProjectBreakdownWidget } from "./widgets/project-breakdown";
import { WorkItemStatsWidget } from "./widgets/work-item-stats";

export type TWorkspaceDashboardWidgetKey =
  | "overview_stats"
  | "work_item_stats"
  | "overdue_by_assignee"
  | "created_vs_resolved"
  | "priority_breakdown"
  | "project_breakdown";

export type TWorkspaceDashboardWidgetProps = {
  workspaceSlug: string;
};

export type TWorkspaceDashboardWidget = {
  key: TWorkspaceDashboardWidgetKey;
  component: React.FC<TWorkspaceDashboardWidgetProps>;
  // fullWidth widgets span the entire grid; the rest render two-up on large screens
  fullWidth: boolean;
};

export const WORKSPACE_DASHBOARD_WIDGETS: TWorkspaceDashboardWidget[] = [
  { key: "overview_stats", component: OverviewStatsWidget, fullWidth: true },
  { key: "work_item_stats", component: WorkItemStatsWidget, fullWidth: true },
  { key: "overdue_by_assignee", component: OverdueByAssigneeWidget, fullWidth: false },
  { key: "priority_breakdown", component: PriorityBreakdownWidget, fullWidth: false },
  { key: "created_vs_resolved", component: CreatedVsResolvedWidget, fullWidth: true },
  { key: "project_breakdown", component: ProjectBreakdownWidget, fullWidth: true },
];
