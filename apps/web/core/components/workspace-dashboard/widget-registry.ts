/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type React from "react";
// local imports
import type { TWorkspaceDashboardWidgetKey } from "./data/types";
import { ActiveJobsWidget } from "./widgets/active-jobs";
import { AttentionListWidget } from "./widgets/attention-list";
import { DepartmentWorkloadWidget } from "./widgets/department-workload";
import { EmployeeWorkloadWidget } from "./widgets/employee-workload";
import { JobHealthWidget } from "./widgets/job-health";
import { KpiCardsWidget } from "./widgets/kpi-cards";
import { ManagementExceptionsWidget } from "./widgets/management-exceptions";
import { WorkPipelineWidget } from "./widgets/work-pipeline";

export type { TWorkspaceDashboardWidgetKey };

export type TWorkspaceDashboardWidgetProps = {
  workspaceSlug: string;
};

export type TWorkspaceDashboardWidget = {
  key: TWorkspaceDashboardWidgetKey;
  component: React.FC<TWorkspaceDashboardWidgetProps>;
  // fullWidth widgets span the entire grid; the rest render two-up on large screens
  fullWidth: boolean;
};

/**
 * Layout order of the operations dashboard:
 *   KPI cards → management exceptions → job health | employee workload
 *   → work pipeline | department workload → active jobs → work needing attention
 */
export const WORKSPACE_DASHBOARD_WIDGETS: TWorkspaceDashboardWidget[] = [
  { key: "kpi_cards", component: KpiCardsWidget, fullWidth: true },
  {
    key: "management_exceptions",
    component: ManagementExceptionsWidget,
    fullWidth: true,
  },
  { key: "job_health", component: JobHealthWidget, fullWidth: false },
  {
    key: "employee_workload",
    component: EmployeeWorkloadWidget,
    fullWidth: false,
  },
  { key: "work_pipeline", component: WorkPipelineWidget, fullWidth: false },
  {
    key: "department_workload",
    component: DepartmentWorkloadWidget,
    fullWidth: false,
  },
  { key: "active_jobs", component: ActiveJobsWidget, fullWidth: true },
  { key: "attention_list", component: AttentionListWidget, fullWidth: true },
];
