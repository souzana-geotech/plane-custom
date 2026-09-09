/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
// plane imports
import { STATE_GROUPS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { StateGroupIcon } from "@plane/propel/icons";
import type { THomeWidgetProps, TStateGroups } from "@plane/types";
import { Loader } from "@plane/ui";
import { cn, generateWorkItemLink, renderFormattedDate } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";
// services
import { WorkspaceService } from "@/services/workspace.service";

const workspaceService = new WorkspaceService();

/**
 * Fields used from the pre-existing workspace work item endpoint
 * (`GET /api/workspaces/:slug/issues/`, `ViewIssueListSerializer`) — the same
 * endpoint that powers workspace views, permission filtered per project.
 */
type TMyWorkItem = {
  id: string;
  name: string;
  sequence_id: number;
  project_id: string;
  state__group: TStateGroups | null;
  target_date: string | null;
};

/** Only open work needs doing; completed and cancelled items are the backend's state groups to skip. */
const OPEN_STATE_GROUPS = "backlog,unstarted,started";
const PAGE_SIZE = 100;
/** Rows shown per group before collapsing into a "show all" hint, to keep the page scannable. */
const MAX_ROWS_PER_GROUP = 5;

/** Local YYYY-MM-DD, comparable to the API's date-only `target_date` strings. */
const todayString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
};

type TGroupKey = "overdue" | "due_today" | "upcoming";

const GROUPS: { key: TGroupKey; i18nKey: string; countClassName: string; dateClassName: string }[] = [
  {
    key: "overdue",
    i18nKey: "workspace_dashboard.employees.columns.overdue",
    countClassName: "text-danger-primary",
    dateClassName: "text-danger-primary",
  },
  {
    key: "due_today",
    i18nKey: "workspace_dashboard.attention.due_today",
    countClassName: "text-warning-primary",
    dateClassName: "text-warning-primary",
  },
  {
    key: "upcoming",
    i18nKey: "common.upcoming",
    countClassName: "text-tertiary",
    dateClassName: "text-tertiary",
  },
];

const MyWorkItemRow = observer(function MyWorkItemRow(props: {
  item: TMyWorkItem;
  workspaceSlug: string;
  dateClassName: string;
}) {
  const { item, workspaceSlug, dateClassName } = props;
  const { getProjectById, getProjectIdentifierById } = useProject();
  const { setPeekIssue } = useIssueDetail();

  const projectIdentifier = getProjectIdentifierById(item.project_id);
  const projectName = getProjectById(item.project_id)?.name ?? "";
  const stateGroup = item.state__group ?? "backlog";

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: item.project_id,
    issueId: item.id,
    projectIdentifier,
    sequenceId: item.sequence_id,
  });

  // same interaction as the Recents rows: click opens the peek overview, the href keeps
  // middle-click / open-in-new-tab working
  const handlePeekOverview = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setPeekIssue({ workspaceSlug, projectId: item.project_id, issueId: item.id });
  };

  return (
    <Link
      href={workItemLink}
      onClick={handlePeekOverview}
      className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-layer-transparent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
    >
      <StateGroupIcon
        stateGroup={stateGroup}
        color={STATE_GROUPS[stateGroup].color}
        className="size-3.5 flex-shrink-0"
      />
      <span className="flex-shrink-0 text-12 font-medium text-placeholder">
        {projectIdentifier}-{item.sequence_id}
      </span>
      <span className="min-w-0 flex-1 truncate text-13 text-primary">{item.name}</span>
      <span className="hidden max-w-40 flex-shrink-0 truncate text-12 text-tertiary sm:block">{projectName}</span>
      <span className="hidden w-16 flex-shrink-0 text-12 text-tertiary md:block">
        {STATE_GROUPS[stateGroup].defaultStateName}
      </span>
      {item.target_date && (
        <span className={cn("w-20 flex-shrink-0 text-right text-12 whitespace-nowrap tabular-nums", dateClassName)}>
          {renderFormattedDate(item.target_date)}
        </span>
      )}
    </Link>
  );
});

