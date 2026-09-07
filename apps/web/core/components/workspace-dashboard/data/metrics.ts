/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Pure, deterministic metric calculations for the Geotech3D operations dashboard.
 *
 * Business mapping (see README.md in the parent folder):
 *   Module   = client job          Work item = actual work
 *   Label    = department          Assignee  = employee
 *
 * Every number shown on the dashboard is derived here from real workspace data
 * (modules, work items, states). Nothing is estimated or fabricated; where the data
 * model cannot support a metric the metric is omitted rather than approximated.
 */

import type { IModule, IState, TModuleStatus, TStateGroups } from "@plane/types";
import type { TWorkspaceDashboardWorkItem } from "@/services/workspace-dashboard.service";
import type {
  TDashboardWorkItem,
  TDepartmentRow,
  TEmployeeRow,
  TException,
  TJobHealth,
  TJobRow,
  TPipelineStage,
  TWorkspaceDashboardFilters,
  TWorkspaceDashboardMetrics,
} from "./types";

/** A work item is "open" while its state belongs to one of these groups. */
export const OPEN_STATE_GROUPS: TStateGroups[] = ["backlog", "unstarted", "started"];

/** "Due soon" / "due this week" = due date within today .. today + this many days. */
export const DUE_SOON_WINDOW_DAYS = 7;

/**
 * A job is "at risk" when the share of its timeline that has elapsed exceeds the share of
 * its work items that are completed by more than this many percentage points.
 */
export const SCHEDULE_GAP_THRESHOLD = 20;

/** A module counts as an active job unless it is completed or cancelled (archived modules are never returned). */
export const ACTIVE_MODULE_STATUSES: TModuleStatus[] = ["backlog", "planned", "in-progress", "paused"];

/** Order used to sort jobs: worst first. */
export const JOB_HEALTH_ORDER: TJobHealth[] = ["delayed", "blocked", "at_risk", "on_track"];

const STATE_GROUP_ORDER: TStateGroups[] = ["backlog", "unstarted", "started", "completed", "cancelled"];

const MS_PER_DAY = 86_400_000;

/** Converts a `YYYY-MM-DD` string into a whole day number so comparisons ignore time zones. */
export const toDayNumber = (date: string | null | undefined): number | undefined => {
  if (!date) return undefined;
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
};

/** Today's local calendar date as a day number. */
export const getTodayDayNumber = (now: Date = new Date()): number =>
  Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY);

const isOpenGroup = (group: TStateGroups | null | undefined): boolean => !!group && OPEN_STATE_GROUPS.includes(group);

export const isActiveModule = (module: IModule): boolean =>
  !module.archived_at && ACTIVE_MODULE_STATUSES.includes(module.status ?? "planned");

/**
 * Adds the derived flags every widget relies on.
 * A work item is blocked when it has a `blocked_by` relation to a work item that is still open.
 * If the blocking work item's state cannot be resolved it is conservatively treated as open.
 */
export const enrichWorkItems = (
  workItems: TWorkspaceDashboardWorkItem[],
  getStateGroup: (stateId: string | null | undefined) => TStateGroups | null,
  today: number
): TDashboardWorkItem[] =>
  workItems
    .filter((item) => !item.is_draft && !item.archived_at)
    // oxlint-disable-next-line oxc/no-map-spread -- the API objects are cached by SWR and must not be mutated
    .map((item) => {
      const stateGroup = getStateGroup(item.state_id);
      const isOpen = isOpenGroup(stateGroup);
      const dueDay = toDayNumber(item.target_date);
      const daysFromDue = dueDay === undefined ? undefined : today - dueDay;
      const isOverdue = isOpen && daysFromDue !== undefined && daysFromDue > 0;
      const isDueSoon = isOpen && daysFromDue !== undefined && daysFromDue <= 0 && -daysFromDue <= DUE_SOON_WINDOW_DAYS;
      const isBlocked =
        isOpen &&
        (item.issue_relation ?? []).some((relation) => {
          if (relation.relation_type !== "blocked_by") return false;
          const blockerGroup = getStateGroup(relation.state_id);
          return blockerGroup === null || isOpenGroup(blockerGroup);
        });
      return {
        ...item,
        stateGroup,
        isOpen,
        isOverdue,
        isDueSoon,
        isBlocked,
        daysFromDue,
      };
    });

