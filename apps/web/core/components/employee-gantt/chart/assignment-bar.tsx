/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";
import { cn, generateWorkItemLink, renderFormattedDate } from "@plane/utils";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local imports
import type { TTimelineScale } from "../data/timeline";
import { offsetForDay, widthForDays } from "../data/timeline";
import type { TEmployeeAssignment } from "../data/types";
import { getProjectColor } from "./colors";
import { BAR_HEIGHT, LANE_HEIGHT } from "./constants";

type Props = {
  assignment: TEmployeeAssignment;
  scale: TTimelineScale;
  laneIndex: number;
  workspaceSlug: string;
};

/**
 * One work item on an employee lane.
 *
 * The bar carries **no text at any zoom**. Bars are frequently only a few pixels wide, and a label
 * that has to be truncated, floated beside the bar or squeezed between neighbours costs more
 * clarity than it buys. The bar encodes position (when), length (how long) and colour (which
 * project); everything else lives in the tooltip, one hover away.
 *
 * It is also intentionally read-only: unlike the project gantt there is no drag, resize or
 * dependency handling here, so nothing on this page can write back to a work item.
 */
export const EmployeeGanttAssignmentBar = observer(function EmployeeGanttAssignmentBar(props: Props) {
  const { assignment, scale, laneIndex, workspaceSlug } = props;
  const { t } = useTranslation();
  const { getProjectById, getProjectIdentifierById } = useProject();

  const project = getProjectById(assignment.projectId);
  const projectName = project?.name ?? assignment.projectId;
  const identifier = getProjectIdentifierById(assignment.projectId);
  const color = getProjectColor(assignment.projectId, project);

  const left = offsetForDay(scale, assignment.startDay);
  // never let a bar collapse to an invisible sliver at month zoom
  const width = Math.max(widthForDays(scale, assignment.durationDays), 6);

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: assignment.projectId,
    issueId: assignment.id,
    projectIdentifier: identifier,
    sequenceId: assignment.sequenceId,
  });

  // dependency-delay projection: the planned bar stays untouched, the adjusted
  // period is drawn as a second, dashed outline in the same lane
  const delay = assignment.dependencyDelay;
  const delayedByLabel = delay
    ? `${delay.delayedByProjectIdentifier}-${delay.delayedBySequenceId} ${delay.delayedByName}`
    : "";
  const adjustedLabel = delay
    ? delay.adjustedStartDate && delay.adjustedTargetDate && delay.adjustedStartDate !== delay.adjustedTargetDate
      ? t("issue.dependency_delay.adjusted_dates", {
          startDate: renderFormattedDate(delay.adjustedStartDate),
          targetDate: renderFormattedDate(delay.adjustedTargetDate),
        })
      : t("issue.dependency_delay.adjusted_date", {
          targetDate: renderFormattedDate(delay.adjustedTargetDate ?? delay.adjustedStartDate ?? ""),
        })
    : "";

  // the bar shows nothing, so the tooltip is the whole story: what it is, whose project, when,
  // how long, and anything unusual about it
  const tooltipContent = (
    <div className="flex flex-col gap-1 text-11">
      <span className="font-medium text-primary">
        {identifier}-{assignment.sequenceId} {assignment.name}
      </span>
      <span className="text-tertiary">{projectName}</span>
      <span className="text-tertiary">
        {assignment.startDate ? renderFormattedDate(assignment.startDate) : t("employee_gantt.bar.no_start_date")}
        {" → "}
        {assignment.targetDate ? renderFormattedDate(assignment.targetDate) : t("employee_gantt.bar.no_target_date")}
        {" · "}
        {t("employee_gantt.bar.duration", { count: assignment.durationDays })}
      </span>
      {assignment.dateKind !== "full" && <span className="text-tertiary">{t("employee_gantt.bar.single_date")}</span>}
      {assignment.isCompleted && <span className="text-tertiary">{t("employee_gantt.bar.completed")}</span>}
      {assignment.isOverlapping && <span className="text-warning-primary">{t("employee_gantt.bar.overlapping")}</span>}
      {assignment.isOverdue && <span className="text-danger-primary">{t("employee_gantt.bar.overdue")}</span>}
      {delay && (
        <>
          <span className="text-danger-primary">{t("issue.dependency_delay.label")}</span>
          <span className="text-tertiary">{t("issue.dependency_delay.delayed_by", { name: delayedByLabel })}</span>
          <span className="text-tertiary">{adjustedLabel}</span>
        </>
      )}
    </div>
  );

  return (
    <>
      {/* adjusted period pushed by a delayed dependency: dashed outline, never interactive,
          drawn before the link so the planned bar always paints on top of it */}
      {delay && (
        <div
          className="border-danger-primary pointer-events-none absolute rounded-sm border border-dashed bg-danger-primary/10"
          style={{
            left: offsetForDay(scale, delay.adjustedStartDay),
            width: Math.max(widthForDays(scale, delay.adjustedEndDay - delay.adjustedStartDay + 1), 6),
            top: laneIndex * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2,
            height: BAR_HEIGHT,
          }}
          aria-hidden="true"
        />
      )}
      <Tooltip tooltipContent={tooltipContent} position="top">
        <Link
          href={workItemLink}
          className={cn(
            // the ring on hover is the only affordance the bar needs: it says "this is hoverable"
            // without adding anything that has to be read
            "group/bar hover:ring-accent-primary absolute flex items-center overflow-hidden rounded-sm outline-offset-2 transition-shadow hover:ring-2 focus-visible:outline-2",
            assignment.isCompleted && "opacity-55",
            assignment.isOverlapping && "ring-warning-primary ring-1"
          )}
          style={{
            left,
            width,
            top: laneIndex * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2,
            height: BAR_HEIGHT,
            backgroundColor: assignment.dateKind === "full" ? color : "transparent",
            // one date only is a point in time, not a span, so it reads as an outline
            border: assignment.dateKind !== "full" ? `1px dashed ${color}` : undefined,
          }}
          aria-label={`${projectName} — ${assignment.name}. ${assignment.startDate ?? ""} ${assignment.targetDate ?? ""}`}
        >
          {/* the one exception to "no marks": an overdue item should be findable without hovering */}
          {assignment.isOverdue && <AlertTriangle className="ml-0.5 size-3 shrink-0 text-white" />}
        </Link>
      </Tooltip>
    </>
  );
});
