/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { UserOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
// local imports
import { useWorkspaceDashboard } from "../data/context";
import {
  MemberChip,
  ShareBar,
  WidgetEmpty,
  WidgetLoader,
  WidgetTable,
  WidgetTableCell,
  WidgetTableHeadCell,
  getWidgetDomId,
} from "../helpers";
import { WorkspaceDashboardWidgetCard } from "../widget-card";
import type { TWorkspaceDashboardWidgetProps } from "../widget-registry";

export const EmployeeWorkloadWidget = observer(function EmployeeWorkloadWidget(_props: TWorkspaceDashboardWidgetProps) {
  const { t } = useTranslation();
  const { workspaceSlug, isLoading, metrics } = useWorkspaceDashboard();
  const rows = metrics.employees;
  const maxActive = rows.reduce((max, row) => Math.max(max, row.active), 0);

  return (
    <WorkspaceDashboardWidgetCard
      id={getWidgetDomId("employee_workload")}
      title={t("workspace_dashboard.employees.title")}
      description={t("workspace_dashboard.employees.description")}
    >
      {isLoading ? (
        <WidgetLoader rows={4} />
      ) : rows.length === 0 ? (
        <WidgetEmpty title={t("workspace_dashboard.employees.empty")} />
      ) : (
        <WidgetTable>
          <thead>
            <tr>
              <WidgetTableHeadCell className="w-2/5">
                {t("workspace_dashboard.employees.columns.employee")}
              </WidgetTableHeadCell>
              <WidgetTableHeadCell align="right">
                {t("workspace_dashboard.employees.columns.active")}
              </WidgetTableHeadCell>
              <WidgetTableHeadCell align="right">
                {t("workspace_dashboard.employees.columns.due_soon")}
              </WidgetTableHeadCell>
              <WidgetTableHeadCell align="right">
                {t("workspace_dashboard.employees.columns.overdue")}
              </WidgetTableHeadCell>
              <WidgetTableHeadCell align="right">
                {t("workspace_dashboard.employees.columns.blocked")}
              </WidgetTableHeadCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.assigneeId ?? "unassigned"} className="hover:bg-layer-transparent-hover">
                <WidgetTableCell>
                  <div className="flex flex-col gap-1.5">
                    {row.assigneeId ? (
                      <Link href={`/${workspaceSlug}/profile/${row.assigneeId}/assigned`} className="hover:underline">
                        <MemberChip userId={row.assigneeId} />
                      </Link>
                    ) : (
                      <span className="flex items-center gap-2 text-13 text-tertiary">
                        <span className="flex size-5 items-center justify-center rounded-full bg-layer-1">
                          <UserOutline width={12} height={12} />
                        </span>
                        {t("common.unassigned")}
                      </span>
                    )}
                    <ShareBar value={row.active} max={maxActive} className="max-w-40" />
                  </div>
                </WidgetTableCell>
                <WidgetTableCell align="right" className="font-medium text-primary">
                  {row.active}
                </WidgetTableCell>
                <WidgetTableCell align="right" emphasis={row.dueSoon > 0 ? "info" : undefined}>
                  {row.dueSoon}
                </WidgetTableCell>
                <WidgetTableCell align="right" emphasis={row.overdue > 0 ? "critical" : undefined}>
                  {row.overdue}
                </WidgetTableCell>
                <WidgetTableCell align="right" emphasis={row.blocked > 0 ? "warning" : undefined}>
                  {row.blocked}
                </WidgetTableCell>
              </tr>
            ))}
          </tbody>
        </WidgetTable>
      )}
    </WorkspaceDashboardWidgetCard>
  );
});
