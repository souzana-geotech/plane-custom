/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Geotech3D: where a container opens.
 *
 * Opening a container (from the sidebar, the container list, search, recents...)
 * goes to its root, `/<workspace>/projects/<id>/`, which picks the page:
 *
 * 1. the default tab the user chose for the container, if they chose one;
 * 2. otherwise the part of the container they used last (Tasks, Jobs, ...), so
 *    someone who always works on the board lands on it - the board layout itself
 *    is already remembered by the Tasks page;
 * 3. otherwise the Overview, which is what someone new to the container sees.
 *
 * Only tabs the user can open count; anything else falls back to the first one.
 */

import { useMemo } from "react";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { DEFAULT_TAB_KEY, getTabUrl } from "./tab-navigation-utils";
import { useNavigationItems } from "./use-navigation-items";

export const OVERVIEW_TAB_KEY = "overview";

const LAST_TAB_STORAGE_KEY = "geotech3d_container_last_tab";

/** The container part a path segment belongs to, e.g. `modules` -> the Jobs tab. */
const TAB_KEY_BY_SEGMENT: Record<string, string> = {
  overview: OVERVIEW_TAB_KEY,
  issues: "work_items",
  cycles: "cycles",
  modules: "modules",
  views: "views",
  pages: "pages",
  intake: "intake",
};

/** The tab a container path is in, or null outside the container's tabs. */
export const getContainerTabFromPath = (pathname: string, projectId: string): string | null => {
  const marker = `/projects/${projectId}/`;
  const index = pathname.indexOf(marker);
  if (index === -1) return null;
  const segment = pathname.slice(index + marker.length).split("/")[0];
  return TAB_KEY_BY_SEGMENT[segment] ?? null;
};

const readLastTabs = (): Record<string, string> => {
  try {
    const stored = localStorage.getItem(LAST_TAB_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Record<string, string>) : {};
  } catch {
    return {};
  }
};

/** Remembers, in this browser, the part of a container the user is in. */
export const rememberContainerTab = (projectId: string, tabKey: string) => {
  try {
    const lastTabs = readLastTabs();
    if (lastTabs[projectId] === tabKey) return;
    localStorage.setItem(LAST_TAB_STORAGE_KEY, JSON.stringify({ ...lastTabs, [projectId]: tabKey }));
  } catch {
    // storage may be unavailable; the container then opens on its Overview
  }
};

/** The root of a container; opening it picks the page (see above). */
export const getContainerEntryHref = (workspaceSlug: string, projectId: string) =>
  `/${workspaceSlug}/projects/${projectId}/`;

/** The page a container opens on for the current user, or null until the container is known. */
export const useContainerEntryUrl = (workspaceSlug: string, projectId: string): string | null => {
  const { getPartialProjectById } = useProject();
  const { allowPermissions } = useUserPermissions();
  const {
    project: { getProjectUserProperties },
  } = useMember();
  const project = getPartialProjectById(projectId);
  const navigationItems = useNavigationItems({ workspaceSlug, projectId, project, allowPermissions });
  // Plane stores "Tasks" when a chosen default tab is cleared, so only another tab counts as a choice.
  const chosenTab = getProjectUserProperties(projectId)?.preferences?.navigation?.default_tab;

  return useMemo(() => {
    if (!project || navigationItems.length === 0) return null;
    const available = navigationItems.map((item) => item.key);
    const candidates = [
      chosenTab && chosenTab !== DEFAULT_TAB_KEY ? chosenTab : null,
      readLastTabs()[projectId] ?? null,
      OVERVIEW_TAB_KEY,
    ];
    const tabKey = candidates.find((key): key is string => !!key && available.includes(key)) ?? available[0];
    return getTabUrl(workspaceSlug, projectId, tabKey);
  }, [project, navigationItems, chosenTab, workspaceSlug, projectId]);
};
