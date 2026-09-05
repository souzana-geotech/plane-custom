/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
// plane package imports
import { ANALYTICS_INSIGHTS_FIELDS } from "@plane/constants";
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

export const WorkItemStatsWidget = observer(function WorkItemStatsWidget(props: TWorkspaceDashboardWidgetProps) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();

  const { data, isLoading } = useSWR(`workspace-dashboard-work-item-stats-${workspaceSlug}`, () =>
    analyticsService.getAdvanceAnalytics<IAnalyticsResponse>(workspaceSlug, "work-items")
  );

  return (
    <WorkspaceDashboardWidgetCard title={t("common.work_items")}>
      <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
        {ANALYTICS_INSIGHTS_FIELDS["work-items"].map((field) => (
          <InsightCard
            key={field.key}
            isLoading={isLoading}
            data={data?.[field.key]}
            label={t(field.i18nKey, { entity: t("common.work_items") })}
          />
        ))}
      </div>
    </WorkspaceDashboardWidgetCard>
  );
});
