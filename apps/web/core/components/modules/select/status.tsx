/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Control } from "react-hook-form";
import { Controller } from "react-hook-form";
import type { IModule } from "@plane/types";
// components
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
import { IssuePropertyLabels } from "@/components/issues/issue-layouts/properties/labels";

type Props = {
  control: Control<IModule, any>;
  projectId: string | undefined;
  tabIndex?: number;
};

/**
 * Geotech3D: a Job's state is one of its container's task states. Left empty, the
 * picker shows the container's default state and the server starts the Job there.
 */
export function ModuleStateSelect({ control, projectId, tabIndex }: Props) {
  return (
    <Controller
      control={control}
      name="state_id"
      render={({ field: { value, onChange } }) => (
        <StateDropdown
          projectId={projectId}
          value={value}
          onChange={onChange}
          buttonVariant="border-with-text"
          tabIndex={tabIndex}
        />
      )}
    />
  );
}

export function ModulePrioritySelect({ control, tabIndex }: Omit<Props, "projectId">) {
  return (
    <Controller
      control={control}
      name="priority"
      render={({ field: { value, onChange } }) => (
        <PriorityDropdown
          value={value ?? "none"}
          onChange={onChange}
          buttonVariant="border-with-text"
          tabIndex={tabIndex}
        />
      )}
    />
  );
}

/** Labels from the picked container's label list. */
export function ModuleLabelsSelect({ control, projectId }: Omit<Props, "tabIndex">) {
  return (
    <Controller
      control={control}
      name="label_ids"
      render={({ field: { value, onChange } }) => (
        <div className="flex h-7 items-center gap-1">
          <IssuePropertyLabels
            projectId={projectId ?? null}
            value={value ?? []}
            onChange={onChange}
            maxRender={3}
            placeholderText="Labels"
          />
        </div>
      )}
    />
  );
}
