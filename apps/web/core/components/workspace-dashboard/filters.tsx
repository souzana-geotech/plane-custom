/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
import { X } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import type { ICustomSearchSelectOption } from "@plane/types";
import { CustomSearchSelect } from "@plane/ui";
// hooks
import { useLabel } from "@/hooks/store/use-label";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
// local imports
import { useWorkspaceDashboard } from "./data/context";
import { isActiveModule } from "./data/metrics";

const ALL = "__all__";

const selectedLabel = (options: ICustomSearchSelectOption[], value: string | null, placeholder: string) => {
  if (!value) return placeholder;
  const option = options.find((item) => item.value === value);
  return option?.query ?? placeholder;
};

export const WorkspaceDashboardFilters = observer(function WorkspaceDashboardFilters() {
  const { t } = useTranslation();
  const { allModules, filters, updateFilters, clearFilters, hasActiveFilters, isLoading } = useWorkspaceDashboard();
  // store hooks
  const { joinedProjectIds, getProjectById, getProjectIdentifierById } = useProject();
  const { workspaceLabels } = useLabel();
  const {
    getUserDetails,
    workspace: { workspaceMemberIds },
  } = useMember();

  const allOption = (label: string): ICustomSearchSelectOption => ({
    value: ALL,
    query: label,
    content: label,
  });

  const projectOptions: ICustomSearchSelectOption[] = useMemo(
    () => [
      allOption(t("workspace_dashboard.filters.all")),
      ...joinedProjectIds.map((projectId) => {
        const name = getProjectById(projectId)?.name ?? projectId;
        return { value: projectId, query: name, content: name };
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [joinedProjectIds, getProjectById, t]
  );

  const moduleOptions: ICustomSearchSelectOption[] = useMemo(
    () => [
      allOption(t("workspace_dashboard.filters.all")),
      ...allModules
        .filter((module) => isActiveModule(module) && (!filters.projectId || module.project_id === filters.projectId))
        .map((module) => ({
          value: module.id,
          query: module.name,
          content: module.name,
        })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allModules, filters.projectId, t]
  );

  const labelOptions: ICustomSearchSelectOption[] = useMemo(() => {
    const labels = (workspaceLabels ?? []).filter(
      (label) =>
        joinedProjectIds.includes(label.project_id) && (!filters.projectId || label.project_id === filters.projectId)
    );
    const showProject = !filters.projectId && joinedProjectIds.length > 1;
    return [
      allOption(t("workspace_dashboard.filters.all")),
      ...labels.map((label) => {
        const suffix = showProject ? ` (${getProjectIdentifierById(label.project_id)})` : "";
        return {
          value: label.id,
          query: `${label.name}${suffix}`,
          content: (
            <span className="flex items-center gap-2">
              <span className="size-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
              <span className="truncate">
                {label.name}
                {suffix}
              </span>
            </span>
          ),
        };
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceLabels, joinedProjectIds, filters.projectId, getProjectIdentifierById, t]);

  const memberOptions: ICustomSearchSelectOption[] = useMemo(
    () => [
      allOption(t("workspace_dashboard.filters.all")),
      ...(workspaceMemberIds ?? [])
        .map((memberId) => getUserDetails(memberId))
        .filter((member) => member && !member.is_bot)
        .map((member) => ({
          value: member!.id,
          query: member!.display_name,
          content: member!.display_name,
        })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceMemberIds, getUserDetails, t]
  );

  const renderSelect = (
    key: "projectId" | "moduleId" | "labelId" | "assigneeId",
    options: ICustomSearchSelectOption[],
    placeholder: string
  ) => (
    <CustomSearchSelect
      value={filters[key] ?? ALL}
      onChange={(value: string) => {
        const nextValue = value === ALL ? null : value;
        // narrowing the project resets the job and department filters that belong to other projects
        if (key === "projectId")
          updateFilters({
            projectId: nextValue,
            moduleId: null,
            labelId: null,
          });
        else updateFilters({ [key]: nextValue });
      }}
      options={options}
      label={
        <span className="flex items-center gap-1 text-12">
          <span className="text-tertiary">{placeholder}:</span>
          <span className="max-w-40 truncate font-medium text-primary">
            {selectedLabel(options, filters[key], t("workspace_dashboard.filters.all"))}
          </span>
        </span>
      }
      buttonClassName="h-8 rounded-md border border-subtle bg-surface-1 px-2.5 hover:bg-layer-transparent-hover"
      optionsClassName="w-64"
      maxHeight="md"
      disabled={isLoading}
    />
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {joinedProjectIds.length > 1 &&
        renderSelect("projectId", projectOptions, t("workspace_dashboard.filters.project"))}
      {renderSelect("moduleId", moduleOptions, t("workspace_dashboard.filters.job"))}
      {renderSelect("labelId", labelOptions, t("workspace_dashboard.filters.department"))}
      {renderSelect("assigneeId", memberOptions, t("workspace_dashboard.filters.employee"))}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters} prependIcon={<X className="size-3.5" />}>
          {t("workspace_dashboard.filters.clear")}
        </Button>
      )}
    </div>
  );
});
