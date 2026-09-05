/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
// plane package imports
import { useTranslation } from "@plane/i18n";
import type { IAnalyticsResponse } from "@plane/types";
// components
import InsightCard from "@/components/analytics/insight-card";
// services
import { AnalyticsService } from "@/services/analytics.service";
// local imports
import { WorkspaceDashboardWidgetCard } from "../widget-card";
import type { TWorkspaceDashboardWidgetProps } from "../widget-registry";

const analyticsService = new AnalyticsService();

const OVERVIEW_STAT_FIELDS: { key: string; entityI18nKey: string }[] = [
  { key: "total_projects", entityI18nKey: "common.projects" },
  { key: "total_members", entityI18nKey: "common.members" },
  { key: "total_work_items", entityI18nKey: "common.work_items" },
  { key: "total_cycles", entityI18nKey: "common.cycles" },
];

export const OverviewStatsWidget = observer(function OverviewStatsWidget(props: TWorkspaceDashboardWidgetProps) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();

  const { data, isLoading } = useSWR(`workspace-dashboard-overview-stats-${workspaceSlug}`, () =>
    analyticsService.getAdvanceAnalytics<IAnalyticsResponse>(workspaceSlug, "overview")
  );

  return (
    <WorkspaceDashboardWidgetCard title={t("common.overview")}>
      <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
        {OVERVIEW_STAT_FIELDS.map((field) => (
          <InsightCard
            key={field.key}
            isLoading={isLoading}
            data={data?.[field.key]}
            label={t("workspace_analytics.total", { entity: t(field.entityI18nKey) })}
          />
        ))}
      </div>
    </WorkspaceDashboardWidgetCard>
  );
});
