/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { AlertTriangle, CalendarOff, Layers, UserCheck, Users } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
// local imports
import { useEmployeeGantt } from "./data/context";

/**
 * The management read of the chart, in one line.
 *
 * These were six equal-weight tiles; they are now a single strip where the three that represent a
 * problem or an opportunity are **buttons that filter the chart**. A number a manager cannot act
 * on is just chrome, so "1 with overlaps" now takes you to that person.
 */
export const EmployeeGanttSummary = observer(function EmployeeGanttSummary() {
  const { t } = useTranslation();
  const { summary, filters, updateFilters } = useEmployeeGantt();

  const stats = [
    {
      key: "employees",
      icon: <Users className="size-3.5" />,
      value: summary.totalEmployees,
      label: t("employee_gantt.summary.employees"),
      tone: "text-primary",
      active: false,
      onClick: undefined,
    },
    {
      key: "overloaded",
      icon: <AlertTriangle className="size-3.5" />,
      value: summary.overloaded,
      label: t("employee_gantt.summary.overloaded"),
      tone: "text-danger-primary",
      active: false,
      onClick: undefined,
    },
    {
      key: "overlaps",
      icon: <Layers className="size-3.5" />,
      value: summary.withOverlaps,
      label: t("employee_gantt.summary.with_overlaps"),
      tone: "text-warning-primary",
      active: filters.onlyOverlaps,
      onClick: () => updateFilters({ onlyOverlaps: !filters.onlyOverlaps }),
    },
    {
      key: "available",
      icon: <UserCheck className="size-3.5" />,
      value: summary.available,
      label: t("employee_gantt.summary.available"),
      tone: "text-success-primary",
      active: false,
      onClick: undefined,
    },
    {
      key: "undated",
      icon: <CalendarOff className="size-3.5" />,
      value: summary.undatedAssignments,
      label: t("employee_gantt.summary.undated"),
      tone: "text-tertiary",
      active: false,
      onClick: undefined,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {stats.map((stat) => {
        const content = (
          <>
            <span className={cn("shrink-0", stat.tone)}>{stat.icon}</span>
            <span className={cn("text-13 font-semibold tabular-nums", stat.tone)}>{stat.value}</span>
            <span className="text-11 text-tertiary">{stat.label}</span>
          </>
        );
        const shared = "flex items-center gap-1.5 rounded-md px-2 py-1";
        return stat.onClick ? (
          <button
            key={stat.key}
            type="button"
            onClick={stat.onClick}
            aria-pressed={stat.active}
            className={cn(
              shared,
              "border transition-colors",
              stat.active
                ? "border-warning-primary bg-warning-subtle"
                : "border-transparent hover:bg-layer-transparent-hover"
            )}
          >
            {content}
          </button>
        ) : (
          <div key={stat.key} className={shared}>
            {content}
          </div>
        );
      })}
    </div>
  );
});
