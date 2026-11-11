/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TModuleOrderByOptions =
  | "name"
  | "-name"
  | "progress"
  | "-progress"
  | "issues_length"
  | "-issues_length"
  | "target_date"
  | "-target_date"
  | "created_at"
  | "-created_at"
  | "priority"
  | "-priority"
  | "sort_order";

export type TModuleLayoutOptions = "list" | "board" | "kanban" | "gantt";

export type TModuleDisplayFilters = {
  favorites?: boolean;
  layout?: TModuleLayoutOptions;
  order_by?: TModuleOrderByOptions;
};

export type TModuleFilters = {
  lead?: string[] | null;
  members?: string[] | null;
  start_date?: string[] | null;
  /** @deprecated Jobs use the container's states; kept so saved filters still parse, no longer applied */
  status?: string[] | null;
  /** state ids of the container's states (Geotech3D) */
  state?: string[] | null;
  priority?: string[] | null;
  /** label ids from the container's label list (Geotech3D) */
  label?: string[] | null;
  target_date?: string[] | null;
};

export type TModuleFiltersByState = {
  default: TModuleFilters;
  archived: TModuleFilters;
};

export type TModuleStoredFilters = {
  display_filters?: TModuleDisplayFilters;
  filters?: TModuleFilters;
};
