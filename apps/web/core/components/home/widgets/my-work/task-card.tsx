/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { STATE_GROUPS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { StateGroupIcon } from "@plane/propel/icons";
import type { TStateGroups } from "@plane/types";
import { cn, generateWorkItemLink } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
// local imports
import { formatFriendlyDate } from "./format-due-date";
import type { TMyWorkItem } from "./use-my-work-items";

/** Plain-language status word for a state group — see spec table: Backlog/Unstarted → Not
 * started, Started → In progress, Completed → Done, Cancelled stays Cancelled. Local to this
 * simplified page; other (advanced) views keep the real state names via `STATE_GROUPS`. */
const SIMPLE_STATUS_I18N_KEY: Record<TStateGroups, string> = {
  backlog: "home.status.not_started",
  unstarted: "home.status.not_started",
  started: "home.status.in_progress",
  completed: "home.status.done",
  cancelled: "home.status.cancelled",
};

type TTaskCardProps = {
  item: TMyWorkItem;
  workspaceSlug: string;
  /** Overrides the due-date text, e.g. a Today-section row that just says "Due today". */
  dueLabelOverride?: string;
  showStatus?: boolean;
  /** Shows a muted "Open" hint on hover — an explicit, discoverable action affordance for the
   * My Tasks list, on top of the row already being clickable everywhere. */
  showOpenHint?: boolean;
  className?: string;
};

/**
 * The one task row/card shared by Today, Coming Up, and My Tasks: task title leads, project +
 * due date + status follow as secondary text, and the work-item identifier is small and muted
 * (spec section 7 — the title is always the primary element, never the ID).
 */
export const TaskCard = observer(function TaskCard(props: TTaskCardProps) {
  const { item, workspaceSlug, dueLabelOverride, showStatus = true, showOpenHint = false, className } = props;
  const { t } = useTranslation();
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

  // click opens the peek overview; the href keeps middle-click / open-in-new-tab working
  const handlePeekOverview = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setPeekIssue({ workspaceSlug, projectId: item.project_id, issueId: item.id });
  };

  const dueLabel =
    dueLabelOverride ??
    (item.target_date ? `${t("home.due.prefix")} ${formatFriendlyDate(item.target_date, t)}` : undefined);

  return (
    <Link
      href={workItemLink}
      onClick={handlePeekOverview}
      className={cn(
        "group flex flex-col gap-1 rounded-md px-3 py-2.5 transition-colors hover:bg-layer-transparent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-14 font-medium text-primary">{item.name}</span>
        {showOpenHint && (
          <span className="hidden flex-shrink-0 text-12 font-medium text-accent-primary opacity-0 group-hover:opacity-100 sm:block">
            {t("home.my_tasks.open")}
          </span>
        )}
        <span className="hidden flex-shrink-0 text-11 text-placeholder sm:block">
          {projectIdentifier}-{item.sequence_id}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-12 text-tertiary">
        {projectName && <span className="truncate">{projectName}</span>}
        {projectName && (dueLabel || showStatus) && <span aria-hidden>·</span>}
        {dueLabel && <span className="whitespace-nowrap">{dueLabel}</span>}
        {dueLabel && showStatus && <span aria-hidden>·</span>}
        {showStatus && (
          <span className="flex items-center gap-1 whitespace-nowrap">
            <StateGroupIcon stateGroup={stateGroup} color={STATE_GROUPS[stateGroup].color} className="size-3" />
            {t(SIMPLE_STATUS_I18N_KEY[stateGroup])}
          </span>
        )}
      </div>
    </Link>
  );
});
