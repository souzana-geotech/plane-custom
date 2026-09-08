/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { getDate, renderFormattedPayloadDate } from "./datetime";

/**
 * Day-of-week index (as returned by `Date.prototype.getDay`) that is never counted as a working day.
 * Working days run Monday -> Saturday, so only Sunday is excluded.
 */
export const NON_WORKING_WEEK_DAY = 0;

/**
 * @returns {boolean} true when the provided date falls on a working day (Monday to Saturday)
 * @param {Date | string | undefined | null} date
 * @example isWorkingDay("2026-09-12") // true (Saturday)
 * @example isWorkingDay("2026-09-13") // false (Sunday)
 */
export const isWorkingDay = (date: Date | string | undefined | null): boolean => {
  const parsedDate = getDate(date);
  if (!parsedDate || isNaN(parsedDate.getTime())) return false;
  return parsedDate.getDay() !== NON_WORKING_WEEK_DAY;
};

/**
 * @returns {boolean} true when the value is a positive integer and can be used as a working days count
 * @param {unknown} workingDays
 * @example isValidWorkingDaysCount(3) // true
 * @example isValidWorkingDaysCount(0) // false
 * @example isValidWorkingDaysCount(1.5) // false
 */
export const isValidWorkingDaysCount = (workingDays: unknown): workingDays is number =>
  typeof workingDays === "number" && Number.isInteger(workingDays) && workingDays > 0;

/**
 * @returns {Date | undefined} the date on which the nth working day falls, counting the start date as the first one
 * @description Sundays are skipped. When the start date itself is a Sunday, the count begins on the following Monday.
 * @param {Date | string | undefined | null} startDate
 * @param {number} workingDays positive integer
 * @example getDueDateFromWorkingDays("2026-09-07", 3) // Wed Sep 09 2026 (Mon, Tue, Wed)
 * @example getDueDateFromWorkingDays("2026-09-12", 2) // Mon Sep 14 2026 (Sat, [skip Sun], Mon)
 */
export const getDueDateFromWorkingDays = (
  startDate: Date | string | undefined | null,
  workingDays: number
): Date | undefined => {
  const parsedStartDate = getDate(startDate);
  if (!parsedStartDate || isNaN(parsedStartDate.getTime())) return undefined;
  if (!isValidWorkingDaysCount(workingDays)) return undefined;

  // work on a copy so the caller's date is never mutated
  const dueDate = new Date(parsedStartDate.getFullYear(), parsedStartDate.getMonth(), parsedStartDate.getDate());

  // a start date that lands on a Sunday rolls forward to the next working day, which then counts as day one
  if (dueDate.getDay() === NON_WORKING_WEEK_DAY) dueDate.setDate(dueDate.getDate() + 1);

  // the start date is already the first working day, so only the remaining ones have to be walked
  let remainingDays = workingDays - 1;
  while (remainingDays > 0) {
    dueDate.setDate(dueDate.getDate() + 1);
    if (dueDate.getDay() !== NON_WORKING_WEEK_DAY) remainingDays -= 1;
  }

  return dueDate;
};

/**
 * @returns {number | undefined} number of working days in the inclusive range, or undefined when the range is invalid
 * @description Inverse of `getDueDateFromWorkingDays`. Sundays in the range are not counted.
 * @param {Date | string | undefined | null} startDate
 * @param {Date | string | undefined | null} endDate
 * @example getWorkingDaysBetweenDates("2026-09-07", "2026-09-09") // 3
 * @example getWorkingDaysBetweenDates("2026-09-12", "2026-09-14") // 2
 */
export const getWorkingDaysBetweenDates = (
  startDate: Date | string | undefined | null,
  endDate: Date | string | undefined | null
): number | undefined => {
  const parsedStartDate = getDate(startDate);
  const parsedEndDate = getDate(endDate);
  if (!parsedStartDate || !parsedEndDate) return undefined;
  if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) return undefined;

  const cursor = new Date(parsedStartDate.getFullYear(), parsedStartDate.getMonth(), parsedStartDate.getDate());
  const lastDate = new Date(parsedEndDate.getFullYear(), parsedEndDate.getMonth(), parsedEndDate.getDate());
  if (cursor.getTime() > lastDate.getTime()) return undefined;

  let workingDays = 0;
  while (cursor.getTime() <= lastDate.getTime()) {
    if (cursor.getDay() !== NON_WORKING_WEEK_DAY) workingDays += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  return workingDays;
};

/** partial date payload for a work item, matching the fields Plane already persists */
export type TWorkItemDatesUpdate = {
  start_date?: string | null;
  target_date?: string | null;
};

const toPayloadDate = (date: Date | string | undefined | null): string | null =>
  date ? (renderFormattedPayloadDate(date) ?? null) : null;

/**
 * @returns {TWorkItemDatesUpdate} the dates to apply when the start date changes
 * @description Outside of a duration driven schedule the due date is left exactly as the user set it.
 * With a working days count in play the due date follows the new start date, unless the start date is
 * being cleared and there is nothing left to count from.
 * @param {Date | string | null} nextStartDate the newly picked start date, null when cleared
 * @param {number | null} enteredWorkingDays working days entered by the user, null when none are in play
 */
export const resolveStartDateChange = (
  nextStartDate: Date | string | null,
  enteredWorkingDays: number | null
): TWorkItemDatesUpdate => {
  const startDate = toPayloadDate(nextStartDate);
  if (!startDate || !isValidWorkingDaysCount(enteredWorkingDays)) return { start_date: startDate };
  return {
    start_date: startDate,
    target_date: toPayloadDate(getDueDateFromWorkingDays(startDate, enteredWorkingDays)),
  };
};

/**
 * @returns {TWorkItemDatesUpdate | null} the dates to apply when the working days count changes, or
 * null when there is nothing to apply
 * @description Without a start date there is nothing to count from, so the due date is left alone and
 * follows once a start date is picked.
 * @param {Date | string | null | undefined} startDate the work item's current start date
 * @param {number} workingDays the newly entered working days count
 */
export const resolveWorkingDaysChange = (
  startDate: Date | string | null | undefined,
  workingDays: number
): TWorkItemDatesUpdate | null => {
  if (!isValidWorkingDaysCount(workingDays) || !startDate) return null;
  const dueDate = getDueDateFromWorkingDays(startDate, workingDays);
  if (!dueDate) return null;
  return { target_date: toPayloadDate(dueDate) };
};
