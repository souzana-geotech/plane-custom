/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TProject } from "@plane/types";

/**
 * Bars are colored by **project**, not by state group.
 *
 * This view exists to answer "which project is each person on?", so project identity is the
 * primary dimension and deserves the strongest visual encoding. Progress is carried by opacity
 * (completed work is faded) and by the icons on the bar, not by hue.
 */

/**
 * Fallback palette, used when a project has no icon color of its own. Hues are spaced far enough
 * apart to stay distinguishable, and mid-tone enough to hold white text in both themes.
 */
const PROJECT_PALETTE = [
  "#3f76ff",
  "#e8618c",
  "#0ea5e9",
  "#f59e0b",
  "#8b5cf6",
  "#10b981",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#6366f1",
];

/** Stable, order-independent index into the palette so a project keeps its color across reloads. */
const hashToIndex = (value: string, buckets: number): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % buckets;
};

/**
 * The color used for a project's bars: its own icon color when it has one, otherwise a stable
 * color derived from its id.
 */
export const getProjectColor = (projectId: string, project: TProject | undefined): string => {
  const iconColor = project?.logo_props?.in_use === "icon" ? project.logo_props.icon?.color : undefined;
  if (iconColor) return iconColor;
  return PROJECT_PALETTE[hashToIndex(projectId, PROJECT_PALETTE.length)];
};
