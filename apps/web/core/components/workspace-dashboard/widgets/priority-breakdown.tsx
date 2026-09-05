/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
import { useTheme } from "next-themes";
import useSWR from "swr";
// plane package imports
import { CHART_COLOR_PALETTES } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { BarChart } from "@plane/propel/charts/bar-chart";
import { EmptyStateCompact } from "@plane/propel/empty-state";
import type { TAnalyticsFilterParams, TBarItem, TChart } from "@plane/types";
import { ChartXAxisProperty, ChartYAxisMetric } from "@plane/types";
// components
import { ChartLoader } from "@/components/analytics/loaders";
import { generateBarColor } from "@/components/analytics/work-items/utils";
import { parseChartData } from "@/components/chart/utils";
// services
import { AnalyticsService } from "@/services/analytics.service";
// local imports
import { WorkspaceDashboardWidgetCard } from "../widget-card";
import type { TWorkspaceDashboardWidgetProps } from "../widget-registry";

const analyticsService = new AnalyticsService();

const CHART_PARAMS = {
  x_axis: ChartXAxisProperty.PRIORITY,
  y_axis: ChartYAxisMetric.WORK_ITEM_COUNT,
};

export const PriorityBreakdownWidget = observer(function PriorityBreakdownWidget(
  props: TWorkspaceDashboardWidgetProps
) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();

  const { data: chartData, isLoading } = useSWR(`workspace-dashboard-priority-breakdown-${workspaceSlug}`, () =>
    analyticsService.getAdvanceAnalyticsCharts<TChart>(
      workspaceSlug,
      "custom-work-items",
      // x_axis/y_axis are accepted by the endpoint but not part of TAnalyticsFilterParams
      { ...CHART_PARAMS } as TAnalyticsFilterParams
    )
  );

  const parsedData = useMemo(() => parseChartData(chartData, CHART_PARAMS.x_axis, undefined, undefined), [chartData]);

  const bars: TBarItem<string>[] = useMemo(() => {
    const baseColors = CHART_COLOR_PALETTES[0]?.[resolvedTheme === "dark" ? "dark" : "light"] ?? [];
    return [
      {
        key: "count",
        label: "Count",
        stackId: "bar-one",
        fill: (payload) => generateBarColor(payload.key, CHART_PARAMS, baseColors),
        textClassName: "",
        showPercentage: false,
        showTopBorderRadius: () => true,
        showBottomBorderRadius: () => true,
      },
    ];
  }, [resolvedTheme]);

  return (
    <WorkspaceDashboardWidgetCard title={t("common.priority")}>
      {isLoading ? (
        <ChartLoader />
      ) : parsedData?.data && parsedData.data.length > 0 ? (
        <BarChart
          className="h-[350px] w-full"
          data={parsedData.data}
          bars={bars}
          margin={{
            bottom: 30,
          }}
          xAxis={{
            key: "name",
            label: t("common.priority"),
            dy: 30,
          }}
          yAxis={{
            key: "count",
            label: t("common.no_of", { entity: t("work_items") }),
            offset: -60,
            dx: -26,
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
