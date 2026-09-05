/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane package imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { UserOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import { EmptyStateCompact } from "@plane/propel/empty-state";
import { Loader } from "@plane/ui";
import { getFileURL } from "@plane/utils";
// services
import { WorkspaceDashboardService } from "@/services/workspace-dashboard.service";
// local imports
import { WorkspaceDashboardWidgetCard } from "../widget-card";
import type { TWorkspaceDashboardWidgetProps } from "../widget-registry";

const workspaceDashboardService = new WorkspaceDashboardService();

type TOverdueRow = {
  assigneeId: string;
  displayName: string | undefined;
  avatarUrl: string | null;
  count: number;
};

export const OverdueByAssigneeWidget = observer(function OverdueByAssigneeWidget(
  props: TWorkspaceDashboardWidgetProps
) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();

  const { data, isLoading } = useSWR(`workspace-dashboard-overdue-by-assignee-${workspaceSlug}`, () =>
    workspaceDashboardService.getOverdueByAssignee(workspaceSlug)
  );

  const rows: TOverdueRow[] = useMemo(() => {
    if (!data?.distribution) return [];
    const assigneeDetails = data.extras?.assignee_details ?? [];
    return (
      Object.entries(data.distribution)
        .map(([assigneeId, entries]) => {
          const count = entries?.reduce((acc, entry) => acc + (entry?.count ?? 0), 0) ?? 0;
          const details = assigneeDetails.find((detail) => detail.assignees__id === assigneeId);
          return {
            assigneeId,
            displayName: details?.assignees__display_name,
            avatarUrl: details?.assignees__avatar_url ?? null,
            count,
          };
        })
        .filter((row) => row.count > 0)
        // oxlint-disable-next-line unicorn/no-array-sort -- freshly created array, safe to sort in place (toSorted needs es2023 lib)
        .sort((a, b) => b.count - a.count)
    );
  }, [data]);

  return (
    <WorkspaceDashboardWidgetCard
      title={t("workspace_dashboard.overdue_by_assignee")}
      actions={!isLoading && data ? <span className="text-danger text-13 font-medium">{data.total}</span> : undefined}
    >
      {isLoading ? (
        <Loader className="flex flex-col gap-3">
          <Loader.Item height="32px" width="100%" />
          <Loader.Item height="32px" width="100%" />
          <Loader.Item height="32px" width="100%" />
        </Loader>
      ) : rows.length > 0 ? (
        <div className="flex flex-col gap-1">
          {rows.map((row) => {
            const isUnassigned = row.assigneeId === "None" || row.assigneeId === "null" || !row.assigneeId;
            const name = isUnassigned ? t("common.unassigned") : (row.displayName ?? row.assigneeId);
            return (
              <div
                key={row.assigneeId}
                className="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 hover:bg-layer-transparent-hover"
              >
                <div className="flex items-center gap-2 truncate">
                  {!isUnassigned && row.avatarUrl ? (
                    <Avatar alt={name} fallback={name?.[0]?.toUpperCase()} src={getFileURL(row.avatarUrl)} size="sm" />
                  ) : (
                    <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-layer-1 capitalize">
                      {!isUnassigned && name ? (
                        name[0]
                      ) : (
                        <UserOutline className="text-secondary" width={12} height={12} />
                      )}
                    </div>
                  )}
                  <span className="truncate text-13 text-secondary">{name}</span>
                </div>
                <span className="text-danger flex-shrink-0 text-13 font-medium">{row.count}</span>
              </div>
            );
          })}
        </div>
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