export const applyWorkItemFilters = (
  workItems: TDashboardWorkItem[],
  filters: TWorkspaceDashboardFilters
): TDashboardWorkItem[] =>
  workItems.filter(
    (item) =>
      (!filters.projectId || item.project_id === filters.projectId) &&
      (!filters.moduleId || item.module_ids.includes(filters.moduleId)) &&
      (!filters.labelId || item.label_ids.includes(filters.labelId)) &&
      (!filters.assigneeId || item.assignee_ids.includes(filters.assigneeId))
  );

export const applyModuleFilters = (modules: IModule[], filters: TWorkspaceDashboardFilters): IModule[] =>
  modules.filter(
    (module) =>
      (!filters.projectId || module.project_id === filters.projectId) &&
      (!filters.moduleId || module.id === filters.moduleId)
  );

/**
 * Job health, evaluated in this order (first match wins):
 *   delayed  - the module's due date has passed and the module is not marked completed
 *   blocked  - at least one open work item in the job is blocked
 *   at_risk  - at least one open work item is overdue, or the elapsed share of the
 *              module timeline is more than SCHEDULE_GAP_THRESHOLD points ahead of completion
 *   on_track - everything else (including jobs without dates, which cannot be late)
 */
export const computeJobRow = (module: IModule, workItems: TDashboardWorkItem[], today: number): TJobRow => {
  const jobItems = workItems.filter((item) => item.module_ids.includes(module.id));
  const openItems = jobItems.filter((item) => item.isOpen);
  const overdueItems = openItems.filter((item) => item.isOverdue).length;
  const blockedItems = openItems.filter((item) => item.isBlocked).length;
  const totalItems = module.total_issues ?? 0;
  const progress = totalItems > 0 ? Math.round(((module.completed_issues ?? 0) / totalItems) * 100) : 0;

  const dueDay = toDayNumber(module.target_date);
  const startDay = toDayNumber(module.start_date);
  const daysFromDue = dueDay === undefined ? undefined : today - dueDay;

  let scheduleGap = 0;
  if (startDay !== undefined && dueDay !== undefined && dueDay > startDay && totalItems > 0) {
    const elapsed = Math.min(Math.max((today - startDay) / (dueDay - startDay), 0), 1) * 100;
    scheduleGap = elapsed - progress;
  }

  let health: TJobHealth = "on_track";
  if (daysFromDue !== undefined && daysFromDue > 0 && module.status !== "completed") health = "delayed";
  else if (blockedItems > 0) health = "blocked";
  else if (overdueItems > 0 || scheduleGap > SCHEDULE_GAP_THRESHOLD) health = "at_risk";

  return {
    module,
    health,
    progress,
    totalItems,
    openItems: openItems.length,
    overdueItems,
    blockedItems,
    daysFromDue,
  };
};

const compareJobs = (a: TJobRow, b: TJobRow): number => {
  const healthDiff = JOB_HEALTH_ORDER.indexOf(a.health) - JOB_HEALTH_ORDER.indexOf(b.health);
  if (healthDiff !== 0) return healthDiff;
  // earliest due first, jobs without a due date last
  const aDue = a.module.target_date ?? "9999-12-31";
  const bDue = b.module.target_date ?? "9999-12-31";
  return aDue.localeCompare(bDue) || a.module.name.localeCompare(b.module.name);
};