/**
 * "Your work" — the first thing an employee sees on Home: their own open work items,
 * grouped into Overdue / Due today / Upcoming. Read-only and additive; it reuses the
 * workspace issues endpoint, the peek overview and existing translations, and lives
 * above the user-managed widgets without touching how those are ordered or toggled.
 */
export const MyWorkWidget = observer(function MyWorkWidget(props: THomeWidgetProps) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();
  const { data: currentUser } = useUser();

  const { data: workItems, isLoading } = useSWR(
    workspaceSlug && currentUser ? `HOME_MY_WORK_${workspaceSlug}_${currentUser.id}` : null,
    workspaceSlug && currentUser
      ? async () => {
          const response = await workspaceService.getViewIssues(workspaceSlug, {
            assignees: currentUser.id,
            state_group: OPEN_STATE_GROUPS,
            order_by: "target_date",
            per_page: PAGE_SIZE,
            cursor: `${PAGE_SIZE}:0:0`,
          });
          // the workspace endpoint never groups, so `results` is always a flat list
          return (response?.results ?? []) as unknown as TMyWorkItem[];
        }
      : null,
    { revalidateIfStale: true, revalidateOnFocus: false, revalidateOnReconnect: true }
  );

  if (!currentUser) return null;

  const showAllHref = `/${workspaceSlug}/profile/${currentUser.id}/assigned`;
  const today = todayString();
  const dated = (workItems ?? []).filter((item) => item.target_date);
  const grouped: Record<TGroupKey, TMyWorkItem[]> = {
    overdue: dated.filter((item) => item.target_date! < today),
    due_today: dated.filter((item) => item.target_date === today),
    upcoming: dated.filter((item) => item.target_date! > today),
  };
  const undatedCount = (workItems ?? []).length - dated.length;
  const isEmpty = !isLoading && (workItems ?? []).length === 0;

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-14 font-semibold text-tertiary">{t("your_work")}</h2>
        <Link href={showAllHref} className="text-12 font-medium text-accent-primary hover:underline">
          {t("show_all")}
        </Link>
      </div>

      {isLoading ? (
        <Loader className="flex flex-col gap-2">
          <Loader.Item height="36px" />
          <Loader.Item height="36px" />
          <Loader.Item height="36px" />
        </Loader>
      ) : isEmpty ? (
        <p className="rounded-md border border-subtle px-4 py-6 text-center text-13 text-tertiary">
          {t("workspace_empty_state.your_work_by_priority.title")}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {GROUPS.map((group) => {
            const items = grouped[group.key];
            if (items.length === 0) return null;
            const visibleItems = items.slice(0, MAX_ROWS_PER_GROUP);
            return (
              <section key={group.key} aria-label={t(group.i18nKey)}>
                <h3 className="flex items-baseline gap-1.5 px-2 pb-1 text-11 font-medium tracking-wide text-tertiary uppercase">
                  {t(group.i18nKey)}
                  <span className={cn("tabular-nums", items.length > 0 && group.countClassName)}>{items.length}</span>
                </h3>
                <div className="flex flex-col">
                  {visibleItems.map((item) => (
                    <MyWorkItemRow
                      key={item.id}
                      item={item}
                      workspaceSlug={workspaceSlug}
                      dateClassName={group.dateClassName}
                    />
                  ))}
                </div>
                {items.length > MAX_ROWS_PER_GROUP && (
                  <Link
                    href={showAllHref}
                    className="block px-2 pt-1 text-12 text-tertiary hover:text-primary hover:underline"
                  >
                    +{items.length - MAX_ROWS_PER_GROUP} · {t("show_all")}
                  </Link>
                )}
              </section>
            );
          })}
          {undatedCount > 0 && (
            <Link href={showAllHref} className="px-2 text-12 text-tertiary hover:text-primary hover:underline">
              +{undatedCount} · {t("workspace_dashboard.kpi.no_due_date")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
});
