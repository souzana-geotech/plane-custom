/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Checkbox } from "@makeplane/propel/components/checkbox";
import {
  CalendarOutline,
  LinkOutline,
  MoreHorizontalOutline,
  NewTabOutline,
  TickOutline,
} from "@makeplane/propel/icons";
import { PriorityIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { CustomMenu } from "@plane/ui";
import {
  cn,
  copyUrlToClipboard,
  generateWorkItemLink,
  renderFormattedDateWithoutYear,
  renderFormattedPayloadDate,
} from "@plane/utils";
// components
import { DateDropdown } from "@/components/dropdowns/date";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
// local imports
import { StatusDot, StatusMenu } from "./status-chip";
import {
  getDueBucket,
  getVisualStatus,
  useItemStateGroup,
  type TDueBucket,
  type TMyWorkItem,
} from "./use-my-work-items";
import { useTaskActions } from "./use-task-actions";

/** Due dates carry urgency through color, never through a second badge. */
const DUE_TEXT_CLASSNAME: Record<TDueBucket, string> = {
  overdue: "text-danger-primary font-medium",
  today: "text-warning-primary font-medium",
  upcoming: "text-secondary",
  later: "text-geo-grey",
  none: "text-geo-grey",
};

/** Keeps clicks inside the inline controls from bubbling to the row. */
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

type TTaskRowProps = {
  item: TMyWorkItem;
  workspaceSlug: string;
};

/**
 * One compact row per task: checkbox to complete, title first, project and identifier receding
 * underneath, status and due date on the right. Status and due date are editable in place; the
 * rest of the actions appear on hover or keyboard focus.
 */
export const TaskRow = observer(function TaskRow(props: TTaskRowProps) {
  const { item, workspaceSlug } = props;
  const { t } = useTranslation();
  const { getProjectById, getProjectIdentifierById } = useProject();
  const { setPeekIssue } = useIssueDetail();
  const getStateGroup = useItemStateGroup();
  const { markDone, changeDueDate } = useTaskActions(workspaceSlug);

  const project = getProjectById(item.project_id);
  const projectIdentifier = getProjectIdentifierById(item.project_id);
  // the chip shows the real state; urgency is carried by the date colour and the queue grouping instead
  const status = getVisualStatus(getStateGroup(item), null);
  const isDone = status === "done" || status === "cancelled";
  const dueBucket = getDueBucket(item.target_date);
  const showPriority = item.priority === "urgent" || item.priority === "high";

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: item.project_id,
    issueId: item.id,
    projectIdentifier,
    sequenceId: item.sequence_id,
  });

  const openPeek = () => setPeekIssue({ workspaceSlug, projectId: item.project_id, issueId: item.id });

  // the title link keeps middle-click / open-in-new-tab working; a plain click opens the preview
  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    openPeek();
  };

  const handleCopyLink = async () => {
    await copyUrlToClipboard(workItemLink);
    setToast({ type: TOAST_TYPE.SUCCESS, title: t("link_copied"), message: t("view_link_copied_to_clipboard") });
  };

  return (
    <li
      className={cn(
        "group/row relative flex min-h-12 items-center gap-3 border-b border-subtle px-3 py-2 transition-colors last:border-b-0 focus-within:bg-layer-transparent-hover hover:bg-layer-transparent-hover",
        isDone && "opacity-70"
      )}
    >
      <Checkbox
        checked={isDone}
        aria-label={isDone ? t("home.status.done") : t("home.card.mark_done")}
        disabled={isDone}
        onClick={(e) => {
          e.stopPropagation();
          if (!isDone) void markDone(item);
        }}
      />

      {/* title + project */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-1.5">
          {showPriority && (
            <span className="flex-shrink-0" title={t(`home.priority.${item.priority}`)}>
              <PriorityIcon priority={item.priority} size={11} withContainer />
            </span>
          )}
          <Link
            href={workItemLink}
            onClick={handleOpen}
            className={cn(
              "truncate text-13 font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong",
              isDone && "line-through decoration-geo-grey"
            )}
          >
            {item.name}
          </Link>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-12 text-geo-grey">
          {project && <span className="truncate">{project.name}</span>}
          <span aria-hidden className="hidden sm:inline">
            ·
          </span>
          <span className="hidden tabular-nums sm:inline">
            {projectIdentifier}-{item.sequence_id}
          </span>
          {/* mobile: status + date fold under the title */}
          <span className="flex items-center gap-1.5 sm:hidden">
            <span aria-hidden>·</span>
            <StatusDot status={status} />
            <span>{t(`home.status.${status === "todo" ? "to_do" : status}`)}</span>
            {item.target_date && (
              <span className={DUE_TEXT_CLASSNAME[dueBucket]}>{renderFormattedDateWithoutYear(item.target_date)}</span>
            )}
          </span>
        </div>
      </div>

      {/* status + due date + more (desktop) */}
      <div
        role="presentation"
        className="hidden flex-shrink-0 items-center gap-2 sm:flex"
        onClick={stop}
        onKeyDown={stop}
      >
        <StatusMenu item={item} workspaceSlug={workspaceSlug} status={status} size="sm" />
        <div
          className={cn(
            "w-[5.5rem]",
            !item.target_date &&
              "opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100"
          )}
        >
          <DateDropdown
            value={item.target_date}
            onChange={(date) => void changeDueDate(item, (date && renderFormattedPayloadDate(date)) || null)}
            buttonVariant="transparent-with-text"
            buttonClassName={cn("h-7 w-full justify-end px-1.5 text-12", DUE_TEXT_CLASSNAME[dueBucket])}
            placeholder={t("home.card.set_due_date")}
            formatToken="MMM dd"
            hideIcon={!!item.target_date}
            isClearable={false}
            disabled={isDone}
            placement="bottom-end"
          />
        </div>
        <CustomMenu
          customButton={
            <span className="grid size-7 place-items-center rounded-md text-geo-grey transition-colors hover:bg-geo-grey-subtle hover:text-primary">
              <MoreHorizontalOutline className="size-4" />
            </span>
          }
          customButtonClassName="flex opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-within:opacity-100"
          placement="bottom-end"
          portalElement={typeof document === "undefined" ? null : document.body}
          closeOnSelect
          ariaLabel={t("home.card.more")}
        >
          {!isDone && (
            <CustomMenu.MenuItem className="flex items-center gap-2" onClick={() => void markDone(item)}>
              <TickOutline className="size-3.5 text-geo-grey" />
              {t("home.card.mark_done")}
            </CustomMenu.MenuItem>
          )}
          {!isDone && item.target_date && (
            <CustomMenu.MenuItem className="flex items-center gap-2" onClick={() => void changeDueDate(item, null)}>
              <CalendarOutline className="size-3.5 text-geo-grey" />
              {t("home.card.remove_due_date")}
            </CustomMenu.MenuItem>
          )}
          <CustomMenu.MenuItem
            className="flex items-center gap-2"
            onClick={() => window.open(workItemLink, "_blank", "noopener,noreferrer")}
          >
            <NewTabOutline className="size-3.5 text-geo-grey" />
            {t("open_in_new_tab")}
          </CustomMenu.MenuItem>
          <CustomMenu.MenuItem className="flex items-center gap-2" onClick={() => void handleCopyLink()}>
            <LinkOutline className="size-3.5 text-geo-grey" />
            {t("copy_link")}
          </CustomMenu.MenuItem>
        </CustomMenu>
      </div>
    </li>
  );
});
