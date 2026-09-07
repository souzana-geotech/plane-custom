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
import { ShareBar, WidgetEmpty, WidgetLoader, getWidgetDomId } from "../helpers";
import { WorkspaceDashboardWidgetCard } from "../widget-card";
import type { TWorkspaceDashboardWidgetProps } from "../widget-registry";

export const WorkPipelineWidget = observer(function WorkPipelineWidget(_props: TWorkspaceDashboardWidgetProps) {
  const { t } = useTranslation();
  const { isLoading, metrics } = useWorkspaceDashboard();
  const stages = metrics.pipeline;
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);
  const max = stages.reduce((maxCount, stage) => Math.max(maxCount, stage.count), 0);

  return (
    <WorkspaceDashboardWidgetCard
      id={getWidgetDomId("work_pipeline")}
      title={t("workspace_dashboard.pipeline.title")}
      description={t("workspace_dashboard.pipeline.description")}
      actions={
        !isLoading && total > 0 ? (
          <span className="text-12 text-tertiary">{t("workspace_dashboard.pipeline.total", { count: total })}</span>
        ) : undefined
      }
    >
      {isLoading ? (
        <WidgetLoader rows={5} />
      ) : total === 0 ? (
        <WidgetEmpty title={t("workspace_dashboard.pipeline.empty")} />
      ) : (
        <ol className="flex flex-col gap-2.5">
          {stages.map((stage) => {
            const isClosed = stage.group === "completed" || stage.group === "cancelled";
            return (
              <li
                key={`${stage.group}-${stage.name}`}
                className={cn("flex items-center gap-3", isClosed && "opacity-60")}
              >
                <span className="flex w-2/5 min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: stage.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate text-13 text-secondary">{stage.name}</span>
                </span>
                <ShareBar value={stage.count} max={max} color={stage.color} className="flex-1" />
                <span className="w-10 text-right text-13 font-medium text-primary tabular-nums">{stage.count}</span>
              </li>
            );
          })}
        </ol>
      )}
    </WorkspaceDashboardWidgetCard>
  );
});