export const computeEmployeeRows = (workItems: TDashboardWorkItem[]): TEmployeeRow[] => {
  const rows = new Map<string | null, TEmployeeRow>();
  const bump = (assigneeId: string | null, item: TDashboardWorkItem) => {
    const row = rows.get(assigneeId) ?? {
      assigneeId,
      active: 0,
      dueSoon: 0,
      overdue: 0,
      blocked: 0,
    };
    row.active += 1;
    if (item.isDueSoon) row.dueSoon += 1;
    if (item.isOverdue) row.overdue += 1;
    if (item.isBlocked) row.blocked += 1;
    rows.set(assigneeId, row);
  };
  workItems
    .filter((item) => item.isOpen)
    .forEach((item) => {
      if (item.assignee_ids.length === 0) bump(null, item);
      else item.assignee_ids.forEach((assigneeId) => bump(assigneeId, item));
    });
  // oxlint-disable-next-line unicorn/no-array-sort -- freshly created array, safe to sort in place
  return Array.from(rows.values()).sort((a, b) => {
    // unassigned work always goes last; otherwise busiest first
    if (a.assigneeId === null) return 1;
    if (b.assigneeId === null) return -1;
    return b.active - a.active || b.overdue - a.overdue;
  });
};

export const computeDepartmentRows = (workItems: TDashboardWorkItem[]): TDepartmentRow[] => {
  const rows = new Map<string | null, TDepartmentRow>();
  const bump = (labelId: string | null, item: TDashboardWorkItem) => {
    const row = rows.get(labelId) ?? {
      labelId,
      active: 0,
      overdue: 0,
      completed: 0,
      blocked: 0,
    };
    if (item.isOpen) row.active += 1;
    if (item.isOverdue) row.overdue += 1;
    if (item.isBlocked) row.blocked += 1;
    if (item.stateGroup === "completed") row.completed += 1;
    rows.set(labelId, row);
  };
  workItems.forEach((item) => {
    if (item.label_ids.length === 0) bump(null, item);
    else item.label_ids.forEach((labelId) => bump(labelId, item));
  });
  return (
    Array.from(rows.values())
      .filter((row) => row.active + row.completed > 0)
      // oxlint-disable-next-line unicorn/no-array-sort -- freshly created array, safe to sort in place
      .sort((a, b) => {
        if (a.labelId === null) return 1;
        if (b.labelId === null) return -1;
        return b.active - a.active || b.overdue - a.overdue;
      })
  );
};

/**
 * Work pipeline = the workspace's real workflow states. States that share a name across
 * projects are merged so the pipeline reads as one flow; stages are ordered by state
 * group and then by the state's own sequence.
 */
export const computePipeline = (workItems: TDashboardWorkItem[], states: IState[]): TPipelineStage[] => {
  const stages = new Map<string, TPipelineStage & { sequence: number; stateIds: Set<string> }>();
  states.forEach((state) => {
    const key = state.name.trim().toLowerCase();
    const existing = stages.get(key);
    if (existing) {
      existing.stateIds.add(state.id);
      existing.sequence = Math.min(existing.sequence, state.sequence);
    } else {
      stages.set(key, {
        name: state.name,
        group: state.group,
        color: state.color,
        count: 0,
        sequence: state.sequence,
        stateIds: new Set([state.id]),
      });
    }
  });
  const stageByStateId = new Map<string, TPipelineStage>();
  stages.forEach((stage) => stage.stateIds.forEach((stateId) => stageByStateId.set(stateId, stage)));
  workItems.forEach((item) => {
    const stage = item.state_id ? stageByStateId.get(item.state_id) : undefined;
    if (stage) stage.count += 1;
  });
  return (
    Array.from(stages.values())
      // oxlint-disable-next-line unicorn/no-array-sort -- freshly created array, safe to sort in place
      .sort(
        (a, b) => STATE_GROUP_ORDER.indexOf(a.group) - STATE_GROUP_ORDER.indexOf(b.group) || a.sequence - b.sequence
      )
      .map(({ name, group, color, count }) => ({ name, group, color, count }))
  );
};

