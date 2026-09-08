/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IModule, IState } from "@plane/types";
import type { TWorkspaceDashboardWorkItem } from "@/services/workspace-dashboard.service";

/** Keys of the widgets rendered by the dashboard, in layout order. */
export type TWorkspaceDashboardWidgetKey =
  | "kpi_cards"
  | "management_exceptions"
  | "job_health"
  | "employee_workload"
  | "work_pipeline"
  | "department_workload"
  | "active_jobs"
  | "attention_list";

/** Severity levels used by KPI cards, exceptions and job health. */
export type TDashboardSeverity = "critical" | "warning" | "info" | "success";

/** Job (module) health classification. See `metrics.ts` for the rules. */
export type TJobHealth = "on_track" | "at_risk" | "delayed" | "blocked";

/** Client-side filters applied to the loaded dataset. `null` means "all". */
export type TWorkspaceDashboardFilters = {
  projectId: string | null;
  moduleId: string | null;
  labelId: string | null;
  assigneeId: string | null;
};

/** A work item enriched with the derived flags every widget needs. */
export type TDashboardWorkItem = TWorkspaceDashboardWorkItem & {
  /** state group resolved through the workspace state store (`null` when the state is unknown) */
  stateGroup: IState["group"] | null;
  /** open = state group is backlog, unstarted or started */
  isOpen: boolean;
  /** open and due date strictly before today */
  isOverdue: boolean;
  /** open and due date within today .. today + 7 days */
  isDueSoon: boolean;
  /** open and blocked by at least one work item that is still open */
  isBlocked: boolean;
  /** days past the due date (positive) or until it (negative); undefined without a due date */
  daysFromDue: number | undefined;
};

export type TJobRow = {
  module: IModule;
  health: TJobHealth;
  /** completed / total from the module counts, 0..100 */
  progress: number;
  totalItems: number;
  openItems: number;
  overdueItems: number;
  blockedItems: number;
  /** days past the module due date (positive = late); undefined without a due date */
  daysFromDue: number | undefined;
};

export type TEmployeeRow = {
  /** `null` groups unassigned open work */
  assigneeId: string | null;
  active: number;
  dueSoon: number;
  overdue: number;
  blocked: number;
};

export type TDepartmentRow = {
  /** `null` groups open work that carries no label */
  labelId: string | null;
  active: number;
  overdue: number;
  completed: number;
  blocked: number;
};

export type TPipelineStage = {
  /** state name (states with the same name across projects are merged) */
  name: string;
  group: IState["group"];
  color: string;
  count: number;
};

export type TExceptionKey =
  | "delayed_jobs"
  | "blocked_jobs"
  | "overdue_tasks"
  | "at_risk_jobs"
  | "blocked_tasks"
  | "due_this_week"
  | "unassigned_tasks"
  | "no_due_date_tasks"
  | "jobs_without_due_date";

export type TException = {
  key: TExceptionKey;
  severity: TDashboardSeverity;
  count: number;
  /** widget that shows the underlying items; clicking the exception scrolls to it */
  targetWidget: TWorkspaceDashboardWidgetKey;
};

export type TWorkspaceDashboardMetrics = {
  kpis: {
    activeJobs: number;
    jobsAtRisk: number;
    overdueTasks: number;
    dueThisWeek: number;
    blockedTasks: number;
    noDueDateTasks: number;
  };
  exceptions: TException[];
  jobHealth: Record<TJobHealth, number>;
  jobs: TJobRow[];
  employees: TEmployeeRow[];
  departments: TDepartmentRow[];
  pipeline: TPipelineStage[];
  attention: TDashboardWorkItem[];
};
