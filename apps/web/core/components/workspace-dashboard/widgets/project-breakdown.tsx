/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane package imports
import { ProjectsOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import { Logo } from "@plane/propel/emoji-icon-picker";
import type { WorkItemInsightColumns } from "@plane/types";
// components
import { exportCSV } from "@/components/analytics/export";
import { InsightTable } from "@/components/analytics/insight-table";
// hooks
import { useProject } from "@/hooks/store/use-project";
// services
import { AnalyticsService } from "@/services/analytics.service";
// local imports
import { WorkspaceDashboardWidgetCard } from "../widget-card";
import type { TWorkspaceDashboardWidgetProps } from "../widget-registry";

const analyticsService = new AnalyticsService();

export const ProjectBreakdownWidget = observer(function ProjectBreakdownWidget(props: TWorkspaceDashboardWidgetProps) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();
  // store hooks
  const { getProjectById } = useProject();

  const { data: projectStatsData, isLoading } = useSWR(`workspace-dashboard-project-breakdown-${workspaceSlug}`, () =>
    analyticsService.getAdvanceAnalyticsStats<WorkItemInsightColumns[]>(workspaceSlug, "work-items")
  );

  const columnsLabels: Record<string, string> = useMemo(
    () => ({
      project__name: t("common.project"),
      backlog_work_items: t("workspace_projects.state.backlog"),
      un_started_work_items: t("workspace_projects.state.unstarted"),
      started_work_items: t("workspace_projects.state.started"),
      completed_work_items: t("workspace_projects.state.completed"),
      cancelled_work_items: t("workspace_projects.state.cancelled"),
    }),
    [t]
  );

  const columns: ColumnDef<WorkItemInsightColumns>[] = useMemo(
    () => [
      {
        accessorKey: "project__name",
        header: () => <div className="text-left">{columnsLabels["project__name"]}</div>,
        cell: ({ row }) => {
          const project = getProjectById(row.original.project_id);
          return (
            <div className="flex items-center gap-2">
              {project?.logo_props ? (
                <Logo logo={project.logo_props} size={18} />
              ) : (
                <ProjectsOutline className="h-4 w-4" />
              )}
              {project?.name ?? row.original.project__name}
            </div>
          );
        },
        meta: {
          export: {
            key: columnsLabels["project__name"],
            value: (row) => row.original.project__name?.toString() ?? "",
          },
        },
      },
      {
        accessorKey: "backlog_work_items",
        header: () => <div className="text-right">{columnsLabels["backlog_work_items"]}</div>,
        cell: ({ row }) => <div className="text-right">{row.original.backlog_work_items}</div>,
        meta: {
          export: {
            key: columnsLabels["backlog_work_items"],
            value: (row) => row.original.backlog_work_items.toString(),
          },
        },
      },
      {
        accessorKey: "un_started_work_items",
        header: () => <div className="text-right">{columnsLabels["un_started_work_items"]}</div>,
        cell: ({ row }) => <div className="text-right">{row.original.un_started_work_items}</div>,
        meta: {
          export: {
            key: columnsLabels["un_started_work_items"],
            value: (row) => row.original.un_started_work_items.toString(),
          },
        },
      },
      {
        accessorKey: "started_work_items",
        header: () => <div className="text-right">{columnsLabels["started_work_items"]}</div>,
        cell: ({ row }) => <div className="text-right">{row.original.started_work_items}</div>,
        meta: {
          export: {
            key: columnsLabels["started_work_items"],
            value: (row) => row.original.started_work_items.toString(),
          },
        },
      },
      {
        accessorKey: "completed_work_items",
        header: () => <div className="text-right">{columnsLabels["completed_work_items"]}</div>,
        cell: ({ row }) => <div className="text-right">{row.original.completed_work_items}</div>,
        meta: {
          export: {
            key: columnsLabels["completed_work_items"],
            value: (row) => row.original.completed_work_items.toString(),
          },
        },
      },
      {
        accessorKey: "cancelled_work_items",
        header: () => <div className="text-right">{columnsLabels["cancelled_work_items"]}</div>,
        cell: ({ row }) => <div className="text-right">{row.original.cancelled_work_items}</div>,
        meta: {
          export: {
            key: columnsLabels["cancelled_work_items"],
            value: (row) => row.original.cancelled_work_items.toString(),
          },
        },
      },
    ],
    [columnsLabels, getProjectById]
  );

  return (
    <WorkspaceDashboardWidgetCard title={t("workspace_analytics.summary_of_projects")}>
      <InsightTable<"work-items">
        analyticsType="work-items"
        data={projectStatsData}
        isLoading={isLoading}
        columns={columns}
        columnsLabels={columnsLabels}
        headerText={t("common.projects")}
        onExport={(rows) => projectStatsData && exportCSV(rows, columns, workspaceSlug)}
      />
    </WorkspaceDashboardWidgetCard>
  );
});
