/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { useTranslation } from "@plane/i18n";
import { EPillSize, EPillVariant, Pill } from "@plane/propel/pill";
import { generateWorkItemLink, getFileURL, renderFormattedDate } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
// local imports
import { useWorkspaceDashboard } from "../data/context";
import type { TDashboardWorkItem } from "../data/types";
import { WidgetEmpty, WidgetLoader, getWidgetDomId } from "../helpers";
import { WorkspaceDashboardWidgetCard } from "../widget-card";
import type { TWorkspaceDashboardWidgetProps } from "../widget-registry";

const MAX_ROWS = 25;
const MAX_AVATARS = 3;

const AttentionTag = observer(function AttentionTag({ item }: { item: TDashboardWorkItem }) {
  const { t } = useTranslation();
  if (item.isOverdue)
    return (
      <Pill variant={EPillVariant.ERROR} size={EPillSize.SM}>
        {t("workspace_dashboard.attention.overdue_by", {
          count: item.daysFromDue ?? 0,
        })}
      </Pill>
    );
  if (item.isBlocked)
    return (
      <Pill variant={EPillVariant.WARNING} size={EPillSize.SM}>
        {t("workspace_dashboard.attention.blocked")}
      </Pill>
    );
  if (item.daysFromDue === 0)
    return (
      <Pill variant={EPillVariant.INFO} size={EPillSize.SM}>
        {t("workspace_dashboard.attention.due_today")}
      </Pill>
    );
  return (
    <Pill variant={EPillVariant.INFO} size={EPillSize.SM}>
      {t("workspace_dashboard.attention.due_in", {
        count: -(item.daysFromDue ?? 0),
      })}
    </Pill>
  );
});

export const AttentionListWidget = observer(function AttentionListWidget(_props: TWorkspaceDashboardWidgetProps) {
  const { t } = useTranslation();
  const { workspaceSlug, isLoading, metrics, allModules } = useWorkspaceDashboard();
  const { getProjectIdentifierById } = useProject();
  const { getUserDetails } = useMember();
  const items = metrics.attention;
  const visibleItems = items.slice(0, MAX_ROWS);
  const moduleNameById = new Map(allModules.map((module) => [module.id, module.name]));

  return (
    <WorkspaceDashboardWidgetCard
      id={getWidgetDomId("attention_list")}
      title={t("workspace_dashboard.attention.title")}
      description={t("workspace_dashboard.attention.description")}
      actions={
        !isLoading && items.length > 0 ? (
          <span className="rounded-full bg-layer-1 px-2 py-0.5 text-12 font-medium text-secondary">{items.length}</span>
        ) : undefined
      }
    >
      {isLoading ? (
        <WidgetLoader rows={5} />
      ) : items.length === 0 ? (
        <WidgetEmpty title={t("workspace_dashboard.attention.empty")} />
      ) : (
        <div className="flex flex-col">
          <ul className="flex max-h-[420px] flex-col divide-y divide-subtle overflow-y-auto">
            {visibleItems.map((item) => {
              const projectIdentifier = getProjectIdentifierById(item.project_id);
              const jobNames = item.module_ids.map((moduleId) => moduleNameById.get(moduleId)).filter(Boolean);
              const dueLabel = renderFormattedDate(item.target_date);
              return (
                <li key={item.id} className="flex items-center gap-3 py-2 hover:bg-layer-transparent-hover">
                  <Link
                    href={generateWorkItemLink({
                      workspaceSlug,
                      projectId: item.project_id,
                      issueId: item.id,
                      projectIdentifier,
                      sequenceId: item.sequence_id,
                    })}
                    className="min-w-0 flex-1"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex-shrink-0 text-11 font-medium text-tertiary">
                        {projectIdentifier}-{item.sequence_id}
                      </span>
                      <span className="truncate text-13 text-primary hover:underline">{item.name}</span>
                    </span>
                    {jobNames.length > 0 && (
                      <span className="block truncate text-11 text-tertiary">{jobNames.join(" · ")}</span>
                    )}
                  </Link>
                  <span className="hidden items-center -space-x-1 sm:flex">
                    {item.assignee_ids.slice(0, MAX_AVATARS).map((assigneeId) => {
                      const member = getUserDetails(assigneeId);
                      const name = member?.display_name ?? assigneeId;
                      return (
                        <span key={assigneeId} title={name}>
                          <Avatar
                            alt={name}
                            fallback={name[0]?.toUpperCase()}
                            src={getFileURL(member?.avatar_url ?? "")}
                            size="sm"
                          />
                        </span>
                      );
                    })}
                    {item.assignee_ids.length > MAX_AVATARS && (
                      <span className="pl-2 text-11 text-tertiary">+{item.assignee_ids.length - MAX_AVATARS}</span>
                    )}
                  </span>
                  {dueLabel && (
                    <span className="hidden w-24 text-right text-12 text-tertiary md:block">{dueLabel}</span>
                  )}
                  <span className="flex-shrink-0">
                    <AttentionTag item={item} />
                  </span>
                </li>
              );
            })}
          </ul>
          {items.length > MAX_ROWS && (
            <p className="pt-2 text-12 text-tertiary">
              {t("workspace_dashboard.attention.more", {
                count: items.length - MAX_ROWS,
              })}
            </p>
          )}
        </div>
      )}
    </WorkspaceDashboardWidgetCard>
  );
});
