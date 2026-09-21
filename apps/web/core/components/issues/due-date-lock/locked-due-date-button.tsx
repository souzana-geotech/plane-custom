/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { LockOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import type { TIssueDueDateChangeRequest } from "@plane/types";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { cn, renderFormattedDate } from "@plane/utils";
// types
import type { TButtonVariants } from "@/components/dropdowns/types";

type Props = {
  targetDate: string | null;
  buttonVariant: TButtonVariants;
  buttonClassName?: string;
  buttonContainerClassName?: string;
  className?: string;
  placeholder?: string;
  /** when omitted the control is display-only (no "Request change" affordance) */
  onRequestChange?: () => void;
  pendingRequest?: TIssueDueDateChangeRequest;
  hideIcon?: boolean;
  showRequestAction?: boolean;
};

/**
 * Geotech3D: what a member sees where the due date picker would normally be.
 *
 * Shows the fixed date rather than hiding it — the date is information the
 * member needs — with a lock glyph and, where allowed, a "Request change"
 * action. A pending request is surfaced in place of the action so a member
 * cannot pile up duplicates.
 */
export const LockedDueDateButton = observer(function LockedDueDateButton(props: Props) {
  const {
    targetDate,
    buttonVariant,
    buttonClassName = "",
    buttonContainerClassName = "",
    className = "",
    placeholder,
    onRequestChange,
    pendingRequest,
    hideIcon = false,
    showRequestAction = true,
  } = props;
  const { t } = useTranslation();

  const isBordered = buttonVariant.startsWith("border");
  const isBackground = buttonVariant.startsWith("background");

  const tooltipLines = [
    t("issue.due_date_lock.fixed"),
    pendingRequest
      ? t("issue.due_date_lock.request.pending_detail", {
          name: pendingRequest.requested_by_detail?.display_name ?? "",
          date: renderFormattedDate(pendingRequest.requested_target_date),
        })
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={cn("flex items-center gap-1.5", buttonContainerClassName, className)}>
      <Tooltip label={tooltipLines}>
        <div
          className={cn(
            "flex max-w-full cursor-not-allowed items-center gap-1.5 overflow-hidden rounded px-2 py-0.5 text-body-xs-regular text-secondary",
            {
              "border-[0.5px] border-subtle": isBordered,
              "bg-surface-2": isBackground,
            },
            buttonClassName
          )}
        >
          {!hideIcon && <LockOutline className="h-3 w-3 flex-shrink-0 text-tertiary" />}
          <span className="truncate">
            {targetDate ? renderFormattedDate(targetDate) : (placeholder ?? t("issue.due_date_lock.fixed_short"))}
          </span>
        </div>
      </Tooltip>

      {showRequestAction &&
        (pendingRequest ? (
          <Tooltip label={t("issue.due_date_lock.request.pending_awaiting")}>
            <span className="flex-shrink-0 rounded bg-warning-subtle px-1.5 py-0.5 text-body-xs-medium whitespace-nowrap text-warning-primary">
              {t("issue.due_date_lock.request.pending_label")}
            </span>
          </Tooltip>
        ) : (
          onRequestChange && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRequestChange();
              }}
              className="flex-shrink-0 rounded px-1.5 py-0.5 text-body-xs-medium whitespace-nowrap text-accent-primary hover:bg-accent-primary/10"
            >
              {t("issue.due_date_lock.request_change")}
            </button>
          )
        ))}
    </div>
  );
});
