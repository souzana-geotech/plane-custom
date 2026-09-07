/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TEmployeeGanttZoom } from "./types";

/**
 * Timeline scale for the employee resource gantt.
 *
 * This module is deliberately self-contained: it shares no code, store or context with the
 * existing project gantt (`components/gantt-chart`), whose chart data lives on singleton MobX
 * stores keyed by timeline type. Everything here is a pure function over whole day numbers.
 */

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

/** Turns a day number back into a UTC date, so every getter below must use UTC accessors. */
export const dayNumberToDate = (day: number): Date => new Date(day * MS_PER_DAY);

/** `YYYY-MM-DD` for a day number. */
export const dayNumberToISO = (day: number): string => dayNumberToDate(day).toISOString().slice(0, 10);

/** Zero-based weekday of a day number, 0 = Sunday. */
export const weekdayOf = (day: number): number => dayNumberToDate(day).getUTCDay();

export const isWeekendDay = (day: number): boolean => {
  const weekday = weekdayOf(day);
  return weekday === 0 || weekday === 6;
};

/** Day number of the Monday on or before `day`. */
export const startOfWeekDay = (day: number): number => {
  const weekday = weekdayOf(day);
  // shift so Monday counts as 0
  return day - ((weekday + 6) % 7);
};

/** Day number of the first of the month containing `day`. */
export const startOfMonthDay = (day: number): number => {
  const date = dayNumberToDate(day);
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / MS_PER_DAY);
};

/** Day number of the first of the month after the one containing `day`. */
export const startOfNextMonthDay = (day: number): number => {
  const date = dayNumberToDate(day);
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / MS_PER_DAY);
};

