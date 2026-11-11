/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import type { IModule, TIssuePriorities } from "@plane/types";
// components
import type { TDropdownProps } from "@/components/dropdowns/types";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
import { IssuePropertyLabels } from "@/components/issues/issue-layouts/properties/labels";

type Props = {
  isDisabled: boolean;
  moduleDetails: IModule;
  handleModuleDetailsChange: (payload: Partial<IModule>) => Promise<void>;
  buttonVariant?: TDropdownProps["buttonVariant"];
  className?: string;
};

/**
 * Geotech3D: a Job's status is one of its container's task states, the same list the
 * container's States settings page manages, so it uses the task state picker.
 */
export const ModuleStateDropdown = observer(function ModuleStateDropdown(props: Props) {
  const { isDisabled, moduleDetails, handleModuleDetailsChange, buttonVariant = "border-with-text", className } = props;

  return (
    <StateDropdown
      projectId={moduleDetails.project_id}
      value={moduleDetails.state_id}
      onChange={(stateId) => {
        if (stateId !== moduleDetails.state_id) void handleModuleDetailsChange({ state_id: stateId });
      }}
      buttonVariant={buttonVariant}
      className={className}
      disabled={isDisabled}
      showDefaultState={false}
      showTooltip
    />
  );
});

/** A Job's priority, same values and picker as a task's. */
export const ModulePriorityDropdown = observer(function ModulePriorityDropdown(props: Props) {
  const {
    isDisabled,
    moduleDetails,
    handleModuleDetailsChange,
    buttonVariant = "border-without-text",
    className,
  } = props;

  return (
    <PriorityDropdown
      value={moduleDetails.priority ?? "none"}
      onChange={(priority: TIssuePriorities) => {
        if (priority !== moduleDetails.priority) void handleModuleDetailsChange({ priority });
      }}
      buttonVariant={buttonVariant}
      className={className}
      disabled={isDisabled}
      showTooltip
    />
  );
});

/** A Job's labels, picked from its container's label list (the same labels its tasks use). */
export const ModuleLabelsDropdown = observer(function ModuleLabelsDropdown(
  props: Pick<Props, "isDisabled" | "moduleDetails" | "handleModuleDetailsChange"> & { maxRender?: number }
) {
  const { isDisabled, moduleDetails, handleModuleDetailsChange, maxRender = 2 } = props;

  return (
    <div className="flex h-5 items-center gap-1">
      <IssuePropertyLabels
        projectId={moduleDetails.project_id}
        value={moduleDetails.label_ids ?? []}
        onChange={(labelIds) => void handleModuleDetailsChange({ label_ids: labelIds })}
        disabled={isDisabled}
        maxRender={maxRender}
        hideDropdownArrow
      />
    </div>
  );
});
