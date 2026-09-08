/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TEmployeeGanttWorkItem } from "@/services/employee-gantt.service";
// local imports
import { toDayNumber } from "./timeline";
import type {
  TAssignmentDateKind,
  TEmployeeAssignment,
  TEmployeeCapacity,
  TEmployeeGanttFilters,
  TEmployeeGanttSummary,
  TEmployeeSchedule,
  TOverlapWindow,
} from "./types";

/**
 * Turns the flat cross-project work item list into one lane per employee.
 *
 * Everything here is pure so the rules are testable and obvious:
 *  - a work item becomes one assignment per assignee (that is what puts the same job on two lanes)
 *  - only work items with at least one date can be placed on the timeline
 *  - "open" means the state group is not completed and not cancelled
 */

/** Number of simultaneous open assignments at which an employee counts as overloaded. */
export const OVERLOADED_THRESHOLD = 3;
/** Number of simultaneous open assignments at which an employee counts as busy. */
export const BUSY_THRESHOLD = 2;

const isCompletedItem = (item: TEmployeeGanttWorkItem): boolean => item.state__group === "completed";
const isCancelledItem = (item: TEmployeeGanttWorkItem): boolean => item.state__group === "cancelled";

/** Open = still being worked on, i.e. backlog, unstarted or started. */
export const isOpenItem = (item: TEmployeeGanttWorkItem): boolean => !isCompletedItem(item) && !isCancelledItem(item);

/**
 * Resolves the inclusive day range of a work item.
 * Returns `null` when the item carries no date at all and therefore cannot be scheduled.
 */
export const resolveRange = (
  item: TEmployeeGanttWorkItem
): { startDay: number; endDay: number; dateKind: TAssignmentDateKind } | null => {
  const start = toDayNumber(item.start_date);
  const end = toDayNumber(item.target_date);
  if (start !== undefined && end !== undefined) {
    // tolerate inverted dates rather than rendering a negative width bar
    return { startDay: Math.min(start, end), endDay: Math.max(start, end), dateKind: "full" };
  }
  if (end !== undefined) return { startDay: end, endDay: end, dateKind: "target_only" };
  if (start !== undefined) return { startDay: start, endDay: start, dateKind: "start_only" };
  return null;
};

/**
 * Packs assignments into sub-rows so overlapping bars are never drawn on top of each other.
 * Greedy first-fit over start day; the number of lanes equals the peak concurrency.
 */
export const packLanes = (assignments: TEmployeeAssignment[]): TEmployeeAssignment[][] => {
  const lanes: TEmployeeAssignment[][] = [];
  for (const assignment of assignments) {
    const lane = lanes.find((candidate) => {
      const last = candidate[candidate.length - 1];
      // ranges are inclusive, so touching on the same day already counts as an overlap
      return last !== undefined && last.endDay < assignment.startDay;
    });
    if (lane) lane.push(assignment);
    else lanes.push([assignment]);
  }
  return lanes;
};

/**
 * Sweeps the open assignments and returns the day ranges where more than one of them is active,
 * together with the peak number of simultaneous assignments inside each range.
 */
export const findOverlapWindows = (assignments: TEmployeeAssignment[]): TOverlapWindow[] => {
  const events: { day: number; delta: number }[] = [];
  for (const assignment of assignments) {
    events.push({ day: assignment.startDay, delta: 1 });
    // ranges are inclusive, so the assignment stops counting the day after it ends
    events.push({ day: assignment.endDay + 1, delta: -1 });
  }
  events.sort((a, b) => a.day - b.day || a.delta - b.delta);

  const windows: TOverlapWindow[] = [];
  let concurrent = 0;
  let current: TOverlapWindow | null = null;
  let index = 0;
  while (index < events.length) {
    const day = events[index].day;
    // apply every event on this day before looking at the running total
    while (index < events.length && events[index].day === day) {
      concurrent += events[index].delta;
      index++;
    }
    if (concurrent > 1) {
      if (current) current.peak = Math.max(current.peak, concurrent);
      else current = { startDay: day, endDay: day, peak: concurrent };
    } else if (current) {
      current.endDay = day - 1;
      windows.push(current);
      current = null;
    }
  }
  if (current) windows.push(current);
  return windows;
};

const capacityFor = (activeToday: number): TEmployeeCapacity => {
  if (activeToday === 0) return "available";
  if (activeToday >= OVERLOADED_THRESHOLD) return "overloaded";
  if (activeToday >= BUSY_THRESHOLD) return "busy";
  return "assigned";
};

type TBuildInput = {
  workItems: TEmployeeGanttWorkItem[];
  /** every workspace member id, so employees with no work still get a lane */
  employeeIds: string[];
  getEmployee: (userId: string) => { displayName: string; avatarUrl: string };
  filters: TEmployeeGanttFilters;
  today: number;
};

/**
 * Builds the employee lanes for the chart.
 * Filters are applied here rather than in the components so every derived count agrees with
 * what is actually drawn.
 */
