/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { ChevronDownOutline } from "@makeplane/propel/icons";
import { StateGroupIcon } from "@plane/propel/icons";
import { CustomMenu } from "@plane/ui";
import { cn } from "@plane/utils";
// local imports
import { useTaskActions } from "./use-task-actions";
import type { TMyWorkItem, TVisualStatus } from "./use-my-work-items";

/**
 * The visual status system for My Work: every status has its own shape, icon and semantic color
 * so the state is readable without reading the word (○ To do, ◐ In progress, ✓ Done, ! Overdue).
 */
export const VISUAL_STATUS: Record<
  TVisualStatus,
  { i18nKey: string; chipClassName: string; dotClassName: string; icon: React.ReactNode }
> = {
  todo: {
    i18nKey: "home.status.to_do",
    chipClassName: "border-geo-grey-light bg-geo-grey-subtle text-geo-grey",
    dotClassName: "border-2 border-geo-grey bg-transparent",
    icon: (
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
  in_progress: {
    i18nKey: "home.status.in_progress",
    chipClassName: "border-accent-subtle-1 bg-accent-subtle text-accent-primary",
    dotClassName: "bg-accent-primary",
    icon: (
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
      </svg>
    ),
  },
  done: {
    i18nKey: "home.status.done",
    chipClassName: "border-success-subtle bg-success-subtle text-success-primary",
    dotClassName: "bg-success-primary",
    icon: (
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
        <circle cx="8" cy="8" r="6.5" fill="currentColor" />
        <path
          d="M5 8.2l2 2 4-4.4"
          fill="none"
          stroke="var(--bg-layer-1, #fff)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  overdue: {
    i18nKey: "home.status.overdue",
    chipClassName: "border-danger-subtle bg-danger-subtle text-danger-primary",
    dotClassName: "bg-danger-primary",
    icon: (
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
        <circle cx="8" cy="8" r="6.5" fill="currentColor" />
        <path d="M8 4.5v4.2" stroke="var(--bg-layer-1, #fff)" strokeWidth="1.9" strokeLinecap="round" />
        <circle cx="8" cy="11.3" r="1" fill="var(--bg-layer-1, #fff)" />
      </svg>
    ),
  },
  cancelled: {
    i18nKey: "home.status.cancelled",
    chipClassName: "border-subtle bg-layer-2 text-placeholder line-through light:border-strong light:bg-layer-1",
    dotClassName: "bg-layer-3",
    icon: (
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
};

type TStatusChipProps = {
  status: TVisualStatus;
  size?: "sm" | "md";
  /** Shows a chevron so the chip reads as a control, not a label. */
  interactive?: boolean;
  className?: string;
};

export function StatusChip(props: TStatusChipProps) {
  const { status, size = "md", interactive = false, className } = props;
  const { t } = useTranslation();
  const config = VISUAL_STATUS[status];

  return (
    <span
      className={cn(
        "inline-flex flex-shrink-0 items-center gap-1 rounded-full border font-medium whitespace-nowrap transition-colors",
        size === "sm" ? "h-5 px-1.5 text-11" : "h-6 px-2 text-12",
        config.chipClassName,
        className
      )}
    >
      {config.icon}
      <span>{t(config.i18nKey)}</span>
      {interactive && <ChevronDownOutline className="size-3 opacity-60" />}
    </span>
  );
}

/** A small colored dot for dense places (timeline rows) where a full chip is too loud. */
export function StatusDot({ status, className }: { status: TVisualStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 flex-shrink-0 rounded-full", VISUAL_STATUS[status].dotClassName, className)}
    />
  );
}

type TStatusMenuProps = {
  item: TMyWorkItem;
  workspaceSlug: string;
  status: TVisualStatus;
  size?: "sm" | "md";
  className?: string;
};

/**
 * The status chip as a control: opens the project's real states so the user can move a task
 * (Not started → In progress → Done) straight from the card, without opening the task.
 */
export const StatusMenu = observer(function StatusMenu(props: TStatusMenuProps) {
  const { item, workspaceSlug, status, size = "md", className } = props;
  const { t } = useTranslation();
  const { changeState, getStateOptions } = useTaskActions(workspaceSlug);
  const states = getStateOptions(item.project_id);

  if (states.length === 0) return <StatusChip status={status} size={size} className={className} />;

  return (
    <CustomMenu
      customButton={
        <StatusChip
          status={status}
          size={size}
          interactive
          className={cn("cursor-pointer hover:brightness-95", className)}
        />
      }
      customButtonClassName="flex-shrink-0"
      placement="bottom-start"
      optionsClassName="min-w-[180px]"
      portalElement={typeof document === "undefined" ? null : document.body}
      menuButtonOnClick={(e: React.MouseEvent) => e.stopPropagation()}
      closeOnSelect
    >
      <div className="px-1 pt-0.5 pb-1 text-11 font-medium tracking-wide text-geo-grey uppercase">
        {t("home.card.change_status")}
      </div>
      {states.map((state) => (
        <CustomMenu.MenuItem
          key={state.id}
          className={cn("flex items-center gap-2", state.id === item.state_id && "bg-layer-transparent-selected")}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            if (state.id !== item.state_id) void changeState(item, state.id);
          }}
        >
          <StateGroupIcon stateGroup={state.group} color={state.color} className="size-3.5" />
          <span className="truncate text-13">{state.name}</span>
        </CustomMenu.MenuItem>
      ))}
    </CustomMenu>
  );
});
