/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useUser } from "@/hooks/store/user";
// services
import { WorkspaceService } from "@/services/workspace.service";
// local imports
import { TaskCard } from "./task-card";
import type { TMyWorkItem } from "./use-my-work-items";

const workspaceService = new WorkspaceService();
const PAGE_SIZE = 100;

type TTabKey = "all" | "todo" | "in_progress" | "done";

/** Simple tabs map to real state groups without exposing them by name. */
const TABS: { key: TTabKey; i18nKey: string; stateGroup?: string }[] = [
  { key: "all", i18nKey: "home.my_tasks.tabs.all" },
  { key: "todo", i18nKey: "home.my_tasks.tabs.todo", stateGroup: "backlog,unstarted" },
  { key: "in_progress", i18nKey: "home.my_tasks.tabs.in_progress", stateGroup: "started" },
  { key: "done", i18nKey: "home.my_tasks.tabs.done", stateGroup: "completed" },
];

type TMyTasksSectionProps = {
  workspaceSlug: string;
};

/** Every task assigned to the current user, behind plain-language tabs instead of a filter bar.
 * "View all" drops into the existing filtered/kanban profile view for anything more advanced. */
export const MyTasksSection = observer(function MyTasksSection(props: TMyTasksSectionProps) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();
  const { data: currentUser } = useUser();
  const [activeTab, setActiveTab] = useState<TTabKey>("all");

  const activeTabConfig = TABS.find((tab) => tab.key === activeTab) ?? TABS[0];

  const { data: items, isLoading } = useSWR(
    workspaceSlug && currentUser ? `HOME_MY_TASKS_${workspaceSlug}_${currentUser.id}_${activeTab}` : null,
    workspaceSlug && currentUser
      ? async () => {
          const response = await workspaceService.getViewIssues(workspaceSlug, {
            assignees: currentUser.id,
            ...(activeTabConfig.stateGroup ? { state_group: activeTabConfig.stateGroup } : {}),
            order_by: "-created_at",
            per_page: PAGE_SIZE,
            cursor: `${PAGE_SIZE}:0:0`,
          });
          return (response?.results ?? []) as unknown as TMyWorkItem[];
        }
      : null,
    { revalidateIfStale: true, revalidateOnFocus: false, revalidateOnReconnect: true }
  );

  const isEmpty = !isLoading && (items ?? []).length === 0;
  const viewAllHref = currentUser ? `/${workspaceSlug}/profile/${currentUser.id}/assigned` : undefined;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-16 font-semibold text-primary">{t("home.my_tasks.title")}</h2>
        {viewAllHref && (
          <Link href={viewAllHref} className="text-12 font-medium text-accent-primary hover:underline">
            {t("home.my_tasks.view_all")}
          </Link>
        )}
      </div>

      <div className="flex items-center gap-1 border-b border-subtle">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "border-b-2 px-3 py-1.5 text-13 font-medium transition-colors",
              activeTab === tab.key
                ? "border-accent-strong text-primary"
                : "border-transparent text-tertiary hover:text-primary"
            )}
          >
            {t(tab.i18nKey)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Loader className="flex flex-col gap-2">
          <Loader.Item height="48px" />
          <Loader.Item height="48px" />
          <Loader.Item height="48px" />
        </Loader>
      ) : isEmpty ? (
        <div className="rounded-md border border-subtle px-4 py-8 text-center">
          <p className="text-14 font-medium text-primary">{t("home.my_tasks.empty.title")}</p>
          <p className="mt-1 text-13 text-tertiary">{t("home.my_tasks.empty.description")}</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {(items ?? []).map((item) => (
            <TaskCard
              key={item.id}
              item={item}
              workspaceSlug={workspaceSlug}
              showStatus={activeTab === "all"}
              showOpenHint
            />
          ))}
        </div>
      )}
    </section>
  );
});
