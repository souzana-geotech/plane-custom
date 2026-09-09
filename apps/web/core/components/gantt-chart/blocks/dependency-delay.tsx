/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TWorkspaceDependencySchedule } from "@plane/types";
import { findTotalDaysInRange, renderFormattedDate } from "@plane/utils";
// hooks
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { useWorkspaceDependencySchedules } from "@/hooks/use-workspace-dependency-schedules";
// constants
import { BLOCK_HEIGHT } from "../constants";

// the draggable bar body is h-8 (32px), vertically centered inside the 44px row
const OVERLAY_HEIGHT = 32;

/**
 * Additive dependency-delay layer for the main gantt.
 *
 * When a task is pushed by a delayed `blocked_by` dependency, its projected
 * (adjusted) period is drawn as a dashed outline in the same row as the planned
 * bar. The overlay is never interactive and renders nothing for blocks without a
 * projection (module bars, on-time tasks, or while the data is loading), so
 * every existing gantt behavior — drag, resize, virtualization — is untouched.
 */
export const GanttDependencyDelayOverlay = observer(function GanttDependencyDelayOverlay(props: { blockId: string }) {
  const { blockId } = props;
  // router
  const { workspaceSlug } = useParams();
  // store hooks
  const { getBlockById, getPositionFromDateOnGantt, currentViewData } = useTimeLineChartStore();
  // block ids on the issue timeline are task ids; other timelines simply miss
  const schedules = useWorkspaceDependencySchedules(workspaceSlug?.toString());
  const schedule = schedules.get(blockId);

  const block = getBlockById(blockId);
  if (!schedule || !block?.position || !currentViewData) return null;

  const adjustedStart = schedule.adjusted_start_date ?? schedule.adjusted_target_date;
  const adjustedEnd = schedule.adjusted_target_date ?? schedule.adjusted_start_date;
  if (!adjustedStart || !adjustedEnd) return null;

  const adjustedStartPosition = getPositionFromDateOnGantt(adjustedStart, 0);
  if (adjustedStartPosition === undefined) return null;

  const days = (findTotalDaysInRange(adjustedStart, adjustedEnd, false) ?? 0) + 1;

  return (
    <div
      className="border-danger-primary pointer-events-none absolute z-[4] rounded-sm border border-dashed bg-danger-primary/10"
      style={{
        // the parent wrapper already carries the planned bar's marginLeft
        left: adjustedStartPosition - block.position.marginLeft,
        width: Math.max(days * currentViewData.data.dayWidth, 6),
        top: (BLOCK_HEIGHT - OVERLAY_HEIGHT) / 2,
        height: OVERLAY_HEIGHT,
      }}
      aria-hidden="true"
    />
  );
});

/** "GEOTE-10 Site Survey" — the upstream task blamed for the delay. */
const delayedByLabel = (schedule: TWorkspaceDependencySchedule): string =>
  `${schedule.delayed_by.project_identifier}-${schedule.delayed_by.sequence_id} ${schedule.delayed_by.name}`;

/**
 * Dependency-delay lines for a task's hover card on the gantt, e.g.
 * "Dependency Delayed — Delayed by: GEOTE-10 Site Survey — Adjusted: Sep 9 – Sep 10".
 * Renders nothing when the task is not dependency delayed.
 */
export const GanttDependencyDelayDetails = observer(function GanttDependencyDelayDetails(props: { issueId: string }) {
  const { issueId } = props;
  const { t } = useTranslation();
  // router
  const { workspaceSlug } = useParams();
  const schedules = useWorkspaceDependencySchedules(workspaceSlug?.toString());
  const schedule = schedules.get(issueId);

  if (!schedule) return null;

  const { adjusted_start_date, adjusted_target_date } = schedule;
  const adjustedLabel =
    adjusted_start_date && adjusted_target_date && adjusted_start_date !== adjusted_target_date
      ? t("issue.dependency_delay.adjusted_dates", {
          startDate: renderFormattedDate(adjusted_start_date),
          targetDate: renderFormattedDate(adjusted_target_date),
        })
      : t("issue.dependency_delay.adjusted_date", {
          targetDate: renderFormattedDate(adjusted_target_date ?? adjusted_start_date ?? ""),
        });

  return (
    <div className="mt-1 flex flex-col gap-0.5 border-t border-subtle px-3 py-2 text-11">
      <span className="font-medium text-danger-primary">{t("issue.dependency_delay.label")}</span>
      <span className="text-tertiary">
        {t("issue.dependency_delay.delayed_by", { name: delayedByLabel(schedule) })}
      </span>
      <span className="text-tertiary">{adjustedLabel}</span>
    </div>
  );
});
