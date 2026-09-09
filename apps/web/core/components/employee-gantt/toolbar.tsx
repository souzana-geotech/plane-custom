/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
import { Search, X } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import type { ICustomSearchSelectOption } from "@plane/types";
import { CustomSearchSelect } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
// local imports
import { useEmployeeGantt } from "./data/context";
import type { TEmployeeGanttZoom } from "./data/types";

const ALL = "__all__";

const ZOOM_LEVELS: TEmployeeGanttZoom[] = ["day", "week", "month"];

const selectedLabel = (options: ICustomSearchSelectOption[], value: string | null, placeholder: string) => {
  if (!value) return placeholder;
  return options.find((option) => option.value === value)?.query ?? placeholder;
};

/** A checkbox rendered as a pill, used for the display toggles. */
function TogglePill(props: { label: string; isActive: boolean; onChange: (next: boolean) => void; title?: string }) {
  const { label, isActive, onChange, title } = props;
  return (
    <button
      type="button"
      onClick={() => onChange(!isActive)}
      aria-pressed={isActive}
      title={title}
      className={cn(
        "h-8 shrink-0 rounded-md border px-2.5 text-11 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong",
        isActive
          ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
          : "border-subtle text-tertiary hover:bg-layer-transparent-hover"
      )}
    >
      {label}
    </button>
  );
}

export const EmployeeGanttToolbar = observer(function EmployeeGanttToolbar() {
  const { t } = useTranslation();
  const { filters, updateFilters, clearFilters, hasActiveFilters, zoom, setZoom, scrollToToday, scale } =
    useEmployeeGantt();
  // store hooks
  const { joinedProjectIds, getProjectById } = useProject();
  const {
    getUserDetails,
    workspace: { workspaceMemberIds },
  } = useMember();

  const allOptionLabel = t("employee_gantt.filters.all");

  const projectOptions: ICustomSearchSelectOption[] = useMemo(
    () => [
      { value: ALL, query: allOptionLabel, content: allOptionLabel },
      ...joinedProjectIds.map((projectId) => {
        const name = getProjectById(projectId)?.name ?? projectId;
        return { value: projectId, query: name, content: name };
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [joinedProjectIds, getProjectById, allOptionLabel]
  );

  const employeeOptions: ICustomSearchSelectOption[] = useMemo(
    () => [
      { value: ALL, query: allOptionLabel, content: allOptionLabel },
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
    [workspaceMemberIds, getUserDetails, allOptionLabel]
  );

  const renderSelect = (key: "projectId" | "employeeId", options: ICustomSearchSelectOption[], placeholder: string) => (
    <CustomSearchSelect
      value={filters[key] ?? ALL}
      onChange={(value: string) => updateFilters({ [key]: value === ALL ? null : value })}
      options={options}
      label={
        <span className="flex items-center gap-1 text-12">
          <span className="text-tertiary">{placeholder}:</span>
          <span className="max-w-32 truncate font-medium text-primary">
            {selectedLabel(options, filters[key], allOptionLabel)}
          </span>
        </span>
      }
      buttonClassName="h-8 rounded-md border border-subtle bg-surface-1 px-2.5 hover:bg-layer-transparent-hover"
      optionsClassName="w-64"
      maxHeight="md"
    />
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-tertiary" />
        <input
          type="text"
          value={filters.search}
          onChange={(event) => updateFilters({ search: event.target.value })}
          placeholder={t("employee_gantt.filters.search_placeholder")}
          aria-label={t("employee_gantt.filters.search_placeholder")}
          className="focus:border-accent-primary h-8 w-44 rounded-md border border-subtle bg-surface-1 pr-2 pl-7 text-12 text-primary outline-none placeholder:text-placeholder"
        />
      </div>

      {renderSelect("projectId", projectOptions, t("employee_gantt.filters.project"))}
      {renderSelect("employeeId", employeeOptions, t("employee_gantt.filters.employee"))}

      <TogglePill
        label={t("employee_gantt.filters.today_only")}
        title={t("employee_gantt.filters.today_only_tooltip")}
        isActive={filters.todayOnly}
        onChange={(next) => updateFilters({ todayOnly: next })}
      />
      <TogglePill
        label={t("employee_gantt.filters.hide_empty")}
        isActive={filters.hideEmptyEmployees}
        onChange={(next) => updateFilters({ hideEmptyEmployees: next })}
      />
      <TogglePill
        label={t("employee_gantt.filters.include_completed")}
        isActive={filters.includeCompleted}
        onChange={(next) => updateFilters({ includeCompleted: next })}
      />

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters} prependIcon={<X className="size-3.5" />}>
          {t("employee_gantt.filters.clear")}
        </Button>
      )}

      {/* time controls grouped together on the right, the way the project timeline does it */}
      <div className="ml-auto flex items-center gap-2">
        {/*
          Deliberately always clickable. Gating this on "is today already visible" needs scroll
          derived state, and any staleness there makes the button silently unclickable - a worse
          failure than clicking it when the chart is already showing today, which simply re-centres.
        */}
        <button
          type="button"
          onClick={scrollToToday}
          disabled={scale.todayOffset === null}
          title={t("employee_gantt.chart.today_tooltip")}
          className="h-8 shrink-0 rounded-md border border-subtle px-2.5 text-11 font-medium text-tertiary transition-colors hover:bg-layer-transparent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-50"
        >
          {t("employee_gantt.chart.today")}
        </button>
        <div
          className="flex items-center gap-0.5 rounded-md border border-subtle p-0.5"
          role="group"
          aria-label={t("employee_gantt.zoom.label")}
        >
          {ZOOM_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setZoom(level)}
              aria-pressed={zoom === level}
              className={cn(
                "rounded px-2.5 py-1 text-11 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong",
                zoom === level ? "bg-accent-primary text-on-color" : "text-tertiary hover:bg-layer-transparent-hover"
              )}
            >
              {t(`employee_gantt.zoom.${level}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});