export const buildSchedules = (input: TBuildInput): TEmployeeSchedule[] => {
  const { workItems, employeeIds, getEmployee, filters, today } = input;

  const relevantEmployeeIds = filters.employeeId
    ? employeeIds.filter((id) => id === filters.employeeId)
    : [...employeeIds];

  const byEmployee = new Map<string, TEmployeeAssignment[]>();
  const undatedByEmployee = new Map<string, number>();
  for (const employeeId of relevantEmployeeIds) {
    byEmployee.set(employeeId, []);
    undatedByEmployee.set(employeeId, 0);
  }

  for (const item of workItems) {
    if (filters.projectId && item.project_id !== filters.projectId) continue;
    const isCompleted = isCompletedItem(item);
    const isCancelled = isCancelledItem(item);
    // cancelled work is never scheduled work; completed work is opt-in
    if (isCancelled) continue;
    if (isCompleted && !filters.includeCompleted) continue;

    const range = resolveRange(item);
    // "today only" keeps just the work actually in progress today; undated work has no day at all,
    // so it cannot qualify and is not counted either
    if (filters.todayOnly && (!range || range.startDay > today || range.endDay < today)) continue;

    for (const assigneeId of item.assignee_ids ?? []) {
      const bucket = byEmployee.get(assigneeId);
      if (!bucket) continue;
      if (!range) {
        if (!isCompleted) undatedByEmployee.set(assigneeId, (undatedByEmployee.get(assigneeId) ?? 0) + 1);
        continue;
      }
      bucket.push({
        id: item.id,
        name: item.name,
        sequenceId: item.sequence_id,
        projectId: item.project_id,
        moduleIds: item.module_ids ?? [],
        stateId: item.state_id,
        stateGroup: item.state__group,
        priority: item.priority,
        startDay: range.startDay,
        endDay: range.endDay,
        durationDays: range.endDay - range.startDay + 1,
        dateKind: range.dateKind,
        startDate: item.start_date,
        targetDate: item.target_date,
        isCompleted,
        isCancelled,
        isOverdue: !isCompleted && range.endDay < today && item.target_date !== null,
        // filled in below, once the whole set for this employee is known
        isOverlapping: false,
      });
    }
  }

  const schedules: TEmployeeSchedule[] = [];
  for (const employeeId of relevantEmployeeIds) {
    // oxlint-disable-next-line unicorn/no-array-sort -- bucket built above, safe to sort in place
    const assignments = (byEmployee.get(employeeId) ?? []).sort(
      (a, b) => a.startDay - b.startDay || a.endDay - b.endDay || a.sequenceId - b.sequenceId
    );
    // only open work competes for an employee's time, so overlaps ignore completed bars
    const openAssignments = assignments.filter((assignment) => !assignment.isCompleted);
    const overlapWindows = findOverlapWindows(openAssignments);

    for (const assignment of openAssignments) {
      assignment.isOverlapping = overlapWindows.some(
        (window) => assignment.startDay <= window.endDay && assignment.endDay >= window.startDay
      );
    }

    const activeToday = openAssignments.filter(
      (assignment) => assignment.startDay <= today && assignment.endDay >= today
    ).length;
    const upcomingAssignments = openAssignments.filter((assignment) => assignment.startDay > today);
    const { displayName, avatarUrl } = getEmployee(employeeId);

    schedules.push({
      userId: employeeId,
      displayName,
      avatarUrl,
      assignments,
      lanes: packLanes(assignments),
      overlapWindows,
      peakConcurrency: overlapWindows.reduce(
        (peak, window) => Math.max(peak, window.peak),
        openAssignments.length > 0 ? 1 : 0
      ),
      activeToday,
      upcoming: upcomingAssignments.length,
      nextAssignment: upcomingAssignments[0] ?? null,
      undatedCount: undatedByEmployee.get(employeeId) ?? 0,
      overdueCount: openAssignments.filter((assignment) => assignment.isOverdue).length,
      capacity: capacityFor(activeToday),
    });
  }

  return schedules;
};

const CAPACITY_ORDER: Record<TEmployeeCapacity, number> = {
  overloaded: 0,
  busy: 1,
  assigned: 2,
  available: 3,
};

/** Applies the display-only filters and orders the lanes: busiest first, then alphabetically. */
export const applyDisplayFilters = (
  schedules: TEmployeeSchedule[],
  filters: TEmployeeGanttFilters
): TEmployeeSchedule[] => {
  const query = filters.search.trim().toLowerCase();
  return (
    schedules
      .filter((schedule) => {
        if (query && !schedule.displayName.toLowerCase().includes(query)) return false;
        if (filters.onlyOverlaps && schedule.overlapWindows.length === 0) return false;
        if (filters.hideEmptyEmployees && schedule.assignments.length === 0 && schedule.undatedCount === 0)
          return false;
        return true;
      })
      // oxlint-disable-next-line unicorn/no-array-sort -- `filter` already returned a new array
      .sort(
        (a, b) =>
          CAPACITY_ORDER[a.capacity] - CAPACITY_ORDER[b.capacity] ||
          b.overlapWindows.length - a.overlapWindows.length ||
          a.displayName.localeCompare(b.displayName)
      )
  );
};

/** The extremes of the scheduled work, used to size the timeline window. */
export const getDataRange = (schedules: TEmployeeSchedule[]): { startDay: number | null; endDay: number | null } => {
  let startDay: number | null = null;
  let endDay: number | null = null;
  for (const schedule of schedules) {
    for (const assignment of schedule.assignments) {
      if (startDay === null || assignment.startDay < startDay) startDay = assignment.startDay;
      if (endDay === null || assignment.endDay > endDay) endDay = assignment.endDay;
    }
  }
  return { startDay, endDay };
};

export const summarise = (schedules: TEmployeeSchedule[]): TEmployeeGanttSummary => ({
  totalEmployees: schedules.length,
  overloaded: schedules.filter((schedule) => schedule.capacity === "overloaded").length,
  available: schedules.filter((schedule) => schedule.capacity === "available").length,
  withOverlaps: schedules.filter((schedule) => schedule.overlapWindows.length > 0).length,
  scheduledAssignments: schedules.reduce((total, schedule) => total + schedule.assignments.length, 0),
  undatedAssignments: schedules.reduce((total, schedule) => total + schedule.undatedCount, 0),
});
