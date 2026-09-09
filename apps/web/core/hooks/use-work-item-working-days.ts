/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { TWorkItemDatesUpdate } from "@plane/utils";
import {
  getWorkingDaysBetweenDates,
  isValidWorkingDaysCount,
  renderFormattedPayloadDate,
  resolveStartDateChange,
  resolveWorkingDaysChange,
} from "@plane/utils";

export type { TWorkItemDatesUpdate };

type TUseWorkItemWorkingDaysProps = {
  /** current start date of the task, in the `yyyy-mm-dd` payload format */
  startDate: string | null | undefined;
  /** current due date of the task, in the `yyyy-mm-dd` payload format */
  targetDate: string | null | undefined;
  /** applies a date update, either to the form state or straight to the task */
  onDatesChange: (update: TWorkItemDatesUpdate) => void;
  /** changing this drops the duration driven mode, e.g. when a different task is shown */
  resetKey?: string;
};

type TUseWorkItemWorkingDaysReturn = {
  /** working days to show in the input: the entered value, or the one implied by the current dates */
  workingDays: number | undefined;
  /** true once working days have been entered, which makes the due date follow the start date */
  isDurationDriven: boolean;
  handleStartDateChange: (date: Date | null) => void;
  handleTargetDateChange: (date: Date | null) => void;
  handleWorkingDaysChange: (workingDays: number | null) => void;
};

/**
 * Keeps a task's start date, due date and working days in sync.
 *
 * Working days are never stored: they are derived from the two dates that Plane already persists, so
 * existing tasks show a working days value without any migration. Entering a value switches the
 * task into a duration driven schedule for the current editing session, where the due date is
 * recalculated whenever the start date or the working days change. Picking a due date by hand always
 * wins and hands control back to the plain start date + due date workflow.
 */
export const useWorkItemWorkingDays = (props: TUseWorkItemWorkingDaysProps): TUseWorkItemWorkingDaysReturn => {
  const { startDate, targetDate, onDatesChange, resetKey } = props;
  // a non null value means the user drives the schedule through working days
  const [enteredWorkingDays, setEnteredWorkingDays] = useState<number | null>(null);
  // keep the latest handler around so the callbacks below stay stable
  const onDatesChangeRef = useRef(onDatesChange);
  onDatesChangeRef.current = onDatesChange;

  // a different task starts from the plain start date + due date workflow again
  useEffect(() => {
    setEnteredWorkingDays(null);
  }, [resetKey]);

  const derivedWorkingDays = getWorkingDaysBetweenDates(startDate, targetDate);
  const isDurationDriven = enteredWorkingDays !== null;

  const handleStartDateChange = useCallback(
    (date: Date | null) => {
      onDatesChangeRef.current(resolveStartDateChange(date, enteredWorkingDays));
    },
    [enteredWorkingDays]
  );

  const handleTargetDateChange = useCallback((date: Date | null) => {
    // a manually picked due date always wins, so stop deriving it from working days
    setEnteredWorkingDays(null);
    onDatesChangeRef.current({ target_date: date ? (renderFormattedPayloadDate(date) ?? null) : null });
  }, []);

  const handleWorkingDaysChange = useCallback(
    (workingDays: number | null) => {
      // clearing the field hands control back to the start date + due date workflow
      if (workingDays === null) {
        setEnteredWorkingDays(null);
        return;
      }
      if (!isValidWorkingDaysCount(workingDays)) return;
      setEnteredWorkingDays(workingDays);
      // without a start date there is nothing to count from, the due date follows once one is picked
      const update = resolveWorkingDaysChange(startDate, workingDays);
      if (update) onDatesChangeRef.current(update);
    },
    [startDate]
  );

  return {
    workingDays: enteredWorkingDays ?? derivedWorkingDays,
    isDurationDriven,
    handleStartDateChange,
    handleTargetDateChange,
    handleWorkingDaysChange,
  };
};
