/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
// local imports
import { useEmployeeGantt } from "../data/context";
import type { TTimelineScale } from "../data/timeline";
import { getEmployeeColumnWidth, HEADER_HEIGHT } from "./constants";
import { EmployeeGanttRow } from "./employee-row";
import { EmployeeGanttTimelineHeader } from "./timeline-header";

/** Vertical rules and weekend shading, drawn once behind every row. */
const ChartGrid = observer(function ChartGrid(props: { scale: TTimelineScale; columnWidth: number }) {
  const { scale, columnWidth } = props;
  return (
    <div className="pointer-events-none absolute inset-y-0 flex" style={{ left: columnWidth }}>
      {scale.minorSegments.map((segment) => (
        <div
          key={`grid-${segment.key}`}
          className={cn("h-full shrink-0 border-r border-subtle", segment.isWeekend && "bg-layer-1")}
          style={{ width: segment.days * scale.dayWidth }}
        />
      ))}
    </div>
  );
});

/**
 * The scrolling chart surface.
 *
 * One shared scroll container holds the header and every row, so the sticky employee column and
 * the sticky header stay aligned with the bars without any scroll syncing code.
 */
export const EmployeeGanttChart = observer(function EmployeeGanttChart() {
  const { t } = useTranslation();
  const { schedules, scale, workspaceSlug, registerScrollToToday, filters } = useEmployeeGantt();
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * Re-centre on today only when the view itself changes shape - the zoom level, or switching the
   * "today only" filter. Ordinary filtering leaves the viewport where the reader left it.
   */
  const viewKey = `${scale.zoom}|${filters.todayOnly}`;
  const scrolledForView = useRef<string | null>(null);

  /**
   * The employee column is sized from the chart's own width rather than a media query, because what
   * matters is how much room is left for the timeline, not how wide the browser is - the sidebar
   * and the page padding both eat into it. Measured in a layout effect so the first paint is
   * already correct instead of flashing a wide column.
   */
  const [containerWidth, setContainerWidth] = useState(0);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setContainerWidth(container.clientWidth);
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);
  const columnWidth = getEmployeeColumnWidth(containerWidth);

  /**
   * Scroll position that puts today a little inside the timeline area.
   *
   * The inset has to be measured against the *timeline* width, not the container width: the first
   * `EMPLOYEE_COLUMN_WIDTH` pixels are covered by the sticky employee column, so a fixed inset
   * parks today underneath (or past) that column on a narrow viewport, and "go to today" appears to
   * do nothing because today still is not on screen.
   */
  const todayScrollLeft = useCallback(() => {
    if (scale.todayOffset === null) return 0;
    const container = containerRef.current;
    const timelineWidth = Math.max((container?.clientWidth ?? 0) - columnWidth, 0);
    const inset = Math.min(140, timelineWidth * 0.25);
    return Math.max(scale.todayOffset - inset, 0);
  }, [scale.todayOffset, columnWidth]);

  const scrollToToday = useCallback(() => {
    const container = containerRef.current;
    if (!container || scale.todayOffset === null) return;
    container.scrollTo({ left: todayScrollLeft(), behavior: "smooth" });
  }, [scale.todayOffset, todayScrollLeft]);

  // expose the handler so the toolbar's Today button can drive this container
  useEffect(() => {
    registerScrollToToday(scrollToToday);
    return () => registerScrollToToday(null);
  }, [registerScrollToToday, scrollToToday]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || scale.todayOffset === null) return;
    if (scrolledForView.current === viewKey) return;
    scrolledForView.current = viewKey;
    container.scrollLeft = todayScrollLeft();
  }, [scale.todayOffset, viewKey, todayScrollLeft]);

  return (
    <div ref={containerRef} className="max-h-full w-full overflow-auto">
      <div className="relative" style={{ width: columnWidth + scale.width }}>
        <ChartGrid scale={scale} columnWidth={columnWidth} />

        {/* today marker, spanning the header and every row */}
        {scale.todayOffset !== null && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-accent-primary"
            style={{ left: columnWidth + scale.todayOffset }}
            aria-hidden="true"
          />
        )}

        {/*
          Stacking order, top to bottom: sticky header (30) > employee column (20) > today marker
          (10) > the timeline area, which is its own stacking context at z-0 so no bar, hover ring
          or overlap band can ever paint over the sticky column while scrolled horizontally.
        */}
        <div className="sticky top-0 z-30 flex items-stretch bg-surface-1">
          <div
            className="sticky left-0 z-10 flex shrink-0 items-end border-r border-b border-subtle bg-surface-1 px-3 pb-2"
            style={{ width: columnWidth, height: HEADER_HEIGHT }}
          >
            <span className="text-11 font-semibold tracking-wide text-tertiary uppercase">
              {t("employee_gantt.chart.employee_column")}
            </span>
          </div>
          <EmployeeGanttTimelineHeader scale={scale} columnWidth={columnWidth} />
        </div>

        <div className="relative">
          {schedules.map((schedule) => (
            <EmployeeGanttRow
              key={schedule.userId}
              schedule={schedule}
              scale={scale}
              workspaceSlug={workspaceSlug}
              columnWidth={columnWidth}
            />
          ))}
        </div>
      </div>
    </div>
  );
});
