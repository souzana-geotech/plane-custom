/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import type { TIssue } from "@plane/types";
// components
import { DateDropdown } from "@/components/dropdowns/date";
import type { TButtonVariants } from "@/components/dropdowns/types";
// local
import { LockedDueDateButton } from "./locked-due-date-button";
import { RequestDueDateChangeModal } from "./request-change-modal";
import { useDueDateLock } from "./use-due-date-lock";

type Props = {
  workspaceSlug: string | undefined;
  projectId: string | undefined;
  /** `id` may be absent on a partially loaded task (e.g. the intake panel); the
   * fixed state still renders, only the request action needs an id. */
  issue: Partial<
    Pick<
      TIssue,
      "target_date" | "start_date" | "is_due_date_locked" | "due_date_locked_by" | "due_date_locked_at" | "id"
    >
  >;
  onChange: (date: Date | null) => void;
  disabled?: boolean;
  buttonVariant: TButtonVariants;
  buttonClassName?: string;
  buttonContainerClassName?: string;
  className?: string;
  optionsClassName?: string;
  clearIconClassName?: string;
  placeholder?: string;
  icon?: React.ReactNode;
  minDate?: Date;
  maxDate?: Date;
  tabIndex?: number;
  onClose?: () => void;
  showTooltip?: boolean;
  renderByDefault?: boolean;
  hideIcon?: boolean;
  isClearable?: boolean;
  formatToken?: string;
  /** hide the "Request change" action, e.g. in dense read-only rows */
  showRequestAction?: boolean;
};

/**
 * Geotech3D: drop-in replacement for `DateDropdown` on the *due date*.
 *
 * Renders the normal picker when the date is editable, and the fixed-state
 * affordance ("Due date is fixed" + "Request change") when an admin has locked
 * it and the viewer is not an admin. Admins keep the plain picker.
 *
 * Use this anywhere a member can reach a due date. The server enforces the lock
 * regardless, so a surface that keeps using `DateDropdown` is a UX gap, not a
 * security hole.
 */
export const DueDateControl = observer(function DueDateControl(props: Props) {
  const {
    workspaceSlug,
    projectId,
    issue,
    onChange,
    disabled = false,
    showRequestAction = true,
    placeholder,
    buttonVariant,
    buttonClassName,
    buttonContainerClassName,
    className,
    hideIcon,
    ...dropdownProps
  } = props;

  const { isDueDateReadOnly, pendingRequest, isRequestModalOpen, openRequestModal, closeRequestModal, mutateRequests } =
    useDueDateLock({
      workspaceSlug,
      projectId,
      issue,
      withRequests: !!issue.is_due_date_locked,
    });

  if (isDueDateReadOnly) {
    return (
      <>
        <LockedDueDateButton
          targetDate={issue.target_date ?? null}
          buttonVariant={buttonVariant}
          buttonClassName={buttonClassName}
          buttonContainerClassName={buttonContainerClassName}
          className={className}
          placeholder={placeholder}
          hideIcon={hideIcon}
          pendingRequest={pendingRequest}
          showRequestAction={showRequestAction && !disabled && !!issue.id}
          onRequestChange={openRequestModal}
        />
        {workspaceSlug && projectId && issue.id && (
          <RequestDueDateChangeModal
            isOpen={isRequestModalOpen}
            onClose={closeRequestModal}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            issue={{
              ...issue,
              id: issue.id,
              target_date: issue.target_date ?? null,
              start_date: issue.start_date ?? null,
            }}
            onSubmitted={() => mutateRequests()}
          />
        )}
      </>
    );
  }

  return (
    <DateDropdown
      value={issue.target_date ?? null}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      buttonVariant={buttonVariant}
      buttonClassName={buttonClassName}
      buttonContainerClassName={buttonContainerClassName}
      className={className}
      hideIcon={hideIcon}
      {...dropdownProps}
    />
  );
});
