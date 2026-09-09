/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { FilterOutline, SelectedFilterOutline } from "@makeplane/propel/icons";
import { Logo } from "@plane/propel/emoji-icon-picker";
import { CustomMenu } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local imports
import { useMyWork, type TCountedFilter, type TQueueFilter } from "./my-work-context";

/**
 * Semantic treatment per filter: the count carries the meaning (red = late, amber = today), the
 * label stays neutral. Green is reserved for the selected state so it means "active", not "status".
 */
const FILTERS: { key: TQueueFilter; labelKey: string; countClassName?: string }[] = [
  { key: "all", labelKey: "home.filters.all" },
  { key: "overdue", labelKey: "home.summary.overdue", countClassName: "text-danger-primary" },
  { key: "due_today", labelKey: "home.summary.due_today", countClassName: "text-warning-primary" },
  { key: "in_progress", labelKey: "home.summary.in_progress", countClassName: "text-primary" },
  { key: "upcoming", labelKey: "home.summary.upcoming", countClassName: "text-geo-grey" },
];

/**
 * The work summary and the queue filters are the same control: each item shows its count and
 * filters the queue when clicked. One row, no boxes, scrolls sideways on small screens.
 */
export const FilterBar = observer(function FilterBar() {
  const { t } = useTranslation();
  const { summary, filter, setFilter, isLoading, projectFilter, setProjectFilter } = useMyWork();
  const { joinedProjectIds, getProjectById } = useProject();
  const filteredProject = projectFilter ? getProjectById(projectFilter) : undefined;

  const renderFilter = (item: { key: TQueueFilter; labelKey: string; countClassName?: string }) => {
    const isActive = filter === item.key;
    const count = item.key === "done" ? undefined : summary[item.key as TCountedFilter | "all"];
    return (
      <button
        key={item.key}
        type="button"
        role="tab"
        aria-selected={isActive}
        onClick={() => setFilter(item.key)}
        className={cn(
          "-mb-px flex h-9 flex-shrink-0 items-center gap-1.5 border-b-2 px-1 text-13 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-inset",
          isActive
            ? "border-accent-strong font-medium text-primary"
            : "border-transparent text-secondary hover:border-geo-grey-light hover:text-primary"
        )}
      >
        {typeof count === "number" && (
          <span
            className={cn(
              "text-13 font-semibold tabular-nums",
              count > 0 && item.countClassName ? item.countClassName : "text-geo-grey"
            )}
          >
            {isLoading ? (
              <span className="inline-block h-3 w-4 animate-pulse rounded bg-geo-grey-subtle align-middle" />
            ) : (
              count
            )}
          </span>
        )}
        <span>{t(item.labelKey)}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 border-b border-subtle">
      <div
        role="tablist"
        aria-label={t("home.summary.aria_label")}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4"
      >
        {FILTERS.map(renderFilter)}
        <span aria-hidden className="bg-subtle h-4 w-px flex-shrink-0" />
        {renderFilter({ key: "done", labelKey: "home.filters.done" })}
      </div>

      {/* project filter: secondary, grey, never competes with the tabs */}
      <CustomMenu
        customButton={
          <span
            className={cn(
              "mb-1.5 flex h-7 items-center gap-1.5 rounded-md px-2 text-12 font-medium transition-colors",
              filteredProject
                ? "bg-geo-grey-subtle text-primary"
                : "text-geo-grey hover:bg-geo-grey-subtle hover:text-primary"
            )}
          >
            {filteredProject ? <SelectedFilterOutline className="size-3.5" /> : <FilterOutline className="size-3.5" />}
            <span className="hidden max-w-[10rem] truncate sm:inline">
              {filteredProject ? filteredProject.name : t("home.filter.all_projects")}
            </span>
          </span>
        }
        customButtonClassName="flex flex-shrink-0"
        placement="bottom-end"
        optionsClassName="min-w-[220px]"
        maxHeight="md"
        closeOnSelect
        ariaLabel={t("home.filter.by_project")}
      >
        <CustomMenu.MenuItem
          className={cn("flex items-center gap-2", !projectFilter && "bg-layer-transparent-selected")}
          onClick={() => setProjectFilter(null)}
        >
          <span className="grid size-4 place-items-center">
            <FilterOutline className="size-3.5 text-geo-grey" />
          </span>
          {t("home.filter.all_projects")}
        </CustomMenu.MenuItem>
        {joinedProjectIds.map((projectId) => {
          const project = getProjectById(projectId);
          if (!project) return null;
          return (
            <CustomMenu.MenuItem
              key={projectId}
              className={cn("flex items-center gap-2", projectFilter === projectId && "bg-layer-transparent-selected")}
              onClick={() => setProjectFilter(projectId)}
            >
              <span className="grid size-4 place-items-center">
                <Logo logo={project.logo_props} size={13} />
              </span>
              <span className="truncate">{project.name}</span>
            </CustomMenu.MenuItem>
          );
        })}
      </CustomMenu>
    </div>
  );
});
