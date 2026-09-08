/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// hooks
import { useLabel } from "@/hooks/store/use-label";
import { useProject } from "@/hooks/store/use-project";
// local imports
import { useWorkspaceDashboard } from "../data/context";
import {
  WidgetEmpty,
  WidgetLoader,
  WidgetTable,
  WidgetTableCell,
  WidgetTableHeadCell,
  getWidgetDomId,
} from "../helpers";
import { WorkspaceDashboardWidgetCard } from "../widget-card";
import type { TWorkspaceDashboardWidgetProps } from "../widget-registry";

export const DepartmentWorkloadWidget = observer(function DepartmentWorkloadWidget(
  _props: TWorkspaceDashboardWidgetProps
) {
  const { t } = useTranslation();
  const { isLoading, metrics, filters } = useWorkspaceDashboard();
  const { getLabelById } = useLabel();
  const { getProjectIdentifierById, joinedProjectIds } = useProject();
  const rows = metrics.departments;
  // labels are project scoped; show the project identifier when several projects are visible
  const showProject = !filters.projectId && joinedProjectIds.length > 1;

  return (
    <WorkspaceDashboardWidgetCard
      id={getWidgetDomId("department_workload")}
      title={t("workspace_dashboard.departments.title")}
      description={t("workspace_dashboard.departments.description")}
    >
      {isLoading ? (
        <WidgetLoader rows={4} />
      ) : rows.length === 0 ? (
        <WidgetEmpty title={t("workspace_dashboard.departments.empty")} />
      ) : (
        <WidgetTable>
          <thead>
            <tr>
              <WidgetTableHeadCell className="w-2/5">
                {t("workspace_dashboard.departments.columns.department")}
              </WidgetTableHeadCell>
              <WidgetTableHeadCell align="right">
                {t("workspace_dashboard.departments.columns.active")}
              </WidgetTableHeadCell>
              <WidgetTableHeadCell align="right">
                {t("workspace_dashboard.departments.columns.overdue")}
              </WidgetTableHeadCell>
              <WidgetTableHeadCell align="right">
                {t("workspace_dashboard.departments.columns.completed")}
              </WidgetTableHeadCell>
              <WidgetTableHeadCell align="right">
                {t("workspace_dashboard.departments.columns.blocked")}
              </WidgetTableHeadCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const label = row.labelId ? getLabelById(row.labelId) : null;
              return (
                <tr key={row.labelId ?? "no-label"} className="hover:bg-layer-transparent-hover">
                  <WidgetTableCell>
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-2.5 flex-shrink-0 rounded-full bg-layer-1"
                        style={label?.color ? { backgroundColor: label.color } : undefined}
                        aria-hidden="true"
                      />
                      <span className="truncate text-13 text-primary">
                        {row.labelId ? (label?.name ?? row.labelId) : t("workspace_dashboard.departments.no_label")}
                      </span>
                      {showProject && label && (
                        <span className="flex-shrink-0 text-11 text-tertiary">
                          {getProjectIdentifierById(label.project_id)}
                        </span>
                      )}
                    </span>
                  </WidgetTableCell>
                  <WidgetTableCell align="right" className="font-medium text-primary">
                    {row.active}
                  </WidgetTableCell>
                  <WidgetTableCell align="right" emphasis={row.overdue > 0 ? "critical" : undefined}>
                    {row.overdue}
                  </WidgetTableCell>
                  <WidgetTableCell align="right" emphasis={row.completed > 0 ? "success" : undefined}>
                    {row.completed}
                  </WidgetTableCell>
                  <WidgetTableCell align="right" emphasis={row.blocked > 0 ? "warning" : undefined}>
                    {row.blocked}
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