const attentionRank = (item: TDashboardWorkItem): number => (item.isOverdue ? 0 : item.isBlocked ? 1 : 2);

/** Open work that needs attention: overdue first (most overdue on top), then blocked, then due soon. */
export const computeAttentionList = (workItems: TDashboardWorkItem[]): TDashboardWorkItem[] =>
  workItems
    .filter((item) => item.isOverdue || item.isBlocked || item.isDueSoon)
    // oxlint-disable-next-line unicorn/no-array-sort -- freshly created array, safe to sort in place
    .sort((a, b) => {
      const rankDiff = attentionRank(a) - attentionRank(b);
      if (rankDiff !== 0) return rankDiff;
      return (b.daysFromDue ?? -Infinity) - (a.daysFromDue ?? -Infinity);
    });

export const computeMetrics = (input: {
  modules: IModule[];
  workItems: TDashboardWorkItem[];
  states: IState[];
  today: number;
}): TWorkspaceDashboardMetrics => {
  const { modules, workItems, states, today } = input;
  const openItems = workItems.filter((item) => item.isOpen);

  const jobs = modules
    .filter(isActiveModule)
    .map((module) => computeJobRow(module, workItems, today))
    // oxlint-disable-next-line unicorn/no-array-sort -- freshly created array, safe to sort in place
    .sort(compareJobs);

  const jobHealth: Record<TJobHealth, number> = {
    on_track: 0,
    at_risk: 0,
    delayed: 0,
    blocked: 0,
  };
  jobs.forEach((job) => {
    jobHealth[job.health] += 1;
  });

  const kpis = {
    activeJobs: jobs.length,
    jobsAtRisk: jobs.filter((job) => job.health !== "on_track").length,
    overdueTasks: openItems.filter((item) => item.isOverdue).length,
    dueThisWeek: openItems.filter((item) => item.isDueSoon).length,
    blockedTasks: openItems.filter((item) => item.isBlocked).length,
    noDueDateTasks: openItems.filter((item) => !item.target_date).length,
  };

  const candidates: TException[] = [
    {
      key: "delayed_jobs",
      severity: "critical",
      count: jobHealth.delayed,
      targetWidget: "active_jobs",
    },
    {
      key: "overdue_tasks",
      severity: "critical",
      count: kpis.overdueTasks,
      targetWidget: "attention_list",
    },
    {
      key: "blocked_jobs",
      severity: "critical",
      count: jobHealth.blocked,
      targetWidget: "active_jobs",
    },
    {
      key: "at_risk_jobs",
      severity: "warning",
      count: jobHealth.at_risk,
      targetWidget: "active_jobs",
    },
    {
      key: "blocked_tasks",
      severity: "warning",
      count: kpis.blockedTasks,
      targetWidget: "attention_list",
    },
    {
      key: "due_this_week",
      severity: "info",
      count: kpis.dueThisWeek,
      targetWidget: "attention_list",
    },
    {
      key: "unassigned_tasks",
      severity: "info",
      count: openItems.filter((item) => item.assignee_ids.length === 0).length,
      targetWidget: "employee_workload",
    },
    {
      key: "no_due_date_tasks",
      severity: "info",
      count: kpis.noDueDateTasks,
      targetWidget: "employee_workload",
    },
    {
      key: "jobs_without_due_date",
      severity: "info",
      count: jobs.filter((job) => !job.module.target_date).length,
      targetWidget: "active_jobs",
    },
  ];

  return {
    kpis,
    exceptions: candidates.filter((exception) => exception.count > 0),
    jobHealth,
    jobs,
    employees: computeEmployeeRows(workItems),
    departments: computeDepartmentRows(workItems),
    pipeline: computePipeline(workItems, states),
    attention: computeAttentionList(workItems),
  };
};