/** Day number of 1 January of the year containing `day`. */
export const startOfYearDay = (day: number): number => {
  const date = dayNumberToDate(day);
  return Math.floor(Date.UTC(date.getUTCFullYear(), 0, 1) / MS_PER_DAY);
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Per-zoom geometry.
 * `dayWidth` is the only knob: every position is `(day - startDay) * dayWidth`, so bars, header
 * ticks and the today marker can never drift apart.
 */
export const ZOOM_CONFIG: Record<
  TEmployeeGanttZoom,
  { dayWidth: number; padBeforeDays: number; padAfterDays: number; minSpanDays: number }
> = {
  day: { dayWidth: 32, padBeforeDays: 7, padAfterDays: 21, minSpanDays: 30 },
  week: { dayWidth: 15, padBeforeDays: 14, padAfterDays: 60, minSpanDays: 90 },
  month: { dayWidth: 5.5, padBeforeDays: 31, padAfterDays: 180, minSpanDays: 365 },
};

/** A header tick covering a contiguous range of days. */
export type TTimelineSegment = {
  key: string;
  label: string;
  /** secondary line, e.g. the weekday initial under a day number */
  sublabel?: string;
  startDay: number;
  /** number of days the segment spans, so its width is `days * dayWidth` */
  days: number;
  isWeekend: boolean;
  isToday: boolean;
};

export type TTimelineScale = {
  zoom: TEmployeeGanttZoom;
  dayWidth: number;
  /** inclusive first day rendered */
  startDay: number;
  /** inclusive last day rendered */
  endDay: number;
  totalDays: number;
  /** total pixel width of the chart body */
  width: number;
  /** coarse ticks: months (day and week zoom) or years (month zoom) */
  majorSegments: TTimelineSegment[];
  /** fine ticks: days, weeks or months depending on zoom */
  minorSegments: TTimelineSegment[];
  /** x offset of today, or null when today falls outside the window */
  todayOffset: number | null;
  todayDay: number;
};

/** x offset in pixels of a day number within the scale. */
export const offsetForDay = (scale: TTimelineScale, day: number): number => (day - scale.startDay) * scale.dayWidth;

/** Width in pixels of an inclusive day range. */
export const widthForDays = (scale: TTimelineScale, days: number): number => days * scale.dayWidth;

const buildMonthSegments = (startDay: number, endDay: number, today: number): TTimelineSegment[] => {
  const segments: TTimelineSegment[] = [];
  let cursor = startOfMonthDay(startDay);
  while (cursor <= endDay) {
    const next = startOfNextMonthDay(cursor);
    const from = Math.max(cursor, startDay);
    const to = Math.min(next - 1, endDay);
    const date = dayNumberToDate(cursor);
    segments.push({
      key: `month-${cursor}`,
      label: `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      startDay: from,
      days: to - from + 1,
      isWeekend: false,
      isToday: today >= from && today <= to,
    });
    cursor = next;
  }
  return segments;
};

const buildYearSegments = (startDay: number, endDay: number, today: number): TTimelineSegment[] => {
  const segments: TTimelineSegment[] = [];
  let cursor = startOfYearDay(startDay);
  while (cursor <= endDay) {
    const date = dayNumberToDate(cursor);
    const next = Math.floor(Date.UTC(date.getUTCFullYear() + 1, 0, 1) / MS_PER_DAY);
    const from = Math.max(cursor, startDay);
    const to = Math.min(next - 1, endDay);
    segments.push({
      key: `year-${cursor}`,
      label: `${date.getUTCFullYear()}`,
      startDay: from,
      days: to - from + 1,
      isWeekend: false,
      isToday: today >= from && today <= to,
    });
    cursor = next;
  }
  return segments;
};

const buildDaySegments = (startDay: number, endDay: number, today: number): TTimelineSegment[] => {
  const segments: TTimelineSegment[] = [];
  for (let day = startDay; day <= endDay; day++) {
    const date = dayNumberToDate(day);
    segments.push({
      key: `day-${day}`,
      label: `${date.getUTCDate()}`,
      sublabel: WEEKDAY_INITIALS[date.getUTCDay()],
      startDay: day,
      days: 1,
      isWeekend: isWeekendDay(day),
      isToday: day === today,
    });
  }
  return segments;
};

const buildWeekSegments = (startDay: number, endDay: number, today: number): TTimelineSegment[] => {
  const segments: TTimelineSegment[] = [];
  let cursor = startOfWeekDay(startDay);
  while (cursor <= endDay) {
    const from = Math.max(cursor, startDay);
    const to = Math.min(cursor + 6, endDay);
    const date = dayNumberToDate(cursor);
    segments.push({
      key: `week-${cursor}`,
      label: `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}`,
      startDay: from,
      days: to - from + 1,
      isWeekend: false,
      isToday: today >= from && today <= to,
    });
    cursor += 7;
  }
  return segments;
};

const buildShortMonthSegments = (startDay: number, endDay: number, today: number): TTimelineSegment[] => {
  // at month zoom the tick is narrow, so drop the year that the major row already shows
  const segments = buildMonthSegments(startDay, endDay, today);
  for (const segment of segments) {
    segment.label = MONTH_NAMES[dayNumberToDate(segment.startDay).getUTCMonth()] ?? segment.label;
  }
  return segments;
};

/**
 * Builds the scale for the given zoom around the data range.
 *
 * `dataStartDay` / `dataEndDay` are the extremes of the scheduled work; the window is padded and
 * always widened to include today, so the chart is never empty and today is always reachable.
 */
export const buildTimelineScale = (
  zoom: TEmployeeGanttZoom,
  dataStartDay: number | null,
  dataEndDay: number | null,
  today: number
): TTimelineScale => {
  const { dayWidth, padBeforeDays, padAfterDays, minSpanDays } = ZOOM_CONFIG[zoom];

  const rawStart = Math.min(dataStartDay ?? today, today);
  const rawEnd = Math.max(dataEndDay ?? today, today);

  let startDay = rawStart - padBeforeDays;
  let endDay = rawEnd + padAfterDays;

  // widen symmetrically so short data ranges still fill the viewport
  const span = endDay - startDay + 1;
  if (span < minSpanDays) {
    const missing = minSpanDays - span;
    startDay -= Math.floor(missing / 2);
    endDay += Math.ceil(missing / 2);
  }

  // snap to whole weeks (day and week zoom) or whole months (month zoom) so header ticks are complete
  if (zoom === "month") {
    startDay = startOfMonthDay(startDay);
    endDay = startOfNextMonthDay(endDay) - 1;
  } else {
    startDay = startOfWeekDay(startDay);
    endDay = startOfWeekDay(endDay) + 6;
  }

  const totalDays = endDay - startDay + 1;
  const inWindow = today >= startDay && today <= endDay;

  return {
    zoom,
    dayWidth,
    startDay,
    endDay,
    totalDays,
    width: totalDays * dayWidth,
    majorSegments:
      zoom === "month" ? buildYearSegments(startDay, endDay, today) : buildMonthSegments(startDay, endDay, today),
    minorSegments:
      zoom === "day"
        ? buildDaySegments(startDay, endDay, today)
        : zoom === "week"
          ? buildWeekSegments(startDay, endDay, today)
          : buildShortMonthSegments(startDay, endDay, today),
    todayOffset: inWindow ? (today - startDay) * dayWidth : null,
    todayDay: today,
  };
};
