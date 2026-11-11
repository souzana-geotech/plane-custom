/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { sortBy } from "lodash-es";
// plane imports
import type { IModule, TModuleDisplayFilters, TModuleFilters, TModuleOrderByOptions } from "@plane/types";
// local imports
import { getDate } from "./datetime";
import { satisfiesDateFilter } from "./filter";

const MODULE_PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

/**
 * @description performs natural sorting of strings (handles numbers within strings correctly)
 * @param {string} a - first string to compare
 * @param {string} b - second string to compare
 * @returns {number} - comparison result (-1, 0, or 1)
 */
const naturalSort = (a: string, b: string): number => collator.compare(a, b);
/**
 * @description orders modules based on their status
 * @param {IModule[]} modules
 * @param {TModuleOrderByOptions | undefined} orderByKey
 * @returns {IModule[]}
 */
export const orderModules = (modules: IModule[], orderByKey: TModuleOrderByOptions | undefined): IModule[] => {
  let orderedModules: IModule[] = [];
  if (modules.length === 0 || !orderByKey) return [];

  if (orderByKey === "name") orderedModules = [...modules].toSorted((a, b) => naturalSort(a.name, b.name));
  if (orderByKey === "-name") orderedModules = [...modules].toSorted((a, b) => naturalSort(b.name, a.name));
  if (["progress", "-progress"].includes(orderByKey))
    orderedModules = sortBy(modules, [
      (m) => {
        let progress = (m.completed_issues + m.cancelled_issues) / m.total_issues;
        if (isNaN(progress)) progress = 0;
        return orderByKey === "progress" ? progress : -progress;
      },
    ]);
  if (["issues_length", "-issues_length"].includes(orderByKey))
    orderedModules = sortBy(modules, [(m) => (orderByKey === "issues_length" ? m.total_issues : !m.total_issues)]);
  if (orderByKey === "target_date") orderedModules = sortBy(modules, [(m) => m.target_date]);
  if (orderByKey === "-target_date") orderedModules = sortBy(modules, [(m) => !m.target_date]);
  if (orderByKey === "created_at") orderedModules = sortBy(modules, [(m) => m.created_at]);
  if (orderByKey === "-created_at") orderedModules = sortBy(modules, [(m) => !m.created_at]);
  if (orderByKey === "priority" || orderByKey === "-priority") {
    // "priority" puts Urgent first, like the task list; "-priority" reverses it
    const rank = (m: IModule) => MODULE_PRIORITY_RANK[m.priority ?? "none"] ?? MODULE_PRIORITY_RANK.none;
    orderedModules = sortBy(modules, [(m) => (orderByKey === "priority" ? rank(m) : -rank(m))]);
  }

  // a "-sort_order" saved by an older build is still manual order, not an empty list
  if (orderByKey.endsWith("sort_order")) orderedModules = sortBy(modules, [(m) => m.sort_order]);
  return orderedModules;
};

/**
 * @description splits Jobs into one bucket per container state (Geotech3D: Jobs use the container's task
 * states), keeping the incoming order inside each bucket. A Job with no state, or one whose state the board has
 * no column for, lands in the first column so it never disappears.
 * @param {IModule[]} modules
 * @param {string[]} stateIds column order (the container's states, in States-page order)
 * @returns {Record<string, IModule[]>}
 */
export const groupModulesByState = (modules: IModule[], stateIds: string[]): Record<string, IModule[]> => {
  const grouped: Record<string, IModule[]> = {};
  stateIds.forEach((stateId) => {
    grouped[stateId] = [];
  });
  const fallback = stateIds[0];
  modules.forEach((module) => {
    const bucket =
      (module.state_id ? grouped[module.state_id] : undefined) ?? (fallback ? grouped[fallback] : undefined);
    bucket?.push(module);
  });
  return grouped;
};

const MODULE_SORT_ORDER_GAP = 10000;

