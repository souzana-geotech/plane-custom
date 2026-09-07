/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  getDueDateFromWorkingDays,
  getWorkingDaysBetweenDates,
  isValidWorkingDaysCount,
  isWorkingDay,
  resolveStartDateChange,
  resolveWorkingDaysChange,
} from "../src/working-days";

// September 2026 lines up with the dates used in the product spec
const MONDAY = "2026-09-07";
const TUESDAY = "2026-09-08";
const WEDNESDAY = "2026-09-09";
const SATURDAY = "2026-09-12";
const SUNDAY = "2026-09-13";
const NEXT_MONDAY = "2026-09-14";

const toPayloadDate = (date: Date | undefined): string | undefined => {
  if (!date) return undefined;
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

describe("isWorkingDay", () => {
  it("counts Monday through Saturday as working days", () => {
    expect(isWorkingDay(MONDAY)).toBe(true);
    expect(isWorkingDay(TUESDAY)).toBe(true);
    expect(isWorkingDay(WEDNESDAY)).toBe(true);
    expect(isWorkingDay("2026-09-10")).toBe(true);
    expect(isWorkingDay("2026-09-11")).toBe(true);
    expect(isWorkingDay(SATURDAY)).toBe(true);
  });

  it("never counts Sunday as a working day", () => {
    expect(isWorkingDay(SUNDAY)).toBe(false);
    expect(isWorkingDay("2026-09-06")).toBe(false);
    expect(isWorkingDay("2026-09-20")).toBe(false);
  });

  it("returns false for empty or invalid input", () => {
    expect(isWorkingDay(null)).toBe(false);
    expect(isWorkingDay(undefined)).toBe(false);
    expect(isWorkingDay("")).toBe(false);
  });
});

describe("isValidWorkingDaysCount", () => {
  it("accepts positive integers only", () => {
    expect(isValidWorkingDaysCount(1)).toBe(true);
    expect(isValidWorkingDaysCount(3)).toBe(true);
    expect(isValidWorkingDaysCount(365)).toBe(true);
  });

  it("rejects zero, negatives, fractions and non numbers", () => {
    expect(isValidWorkingDaysCount(0)).toBe(false);
    expect(isValidWorkingDaysCount(-2)).toBe(false);
    expect(isValidWorkingDaysCount(1.5)).toBe(false);
    expect(isValidWorkingDaysCount(NaN)).toBe(false);
    expect(isValidWorkingDaysCount("3")).toBe(false);
    expect(isValidWorkingDaysCount(null)).toBe(false);
    expect(isValidWorkingDaysCount(undefined)).toBe(false);
  });
});

describe("getDueDateFromWorkingDays", () => {
  it("matches the spec example: Monday + 3 working days is Wednesday", () => {
    expect(toPayloadDate(getDueDateFromWorkingDays(MONDAY, 3))).toBe(WEDNESDAY);
  });

  it("matches the spec example: Saturday + 2 working days skips Sunday and lands on Monday", () => {
    expect(toPayloadDate(getDueDateFromWorkingDays(SATURDAY, 2))).toBe(NEXT_MONDAY);
  });

  it("treats the start date itself as the first working day", () => {
    expect(toPayloadDate(getDueDateFromWorkingDays(MONDAY, 1))).toBe(MONDAY);
    expect(toPayloadDate(getDueDateFromWorkingDays(SATURDAY, 1))).toBe(SATURDAY);
  });

  it("rolls a Sunday start date forward to the next working day", () => {
    expect(toPayloadDate(getDueDateFromWorkingDays(SUNDAY, 1))).toBe(NEXT_MONDAY);
    expect(toPayloadDate(getDueDateFromWorkingDays(SUNDAY, 2))).toBe("2026-09-15");
  });

  it("skips every Sunday across multi week durations", () => {
    // Mon Sep 7 + 12 working days: 6 days to Sat Sep 12, 6 more from Mon Sep 14 to Sat Sep 19
    expect(toPayloadDate(getDueDateFromWorkingDays(MONDAY, 12))).toBe("2026-09-19");
    // Mon Sep 7 + 13 working days rolls into the third week
    expect(toPayloadDate(getDueDateFromWorkingDays(MONDAY, 13))).toBe("2026-09-21");
  });

  it("never returns a Sunday", () => {
    for (let workingDays = 1; workingDays <= 60; workingDays++) {
      const dueDate = getDueDateFromWorkingDays(MONDAY, workingDays);
      expect(dueDate?.getDay()).not.toBe(0);
    }
  });

  it("accepts a Date instance as the start date without mutating it", () => {
    const startDate = new Date(2026, 8, 7);
    expect(toPayloadDate(getDueDateFromWorkingDays(startDate, 3))).toBe(WEDNESDAY);
    expect(toPayloadDate(startDate)).toBe(MONDAY);
  });

  it("returns undefined for a missing start date or an invalid working days count", () => {
    expect(getDueDateFromWorkingDays(null, 3)).toBeUndefined();
    expect(getDueDateFromWorkingDays(undefined, 3)).toBeUndefined();
    expect(getDueDateFromWorkingDays(MONDAY, 0)).toBeUndefined();
    expect(getDueDateFromWorkingDays(MONDAY, -1)).toBeUndefined();
    expect(getDueDateFromWorkingDays(MONDAY, 2.5)).toBeUndefined();
  });
});

describe("getWorkingDaysBetweenDates", () => {
  it("is the inverse of getDueDateFromWorkingDays for the spec examples", () => {
    expect(getWorkingDaysBetweenDates(MONDAY, WEDNESDAY)).toBe(3);
    expect(getWorkingDaysBetweenDates(SATURDAY, NEXT_MONDAY)).toBe(2);
  });

  it("counts a single working day range as one", () => {
    expect(getWorkingDaysBetweenDates(MONDAY, MONDAY)).toBe(1);
    expect(getWorkingDaysBetweenDates(SATURDAY, SATURDAY)).toBe(1);
  });

  it("excludes Sundays inside the range", () => {
    // Mon Sep 7 to Mon Sep 14 spans 8 calendar days but only 7 working days
    expect(getWorkingDaysBetweenDates(MONDAY, NEXT_MONDAY)).toBe(7);
    // a range that is only a Sunday has no working days
    expect(getWorkingDaysBetweenDates(SUNDAY, SUNDAY)).toBe(0);
  });

  it("round trips against getDueDateFromWorkingDays", () => {
    for (let workingDays = 1; workingDays <= 60; workingDays++) {
      const dueDate = getDueDateFromWorkingDays(MONDAY, workingDays);
      expect(getWorkingDaysBetweenDates(MONDAY, dueDate)).toBe(workingDays);
    }
  });

  it("returns undefined when the range is incomplete or inverted", () => {
    expect(getWorkingDaysBetweenDates(null, WEDNESDAY)).toBeUndefined();
    expect(getWorkingDaysBetweenDates(MONDAY, null)).toBeUndefined();
    expect(getWorkingDaysBetweenDates(WEDNESDAY, MONDAY)).toBeUndefined();
  });
});

describe("resolveStartDateChange", () => {
  it("leaves the due date untouched when no working days are in play", () => {
    // the plain start date + due date workflow, unchanged for existing work items
    expect(resolveStartDateChange(MONDAY, null)).toEqual({ start_date: MONDAY });
    expect(resolveStartDateChange(null, null)).toEqual({ start_date: null });
  });

  it("recalculates the due date when working days drive the schedule", () => {
    expect(resolveStartDateChange(MONDAY, 3)).toEqual({ start_date: MONDAY, target_date: WEDNESDAY });
    // moving the start date to a Saturday keeps the 3 working days: Sat, [skip Sun], Mon, Tue
    expect(resolveStartDateChange(SATURDAY, 3)).toEqual({ start_date: SATURDAY, target_date: "2026-09-15" });
  });

  it("only touches the start date when it is cleared, there is nothing left to count from", () => {
    expect(resolveStartDateChange(null, 3)).toEqual({ start_date: null });
  });

  it("ignores an invalid working days count", () => {
    expect(resolveStartDateChange(MONDAY, 0)).toEqual({ start_date: MONDAY });
    expect(resolveStartDateChange(MONDAY, -4)).toEqual({ start_date: MONDAY });
  });
});

describe("resolveWorkingDaysChange", () => {
  it("moves the due date to the end of the new duration", () => {
    expect(resolveWorkingDaysChange(MONDAY, 3)).toEqual({ target_date: WEDNESDAY });
    expect(resolveWorkingDaysChange(SATURDAY, 2)).toEqual({ target_date: NEXT_MONDAY });
  });

  it("applies nothing without a start date to count from", () => {
    expect(resolveWorkingDaysChange(null, 3)).toBeNull();
    expect(resolveWorkingDaysChange(undefined, 3)).toBeNull();
  });

  it("applies nothing for a count that is not a positive integer", () => {
    expect(resolveWorkingDaysChange(MONDAY, 0)).toBeNull();
    expect(resolveWorkingDaysChange(MONDAY, -1)).toBeNull();
    expect(resolveWorkingDaysChange(MONDAY, 2.5)).toBeNull();
  });
});

describe("work item scheduling scenarios", () => {
  it("keeps a start date + due date work item working with no working days entered", () => {
    // an existing work item: the derived count is shown, and editing either date changes only that date
    expect(getWorkingDaysBetweenDates(MONDAY, WEDNESDAY)).toBe(3);
    expect(resolveStartDateChange(TUESDAY, null)).toEqual({ start_date: TUESDAY });
  });

  it("keeps the duration when the start date moves across a Sunday", () => {
    // start Sat Sep 12 for 2 working days -> Mon Sep 14, then move the start to Sun Sep 13
    const { target_date: firstDueDate } = resolveStartDateChange(SATURDAY, 2);
    expect(firstDueDate).toBe(NEXT_MONDAY);
    // a Sunday start rolls to Monday, so 2 working days run Mon Sep 14 -> Tue Sep 15
    expect(resolveStartDateChange(SUNDAY, 2)).toEqual({ start_date: SUNDAY, target_date: "2026-09-15" });
  });

  it("reflects a manual due date override as a new derived working days count", () => {
    // the user overrides the Wed Sep 9 due date with Sat Sep 12: Mon, Tue, Wed, Thu, Fri, Sat
    expect(getWorkingDaysBetweenDates(MONDAY, SATURDAY)).toBe(6);
    // and the override survives a later start date change, since no working days are in play anymore
    expect(resolveStartDateChange(TUESDAY, null)).toEqual({ start_date: TUESDAY });
  });
});
