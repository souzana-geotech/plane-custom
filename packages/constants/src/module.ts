/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// types
import type { TModuleLayoutOptions, TModuleOrderByOptions } from "@plane/types";

// Geotech3D: Jobs no longer have a fixed status list; they use their container's
// task states (managed on the container's States settings page).

export const MODULE_VIEW_LAYOUTS: {
  key: TModuleLayoutOptions;
  i18n_title: string;
}[] = [
  {
    key: "list",
    i18n_title: "project_modules.layout.list",
  },
  {
    key: "board",
    i18n_title: "project_modules.layout.board",
  },
  {
    // status columns; reuses the task board's label so no new locale key is needed
    key: "kanban",
    i18n_title: "issue.layouts.title.kanban",
  },
  {
    key: "gantt",
    i18n_title: "project_modules.layout.timeline",
  },
];

export const MODULE_ORDER_BY_OPTIONS: {
  key: TModuleOrderByOptions;
  i18n_label: string;
}[] = [
  {
    key: "name",
    i18n_label: "project_modules.order_by.name",
  },
  {
    key: "progress",
    i18n_label: "project_modules.order_by.progress",
  },
  {
    key: "issues_length",
    i18n_label: "project_modules.order_by.issues",
  },
  {
    key: "target_date",
    i18n_label: "project_modules.order_by.due_date",
  },
  {
    key: "created_at",
    i18n_label: "project_modules.order_by.created_at",
  },
  {
    key: "priority",
    i18n_label: "priority",
  },
  {
    key: "sort_order",
    i18n_label: "project_modules.order_by.manual",
  },
];
