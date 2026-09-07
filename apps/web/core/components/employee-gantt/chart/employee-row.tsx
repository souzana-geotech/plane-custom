/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { AlertTriangle, CalendarOff, Layers } from "lucide-react";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";
import { cn, getFileURL, renderFormattedDate } from "@plane/utils";
// local imports
import { useEmployeeGantt } from "../data/context";
import type { TTimelineScale } from "../data/timeline";
import { offsetForDay, widthForDays } from "../data/timeline";
import type { TEmployeeSchedule } from "../data/types";
import { EmployeeGanttAssignmentBar } from "./assignment-bar";
import { CAPACITY_STYLES, COMPACT_COLUMN_MAX, LANE_HEIGHT, lanesTopOffset, rowHeight } from "./constants";

type Props = {
  schedule: TEmployeeSchedule;
  scale: TTimelineScale;
  workspaceSlug: string;
  /** measured width of the sticky employee column */
  columnWidth: number;
};

/** A small count chip, shown only when the count is non-zero so the cell stays quiet by default. */
function CountChip(props: { icon: React.ReactNode; label: string; tooltip: string; className: string }) {
  const { icon, label, tooltip, className } = props;
  return (
    <Tooltip tooltipContent={tooltip} position="top">
      <span className={cn("flex items-center gap-1 rounded px-1 py-0.5 text-10 font-medium", className)}>
        {icon}
        {label}
      </span>
    </Tooltip>
  );
}

/**
 * Sticky left cell.
 *
 * Three tiers on purpose: the name reads first, the capacity line answers "how loaded are they
 * right now", and the exception chips and "next up" line are quieter supporting detail.
 */
const EmployeeCell = observer(function EmployeeCell(props: {
  schedule: TEmployeeSchedule;
  columnWidth: number;
  isOverloaded: boolean;
}) {
  const { schedule, columnWidth, isOverloaded } = props;
  const { t } = useTranslation();
  const { filters } = useEmployeeGantt();
  const capacity = CAPACITY_STYLES[schedule.capacity];

  return (
    <div
      className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-1.5 border-r border-b border-subtle bg-surface-1 px-3 py-2 group-hover/row:bg-layer-transparent-hover"
      style={{ width: columnWidth }}
    >
      {/* left accent so an overloaded person is findable while scanning a long list */}
      {isOverloaded && <span className="absolute inset-y-0 left-0 w-0.5 bg-danger-primary" aria-hidden="true" />}
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <Avatar
          alt={schedule.displayName}
          fallback={schedule.displayName[0]?.toUpperCase()}
          src={getFileURL(schedule.avatarUrl)}
          size="md"
        />
        <span className="truncate text-13 font-medium text-primary">{schedule.displayName}</span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <Tooltip tooltipContent={t("employee_gantt.capacity.tooltip", { count: schedule.activeToday })} position="top">
          <span className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 text-10 font-medium", capacity.pill)}>
            <span className={cn("size-1.5 rounded-full", capacity.dot)} aria-hidden="true" />
            {t(capacity.i18nKey, { count: schedule.activeToday })}
          </span>
        </Tooltip>
        {schedule.overlapWindows.length > 0 && (
          <CountChip
            icon={<Layers className="size-2.5" />}
            label={`${schedule.overlapWindows.length}`}
            tooltip={t("employee_gantt.row.overlap_tooltip", {
              count: schedule.overlapWindows.length,
              peak: schedule.peakConcurrency,
            })}
            className="bg-warning-subtle text-warning-primary"
          />
        )}
        {schedule.overdueCount > 0 && (
          <CountChip
            icon={<AlertTriangle className="size-2.5" />}
            label={`${schedule.overdueCount}`}
            tooltip={t("employee_gantt.row.overdue", { count: schedule.overdueCount })}
            className="bg-danger-subtle text-danger-primary"
          />
        )}
        {schedule.undatedCount > 0 && (
          <CountChip
            icon={<CalendarOff className="size-2.5" />}
            label={`${schedule.undatedCount}`}
            tooltip={t("employee_gantt.row.undated_tooltip")}
            className="bg-layer-1 text-tertiary"
          />
        )}
      </div>

      {/*
        "Next up" is about work after today, which the "today only" filter deliberately removes.
        Showing it there would report "nothing scheduled next" for someone who does have upcoming
        work, so the line is hidden rather than allowed to state something false.
      */}
      {!filters.todayOnly && columnWidth > COMPACT_COLUMN_MAX && (
        <span className="shrink-0 truncate text-10 text-tertiary">
          {schedule.nextAssignment
            ? t("employee_gantt.row.next", {
                date: renderFormattedDate(
                  schedule.nextAssignment.startDate ?? schedule.nextAssignment.targetDate ?? ""
                ),
                name: schedule.nextAssignment.name,
              })
            : t("employee_gantt.row.nothing_next")}
        </span>
      )}
    </div>
  );
});

/**
 * One employee lane: the sticky detail cell plus every assignment drawn against the shared scale.
 * Overlapping work is packed into sub-rows and additionally banded, so a manager can see a clash
 * without reading any dates.
 */
export const EmployeeGanttRow = observer(function EmployeeGanttRow(props: Props) {
  const { schedule, scale, workspaceSlug, columnWidth } = props;
  const height = rowHeight(schedule.lanes.length);
  const isOverloaded = schedule.capacity === "overloaded";

  return (
    <div className="group/row relative flex items-stretch" style={{ height }}>
      <EmployeeCell schedule={schedule} columnWidth={columnWidth} isOverloaded={isOverloaded} />
      <div className="relative z-0 shrink-0 border-b border-subtle group-hover/row:bg-layer-transparent-hover">
        <div style={{ width: scale.width, height: "100%" }}>
          {/* bands behind the bars marking every day range with more than one open assignment */}
          {schedule.overlapWindows.map((window) => (
            <div
              key={`overlap-${window.startDay}`}
              className="pointer-events-none absolute inset-y-0 bg-warning-primary/15"
              style={{
                left: offsetForDay(scale, window.startDay),
                width: widthForDays(scale, window.endDay - window.startDay + 1),
              }}
              aria-hidden="true"
            />
          ))}
          <div
            className="absolute inset-x-0"
            style={{
              top: lanesTopOffset(schedule.lanes.length),
              height: schedule.lanes.length * LANE_HEIGHT,
            }}
          >
            {schedule.lanes.map((lane, laneIndex) =>
              lane.map((assignment) => (
                <EmployeeGanttAssignmentBar
                  key={`${assignment.id}-${assignment.startDay}`}
                  assignment={assignment}
                  scale={scale}
                  laneIndex={laneIndex}
                  workspaceSlug={workspaceSlug}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