/**
 * @description works out the manual sort order for a module dropped into a column of the status board.
 * Returns undefined when the drop would leave the module exactly where it already is.
 * @param {Pick<IModule, "id" | "sort_order">[]} columnModules the column's modules in manual order
 * @param {string} draggedId
 * @param {string | undefined} targetId the card it was dropped on; undefined means the column's empty space, i.e. the end
 * @param {"top" | "bottom"} edge which half of the target card it was dropped on
 * @param {number[]} otherSortOrders sort orders of every other module in the project. The order is shared by all
 * columns, so a card going first or last in its column is slotted next to its nearest neighbour overall
 * rather than given a value another column may already hold.
 * @returns {number | undefined}
 */
export const getModuleSortOrderOnDrop = (
  columnModules: Pick<IModule, "id" | "sort_order">[],
  draggedId: string,
  targetId: string | undefined,
  edge: "top" | "bottom" = "bottom",
  otherSortOrders: number[] = []
): number | undefined => {
  if (targetId === draggedId) return undefined;
  const originalIndex = columnModules.findIndex((m) => m.id === draggedId);
  const others = columnModules.filter((m) => m.id !== draggedId);

  let insertAt = others.length;
  if (targetId) {
    const targetIndex = others.findIndex((m) => m.id === targetId);
    if (targetIndex !== -1) insertAt = edge === "top" ? targetIndex : targetIndex + 1;
  }
  // already sitting in that slot of this column
  if (originalIndex === insertAt) return undefined;

  const previous = others[insertAt - 1];
  const next = others[insertAt];
  if (previous && next) return (previous.sort_order + next.sort_order) / 2;
  if (next) {
    const below = otherSortOrders.filter((order) => order < next.sort_order);
    return below.length > 0 ? (Math.max(...below) + next.sort_order) / 2 : next.sort_order - MODULE_SORT_ORDER_GAP;
  }
  if (previous) {
    const above = otherSortOrders.filter((order) => order > previous.sort_order);
    return above.length > 0
      ? (previous.sort_order + Math.min(...above)) / 2
      : previous.sort_order + MODULE_SORT_ORDER_GAP;
  }
  // an empty column: nothing to be ordered against
  return undefined;
};

/**
 * @description filters modules based on the filters
 * @param {IModule} module
 * @param {TModuleDisplayFilters} displayFilters
 * @param {TModuleFilters} filters
 * @returns {boolean}
 */
export const shouldFilterModule = (
  module: IModule,
  displayFilters: TModuleDisplayFilters,
  filters: TModuleFilters
): boolean => {
  let fallsInFilters = true;
  Object.keys(filters).forEach((key) => {
    const filterKey = key as keyof TModuleFilters;
    // "status" is no longer applied: Jobs use the container's states (filter by "state")
    if (filterKey === "state" && filters.state && filters.state.length > 0)
      fallsInFilters = fallsInFilters && filters.state.includes(`${module.state_id}`);
    if (filterKey === "label" && filters.label && filters.label.length > 0) {
      const labelIds = module.label_ids ?? [];
      fallsInFilters = fallsInFilters && filters.label.some((labelId) => labelIds.includes(labelId));
    }
    if (filterKey === "priority" && filters.priority && filters.priority.length > 0)
      fallsInFilters = fallsInFilters && filters.priority.includes(module.priority ?? "none");
    if (filterKey === "lead" && filters.lead && filters.lead.length > 0)
      fallsInFilters = fallsInFilters && filters.lead.includes(`${module.lead_id}`);
    if (filterKey === "members" && filters.members && filters.members.length > 0) {
      const memberIds = module.member_ids ?? [];
      fallsInFilters = fallsInFilters && filters.members.some((memberId) => memberIds.includes(memberId));
    }
    if (filterKey === "start_date" && filters.start_date && filters.start_date.length > 0) {
      const startDate = getDate(module.start_date);
      filters.start_date.forEach((dateFilter) => {
        fallsInFilters = fallsInFilters && !!startDate && satisfiesDateFilter(startDate, dateFilter);
      });
    }
    if (filterKey === "target_date" && filters.target_date && filters.target_date.length > 0) {
      const endDate = getDate(module.target_date);
      filters.target_date.forEach((dateFilter) => {
        fallsInFilters = fallsInFilters && !!endDate && satisfiesDateFilter(endDate, dateFilter);
      });
    }
  });
  if (displayFilters.favorites && !module.is_favorite) fallsInFilters = false;

  return fallsInFilters;
};
