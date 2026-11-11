/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { PillButton } from "@makeplane/propel/components/pill";
import { CloseOutline } from "@makeplane/propel/icons";
import type { TModuleDisplayFilters, TModuleFilters } from "@plane/types";
// components
import { Header, EHeaderVariant } from "@plane/ui";
import { replaceUnderscoreIfSnakeCase } from "@plane/utils";
import { AppliedLabelsFilters } from "@/components/issues/issue-layouts/filters/applied-filters/label";
import { AppliedPriorityFilters } from "@/components/issues/issue-layouts/filters/applied-filters/priority";
import { AppliedStateFilters } from "@/components/issues/issue-layouts/filters/applied-filters/state";
import { AppliedDateFilters, AppliedMembersFilters } from "@/components/modules";
import { useLabel } from "@/hooks/store/use-label";
import { useProjectState } from "@/hooks/store/use-project-state";
// helpers
// types

type Props = {
  appliedFilters: TModuleFilters;
  isFavoriteFilterApplied?: boolean;
  handleClearAllFilters: () => void;
  handleDisplayFiltersUpdate?: (updatedDisplayProperties: Partial<TModuleDisplayFilters>) => void;
  handleRemoveFilter: (key: keyof TModuleFilters, value: string | null) => void;
  alwaysAllowEditing?: boolean;
  isArchived?: boolean;
};

const MEMBERS_FILTERS = new Set(["lead", "members"]);
const DATE_FILTERS = new Set(["start_date", "target_date"]);

export const ModuleAppliedFiltersList = observer(function ModuleAppliedFiltersList(props: Props) {
  const {
    appliedFilters,
    isFavoriteFilterApplied,
    handleClearAllFilters,
    handleRemoveFilter,
    handleDisplayFiltersUpdate,
    alwaysAllowEditing,
    isArchived = false,
  } = props;
  const { t } = useTranslation();
  const { projectId } = useParams();
  const { getProjectStates } = useProjectState();
  const { getProjectLabels } = useLabel();

  // a legacy "status" filter saved by an older build is no longer applied, so it is not shown either
  const visibleFilters = Object.entries(appliedFilters ?? {}).filter(
    ([key, value]) => key !== "status" && !!value && (!Array.isArray(value) || value.length > 0)
  );
  if (visibleFilters.length === 0 && !isFavoriteFilterApplied) return null;

  const isEditingAllowed = alwaysAllowEditing;

  return (
    <Header variant={EHeaderVariant.TERNARY}>
      <div className="flex flex-wrap gap-2">
        {visibleFilters.map(([key, value]) => {
          const filterKey = key as keyof TModuleFilters;

          if (!value) return;
          if (Array.isArray(value) && value.length === 0) return;

          return (
            <div
              key={filterKey}
              className="my-auto flex min-h-9 cursor-pointer flex-wrap items-center gap-1.5 rounded-md border border-subtle p-1.5 text-11 text-tertiary capitalize hover:text-secondary"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-11 text-tertiary">{replaceUnderscoreIfSnakeCase(filterKey)}</span>
                {filterKey === "state" && (
                  <AppliedStateFilters
                    editable={isEditingAllowed}
                    handleRemove={(val) => handleRemoveFilter("state", val)}
                    states={getProjectStates(projectId?.toString()) ?? []}
                    values={value}
                  />
                )}
                {filterKey === "label" && (
                  <AppliedLabelsFilters
                    editable={isEditingAllowed}
                    handleRemove={(val) => handleRemoveFilter("label", val)}
                    labels={getProjectLabels(projectId?.toString())}
                    values={value}
                  />
                )}
                {filterKey === "priority" && (
                  <AppliedPriorityFilters
                    editable={isEditingAllowed}
                    handleRemove={(val) => handleRemoveFilter("priority", val)}
                    values={value}
                  />
                )}
                {DATE_FILTERS.has(filterKey) && (
                  <AppliedDateFilters
                    editable={isEditingAllowed}
                    handleRemove={(val) => handleRemoveFilter(filterKey, val)}
                    values={value}
                  />
                )}
                {MEMBERS_FILTERS.has(filterKey) && (
                  <AppliedMembersFilters
                    editable={isEditingAllowed}
                    handleRemove={(val) => handleRemoveFilter(filterKey, val)}
                    values={value}
                  />
                )}
                {isEditingAllowed && (
                  <button
                    type="button"
                    className="grid place-items-center text-tertiary hover:text-secondary"
                    onClick={() => handleRemoveFilter(filterKey, null)}
                  >
                    <CloseOutline height={12} width={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!isArchived && isFavoriteFilterApplied && (
          <div
            key="module_display_filters"
            className="flex flex-wrap items-center gap-2 rounded-md border border-subtle px-2 py-1 capitalize"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-11 text-tertiary">Jobs</span>
              <div className="flex items-center gap-1 rounded-sm bg-layer-1 p-1 text-11">
                Favorite
                {isEditingAllowed && (
                  <button
                    type="button"
                    className="grid place-items-center text-tertiary hover:text-secondary"
                    onClick={() =>
                      handleDisplayFiltersUpdate &&
                      handleDisplayFiltersUpdate({
                        favorites: !isFavoriteFilterApplied,
                      })
                    }
                  >
                    <CloseOutline height={10} width={10} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {isEditingAllowed && (
          <PillButton
            type="button"
            size="md"
            variant="outline"
            label={t("common.clear_all")}
            endIcon={<CloseOutline height={12} width={12} />}
            onClick={handleClearAllFilters}
          />
        )}
      </div>
    </Header>
  );
});
