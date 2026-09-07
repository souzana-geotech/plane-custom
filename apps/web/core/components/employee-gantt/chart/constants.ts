/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TEmployeeCapacity } from "../data/types";

/**
 * Width of the sticky employee column, by how much room the chart actually has.
 *
 * The column is subtracted from the visible timeline, so a fixed width starves the chart on a
 * narrow viewport - at 368px of container, a 288px column leaves 80px of timeline and today can
 * end up off screen entirely.
 */
export const EMPLOYEE_COLUMN_WIDTHS = {
  compact: 180,
  medium: 232,
  full: 288,
} as const;

/** Widest column, used as the pre-measurement default and by anything needing a static value. */
export const EMPLOYEE_COLUMN_WIDTH = EMPLOYEE_COLUMN_WIDTHS.full;

/** Below this column width the cell drops its "next up" line to stay within the row height. */
export const COMPACT_COLUMN_MAX = EMPLOYEE_COLUMN_WIDTHS.compact;

export const getEmployeeColumnWidth = (containerWidth: number): number => {
  // before the first measurement, assume the roomy case rather than flashing a narrow column
  if (containerWidth <= 0) return EMPLOYEE_COLUMN_WIDTHS.full;
  if (containerWidth < 600) return EMPLOYEE_COLUMN_WIDTHS.compact;
  if (containerWidth < 860) return EMPLOYEE_COLUMN_WIDTHS.medium;
  return EMPLOYEE_COLUMN_WIDTHS.full;
};
/** Height of one packed sub-row inside an employee lane. */
export const LANE_HEIGHT = 30;
/**
 * Height of an assignment bar, leaving a little breathing room inside its lane. The bar holds no
 * text, so it only needs to be tall enough to read as a solid band and be an easy hover target.
 */
export const BAR_HEIGHT = 22;
/** Vertical padding above and below the lanes of a row. */
export const ROW_PADDING = 8;
/** Height of the two-line timeline header. */
export const HEADER_HEIGHT = 56;

/**
 * Smallest row height that still fits the three lines of the employee cell (name, badges and the
 * "next up" line). Without it a single-lane row clips its own detail column.
 */
export const MIN_ROW_HEIGHT = 88;

/** Total height of an employee row, given how many sub-rows its assignments packed into. */
export const rowHeight = (laneCount: number): number =>
  Math.max(Math.max(laneCount, 1) * LANE_HEIGHT + ROW_PADDING * 2, MIN_ROW_HEIGHT);

/** Top offset that vertically centres the packed lanes inside a row. */
export const lanesTopOffset = (laneCount: number): number =>
  (rowHeight(laneCount) - Math.max(laneCount, 1) * LANE_HEIGHT) / 2;

export const CAPACITY_STYLES: Record<TEmployeeCapacity, { pill: string; dot: string; i18nKey: string }> = {
  overloaded: {
    pill: "bg-danger-subtle text-danger-primary",
    dot: "bg-danger-primary",
    i18nKey: "employee_gantt.capacity.overloaded",
  },
  busy: {
    pill: "bg-warning-subtle text-warning-primary",
    dot: "bg-warning-primary",
    i18nKey: "employee_gantt.capacity.busy",
  },
  assigned: {
    pill: "bg-success-subtle text-success-primary",
    dot: "bg-success-primary",
    i18nKey: "employee_gantt.capacity.assigned",
  },
  available: {
    pill: "bg-layer-1 text-tertiary",
    dot: "bg-placeholder",
    i18nKey: "employee_gantt.capacity.available",
  },
};
