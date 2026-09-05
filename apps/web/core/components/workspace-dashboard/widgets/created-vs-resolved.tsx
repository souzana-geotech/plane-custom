/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane package imports
import { useTranslation } from "@plane/i18n";
import { AreaChart } from "@plane/propel/charts/area-chart";
import { EmptyStateCompact } from "@plane/propel/empty-state";
import type { IChartResponse, TChartData } from "@plane/types";
import { renderFormattedDate } from "@plane/utils";
// components
import { ChartLoader } from "@/components/analytics/loaders";
// services
import { AnalyticsService } from "@/services/analytics.service";
// local imports
import { WorkspaceDashboardWidgetCard } from "../widget-card";
import type { TWorkspaceDashboardWidgetProps } from "../widget-registry";

const analyticsService = new AnalyticsService();

export const CreatedVsResolvedWidget = observer(function CreatedVsResolvedWidget(
  props: TWorkspaceDashboardWidgetProps
) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();

  const { data: chartData, isLoading } = useSWR(`workspace-dashboard-created-vs-resolved-${workspaceSlug}`, () =>
    analyticsService.getAdvanceAnalyticsCharts<IChartResponse>(workspaceSlug, "work-items")
  );

  const parsedData: TChartData<string, string>[] = useMemo(() => {
    if (!chartData?.data) return [];
    return chartData.data.map((datum) => ({
      ...datum,
      [datum.key]: datum.count,
      name: renderFormattedDate(datum.key) ?? datum.key,
    }));
  }, [chartData]);

  const areas = useMemo(
    () => [
      {
        key: "completed_issues",
        label: "Resolved",
        fill: "#19803833",
        fillOpacity: 1,
        stackId: "bar-one",
        showDot: false,
        smoothCurves: true,
        strokeColor: "#198038",
        strokeOpacity: 1,
      },
      {
        key: "created_issues",
        label: "Created",
        fill: "#1192E833",
        fillOpacity: 1,
        stackId: "bar-one",
        showDot: false,
        smoothCurves: true,
        strokeColor: "#1192E8",
        strokeOpacity: 1,
      },
    ],
    []
  );

  return (
    <WorkspaceDashboardWidgetCard title={t("workspace_analytics.created_vs_resolved")}>
      {isLoading ? (
        <ChartLoader />
      ) : parsedData && parsedData.length > 0 ? (
        <AreaChart
          className="h-[350px] w-full"
          data={parsedData}
          areas={areas}
          xAxis={{
            key: "name",
            label: t("date"),
          }}
          yAxis={{
            key: "count",
            label: t("common.no_of", { entity: t("work_items") }),
            offset: -60,
            dx: -24,
          }}
          legend={{
            align: "left",
            verticalAlign: "bottom",
            layout: "horizontal",
            wrapperStyles: {
              justifyContent: "start",
              alignContent: "start",
              paddingLeft: "40px",
              paddingTop: "10px",
            },
          }}
        />
      ) : (
        <EmptyStateCompact
          assetKey="unknown"
          assetClassName="size-20"
          rootClassName="border border-subtle px-5 py-10 md:py-20 md:px-20"
          title={t("workspace_empty_state.analytics_work_items.title")}
        />
      )}
    </WorkspaceDashboardWidgetCard>
  );
});
