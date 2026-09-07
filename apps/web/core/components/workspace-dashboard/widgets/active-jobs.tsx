/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { MODULE_STATUS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { cn, renderFormattedDate } from "@plane/utils";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local imports
import { useWorkspaceDashboard } from "../data/context";
import {
  JobHealthPill,
  MemberChip,
  WidgetEmpty,
  WidgetLoader,
  WidgetTable,
  WidgetTableCell,
  WidgetTableHeadCell,
  getWidgetDomId,
} from "../helpers";
import { WorkspaceDashboardWidgetCard } from "../widget-card";
import type { TWorkspaceDashboardWidgetProps } from "../widget-registry";

export const ActiveJobsWidget = observer(function ActiveJobsWidget(_props: TWorkspaceDashboardWidgetProps) {
  const { t } = useTranslation();
  const { workspaceSlug, isLoading, metrics } = useWorkspaceDashboard();
  const { getProjectIdentifierById } = useProject();
  const jobs = metrics.jobs;

  return (
    <WorkspaceDashboardWidgetCard
      id={getWidgetDomId("active_jobs")}
      title={t("workspace_dashboard.jobs.title")}
      description={t("workspace_dashboard.jobs.description")}
      actions={
        !isLoading && jobs.length > 0 ? (
          <span className="text-12 text-tertiary">
            {t("workspace_dashboard.job_health.total", { count: jobs.length })}
          </span>
        ) : undefined
      }
    >
      {isLoading ? (
        <WidgetLoader rows={4} />
      ) : jobs.length === 0 ? (
        <WidgetEmpty
          title={t("workspace_dashboard.jobs.empty")}
          description={t("workspace_dashboard.jobs.empty_description")}
        />
      ) : (
        <WidgetTable>
          <thead>
            <tr>
              <WidgetTableHeadCell className="w-[32%]">{t("workspace_dashboard.jobs.columns.job")}</WidgetTableHeadCell>
              <WidgetTableHeadCell>{t("workspace_dashboard.jobs.columns.lead")}</WidgetTableHeadCell>
              <WidgetTableHeadCell className="w-[18%]">
                {t("workspace_dashboard.jobs.columns.progress")}
              </WidgetTableHeadCell>
              <WidgetTableHeadCell>{t("workspace_dashboard.jobs.columns.status")}</WidgetTableHeadCell>
              <WidgetTableHeadCell>{t("workspace_dashboard.jobs.columns.due")}</WidgetTableHeadCell>
              <WidgetTableHeadCell>{t("workspace_dashboard.jobs.columns.health")}</WidgetTableHeadCell>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const { module } = job;
              const status = MODULE_STATUS.find((item) => item.value === (module.status ?? "planned"));
              const dueLabel = renderFormattedDate(module.target_date);
              return (
                <tr key={module.id} className="hover:bg-layer-transparent-hover">
                  <WidgetTableCell>
                    <Link
                      href={`/${workspaceSlug}/projects/${module.project_id}/modules/${module.id}`}
                      className="block min-w-0"
                    >
                      <span className="block truncate text-13 font-medium text-primary hover:underline">
                        {module.name}
                      </span>
                      <span className="block text-11 text-tertiary">
                        {getProjectIdentifierById(module.project_id)} ·{" "}
                        {t("workspace_dashboard.jobs.open_items", {
                          count: job.openItems,
                        })}
                        {job.overdueItems > 0 && (
                          <span className="text-danger-primary">
                            {" "}
                            ·{" "}
                            {t("workspace_dashboard.jobs.overdue_items", {
                              count: job.overdueItems,
                            })}
                          </span>
                        )}
                        {job.blockedItems > 0 && (
                          <span className="text-warning-primary">
                            {" "}
                            ·{" "}
                            {t("workspace_dashboard.jobs.blocked_items", {
                              count: job.blockedItems,
                            })}
                          </span>
                        )}
                      </span>
                    </Link>
                  </WidgetTableCell>
                  <WidgetTableCell>
                    {module.lead_id ? (
                      <MemberChip userId={module.lead_id} />
                    ) : (
                      <span className="text-13 text-tertiary">{t("workspace_dashboard.jobs.no_lead")}</span>
                    )}
                  </WidgetTableCell>
                  <WidgetTableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-layer-1" aria-hidden="true">
                        <div className="h-full rounded-full bg-accent-primary" style={{ width: `${job.progress}%` }} />
                      </div>
                      <span className="w-9 text-right text-13 text-primary tabular-nums">{job.progress}%</span>
                    </div>
                  </WidgetTableCell>
                  <WidgetTableCell>
                    <span className="flex items-center gap-1.5">
                      <span
                        className="size-2 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: status?.color }}
                        aria-hidden="true"
                      />
                      <span className="text-13 text-secondary">{status ? t(status.i18n_label) : module.status}</span>
                    </span>
                  </WidgetTableCell>
                  <WidgetTableCell>
                    {dueLabel ? (
                      <span className="flex flex-col">
                        <span className="text-13 text-secondary">{dueLabel}</span>
                        {job.daysFromDue !== undefined && job.daysFromDue !== 0 && (
                          <span
                            className={cn("text-11", job.daysFromDue > 0 ? "text-danger-primary" : "text-tertiary")}
                          >
                            {job.daysFromDue > 0
                              ? t("workspace_dashboard.jobs.days_late", {
                                  count: job.daysFromDue,
                                })
                              : t("workspace_dashboard.jobs.days_left", {
                                  count: -job.daysFromDue,
                                })}
                          </span>
                        )}
                        {job.daysFromDue === 0 && (
                          <span className="text-11 text-warning-primary">
                            {t("workspace_dashboard.attention.due_today")}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-13 text-tertiary">{t("workspace_dashboard.jobs.no_due")}</span>
                    )}
                  </WidgetTableCell>
                  <WidgetTableCell>
                    <JobHealthPill health={job.health} />
                  </WidgetTableCell>
                </tr>
              );
            })}
          </tbody>
        </WidgetTable>
      )}
    </WorkspaceDashboardWidgetCard>
  );
});
