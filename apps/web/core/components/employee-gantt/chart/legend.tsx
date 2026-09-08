/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { AlertTriangle, Check, Layers } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// local imports
import { useEmployeeGantt } from "../data/context";

/**
 * Decodes the chart's visual language.
 *
 * Colour, dashes and the amber band all carry meaning; without this strip a reader has to guess
 * what they mean, which was the main thing making the chart hard to read.
 */
export const EmployeeGanttLegend = observer(function EmployeeGanttLegend() {
  const { t } = useTranslation();
  const { schedules } = useEmployeeGantt();

  // only explain the marks that are actually on screen
  const hasOverlap = schedules.some((schedule) => schedule.overlapWindows.length > 0);
  const hasOverdue = schedules.some((schedule) => schedule.overdueCount > 0);
  const hasSingleDate = schedules.some((schedule) =>
    schedule.assignments.some((assignment) => assignment.dateKind !== "full")
  );
  const hasCompleted = schedules.some((schedule) => schedule.assignments.some((assignment) => assignment.isCompleted));
  const hasDependencyDelay = schedules.some((schedule) =>
    schedule.assignments.some((assignment) => assignment.dependencyDelay !== null)
  );

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-10 text-tertiary">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-5 rounded-sm bg-accent-primary" aria-hidden="true" />
        {t("employee_gantt.legend.project_color")}
      </span>
      {hasSingleDate && (
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm border border-dashed border-strong" aria-hidden="true" />
          {t("employee_gantt.legend.single_date")}
        </span>
      )}
      {hasOverlap && (
        <span className="flex items-center gap-1.5">
          <span className="ring-warning-primary h-2.5 w-5 rounded-sm bg-warning-primary/30 ring-1" aria-hidden="true" />
          <Layers className="size-2.5 text-warning-primary" />
          {t("employee_gantt.legend.overlap")}
        </span>
      )}
      {hasOverdue && (
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="size-2.5 text-danger-primary" />
          {t("employee_gantt.legend.overdue")}
        </span>
      )}
      {hasDependencyDelay && (
        <span className="flex items-center gap-1.5">
          <span
            className="border-danger-primary h-2.5 w-5 rounded-sm border border-dashed bg-danger-primary/10"
            aria-hidden="true"
          />
          {t("issue.dependency_delay.label")}
        </span>
      )}
      {hasCompleted && (
        <span className="flex items-center gap-1.5">
          <Check className="size-2.5" />
          {t("employee_gantt.legend.completed")}
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-px bg-accent-primary" aria-hidden="true" />
        {t("employee_gantt.legend.today")}
      </span>
      {/* bars carry no text, so say plainly where the detail is */}
      <span className="text-placeholder">{t("employee_gantt.legend.hover_hint")}</span>
    </div>
  );
});
