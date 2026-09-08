/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
// local imports
import { useWorkspaceDashboard } from "../data/context";
import { JOB_HEALTH_ORDER } from "../data/metrics";
import {
  JOB_HEALTH_SEVERITY,
  SEVERITY_STYLES,
  WidgetEmpty,
  WidgetLoader,
  getWidgetDomId,
  scrollToWidget,
} from "../helpers";
import { WorkspaceDashboardWidgetCard } from "../widget-card";
import type { TWorkspaceDashboardWidgetProps } from "../widget-registry";

export const JobHealthWidget = observer(function JobHealthWidget(_props: TWorkspaceDashboardWidgetProps) {
  const { t } = useTranslation();
  const { isLoading, metrics } = useWorkspaceDashboard();
  const { jobHealth, jobs } = metrics;
  const total = jobs.length;

  return (
    <WorkspaceDashboardWidgetCard
      id={getWidgetDomId("job_health")}
      title={t("workspace_dashboard.job_health.title")}
      description={t("workspace_dashboard.job_health.description")}
      actions={
        !isLoading && total > 0 ? (
          <span className="text-12 text-tertiary">{t("workspace_dashboard.job_health.total", { count: total })}</span>
        ) : undefined
      }
    >
      {isLoading ? (
        <WidgetLoader rows={4} />
      ) : total === 0 ? (
        <WidgetEmpty
          title={t("workspace_dashboard.jobs.empty")}
          description={t("workspace_dashboard.jobs.empty_description")}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-layer-1" aria-hidden="true">
            {JOB_HEALTH_ORDER.map((health) => {
              const count = jobHealth[health];
              if (count === 0) return null;
              return (
                <div
                  key={health}
                  className={cn("h-full", SEVERITY_STYLES[JOB_HEALTH_SEVERITY[health]].dot)}
                  style={{ width: `${(count / total) * 100}%` }}
                />
              );
            })}
          </div>
          <ul className="grid grid-cols-2 gap-2">
            {JOB_HEALTH_ORDER.map((health) => {
              const styles = SEVERITY_STYLES[JOB_HEALTH_SEVERITY[health]];
              const count = jobHealth[health];
              return (
                <li key={health}>
                  <button
                    type="button"
                    onClick={() => scrollToWidget("active_jobs")}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-subtle px-3 py-2 text-left transition-colors hover:bg-layer-transparent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn("size-2 flex-shrink-0 rounded-full", styles.dot)} aria-hidden="true" />
                      <span className="truncate text-13 text-secondary">
                        {t(`workspace_dashboard.job_health.${health}`)}
                      </span>
                    </span>
                    <span
                      className={cn("text-16 font-semibold tabular-nums", count > 0 ? styles.text : "text-tertiary")}
                    >
                      {count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </WorkspaceDashboardWidgetCard>
  );
});
