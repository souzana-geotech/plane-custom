/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { AlertTriangle, Ban, Briefcase, CalendarClock, CalendarX2, Clock } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// local imports
import { useWorkspaceDashboard } from "../data/context";
import type { TDashboardSeverity, TWorkspaceDashboardWidgetKey } from "../data/types";
import { SEVERITY_STYLES, scrollToWidget } from "../helpers";
import type { TWorkspaceDashboardWidgetProps } from "../widget-registry";

type TKpiDefinition = {
  key: "activeJobs" | "jobsAtRisk" | "overdueTasks" | "dueThisWeek" | "blockedTasks" | "noDueDateTasks";
  i18nKey: string;
  icon: React.ElementType;
  /** severity applied when the value is greater than zero; undefined keeps the neutral look */
  severity?: TDashboardSeverity;
  targetWidget: TWorkspaceDashboardWidgetKey;
};

const KPI_DEFINITIONS: TKpiDefinition[] = [
  {
    key: "activeJobs",
    i18nKey: "active_jobs",
    icon: Briefcase,
    targetWidget: "active_jobs",
  },
  {
    key: "jobsAtRisk",
    i18nKey: "jobs_at_risk",
    icon: AlertTriangle,
    severity: "warning",
    targetWidget: "active_jobs",
  },
  {
    key: "overdueTasks",
    i18nKey: "overdue_tasks",
    icon: Clock,
    severity: "critical",
    targetWidget: "attention_list",
  },
  {
    key: "dueThisWeek",
    i18nKey: "due_this_week",
    icon: CalendarClock,
    severity: "info",
    targetWidget: "attention_list",
  },
  {
    key: "blockedTasks",
    i18nKey: "blocked_tasks",
    icon: Ban,
    severity: "warning",
    targetWidget: "attention_list",
  },
  {
    key: "noDueDateTasks",
    i18nKey: "no_due_date",
    icon: CalendarX2,
    targetWidget: "employee_workload",
  },
];

export const KpiCardsWidget = observer(function KpiCardsWidget(_props: TWorkspaceDashboardWidgetProps) {
  const { t } = useTranslation();
  const { isLoading, metrics } = useWorkspaceDashboard();

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {KPI_DEFINITIONS.map((definition) => {
        const value = metrics.kpis[definition.key];
        const severity = definition.severity && value > 0 ? definition.severity : undefined;
        const Icon = definition.icon;
        return (
          <button
            key={definition.key}
            type="button"
            onClick={() => scrollToWidget(definition.targetWidget)}
            title={t(`workspace_dashboard.kpi.${definition.i18nKey}_hint`)}
            className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface-1 p-4 text-left transition-colors hover:bg-layer-transparent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-12 font-medium text-tertiary">
                {t(`workspace_dashboard.kpi.${definition.i18nKey}`)}
              </span>
              <span
                className={cn(
                  "flex size-6 flex-shrink-0 items-center justify-center rounded-md",
                  severity ? SEVERITY_STYLES[severity].surface : "bg-layer-1"
                )}
              >
                <Icon className={cn("size-3.5", severity ? SEVERITY_STYLES[severity].text : "text-secondary")} />
              </span>
            </span>
            {isLoading ? (
              <Loader>
                <Loader.Item height="28px" width="48px" />
              </Loader>
            ) : (
              <span
                className={cn(
                  "text-24 font-semibold tabular-nums",
                  severity ? SEVERITY_STYLES[severity].text : "text-primary"
                )}
              >
                {value}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});
