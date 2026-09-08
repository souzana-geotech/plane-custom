/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TStateGroups } from "@plane/types";

/** Timeline zoom levels offered by the employee resource gantt. */
export type TEmployeeGanttZoom = "day" | "week" | "month";

/**
 * How busy an employee is *today*, derived from the number of open assignments whose
 * scheduled range contains today. Thresholds live in `schedule.ts`.
 */
export type TEmployeeCapacity = "available" | "assigned" | "busy" | "overloaded";

/** Scheduling completeness of a single assignment. */
export type TAssignmentDateKind =
  /** both a start and a target date */
  | "full"
  /** only a target date - rendered as a single day on the target */
  | "target_only"
  /** only a start date - rendered as a single day on the start */
  | "start_only";

/**
 * Dependency-delay projection attached to an assignment, resolved onto the timeline.
 * Comes from the dependency scheduling service; the assignment's own dates stay untouched.
 */
export type TAssignmentDependencyDelay = {
  /** inclusive first day of the adjusted period, as a whole day number */
  adjustedStartDay: number;
  /** inclusive last day of the adjusted period, as a whole day number */
  adjustedEndDay: number;
  /** raw values, kept for the tooltip */
  adjustedStartDate: string | null;
  adjustedTargetDate: string | null;
  /** upstream blocker that causes the delay */
  delayedByName: string;
  delayedBySequenceId: number;
  delayedByProjectIdentifier: string;
};

/**
 * One work item assigned to one employee, resolved onto the timeline.
 * Work items without any date never become an assignment; they are counted separately.
 */
export type TEmployeeAssignment = {
  /** work item id */
  id: string;
  name: string;
  sequenceId: number;
  projectId: string;
  moduleIds: string[];
  stateId: string | null;
  stateGroup: TStateGroups | null;
  priority: string | null;
  /** inclusive first day of the bar, as a whole day number */
  startDay: number;
  /** inclusive last day of the bar, as a whole day number */
  endDay: number;
  /** inclusive length of the bar in days, always >= 1 */
  durationDays: number;
  dateKind: TAssignmentDateKind;
  /** raw values, kept for the tooltip and the detail link */
  startDate: string | null;
  targetDate: string | null;
  isCompleted: boolean;
  isCancelled: boolean;
  /** open and target date strictly before today */
  isOverdue: boolean;
  /** overlaps at least one other open assignment of the same employee */
  isOverlapping: boolean;
  /** set when a delayed `blocked_by` dependency pushes this assignment; null otherwise */
  dependencyDelay: TAssignmentDependencyDelay | null;
};

/** A contiguous day range where an employee has more than one open assignment. */
export type TOverlapWindow = {
  startDay: number;
  endDay: number;
  /** highest number of simultaneous open assignments inside the window */
  peak: number;
};

/** One employee lane: the person plus every assignment packed into sub-rows. */
export type TEmployeeSchedule = {
  userId: string;
  displayName: string;
  avatarUrl: string;
  /** every scheduled assignment, sorted by start day */
  assignments: TEmployeeAssignment[];
  /**
   * assignments packed into sub-rows so that overlapping bars never cover each other.
   * A single lane means the employee has no overlapping work.
   */
  lanes: TEmployeeAssignment[][];
  /** day ranges where open assignments overlap */
  overlapWindows: TOverlapWindow[];
  /** highest number of simultaneous open assignments at any point */
  peakConcurrency: number;
  /** open assignments whose range contains today */
  activeToday: number;
  /** open assignments that start after today */
  upcoming: number;
  /** the next open assignment starting after today, if any */
  nextAssignment: TEmployeeAssignment | null;
  /** open assignments with no start and no target date, so they cannot be placed */
  undatedCount: number;
  overdueCount: number;
  capacity: TEmployeeCapacity;
};

/** Client-side filters. `null` means "all". */
export type TEmployeeGanttFilters = {
  projectId: string | null;
  employeeId: string | null;
  /** free-text match on the employee display name */
  search: string;
  /**
   * Show only assignments that are scheduled to be in progress today, i.e. whose inclusive date
   * range contains today. Work that ended before today or starts later drops out, as does undated
   * work, since none of it is scheduled for today.
   */
  todayOnly: boolean;
  /** include completed and cancelled work items in the chart */
  includeCompleted: boolean;
  /** hide employees that have no scheduled assignment at all */
  hideEmptyEmployees: boolean;
  /** only show employees with at least one overlap window */
  onlyOverlaps: boolean;
};

/** Roll-up shown above the chart. */
export type TEmployeeGanttSummary = {
  totalEmployees: number;
  overloaded: number;
  available: number;
  withOverlaps: number;
  scheduledAssignments: number;
  undatedAssignments: number;
};
