/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Geotech3D: "Personal Space" - one private, ordinary container per person, kept
 * in the shared Personal Space workspace (`IWorkspace.is_my_space`). Users open
 * it from any workspace (`/<workspace>/my-space/`), which takes them into that
 * shared workspace; its sidebar then offers the way back to where they came from.
 */

import { useMemo } from "react";
// plane imports
import type { IWorkspace } from "@plane/types";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserSettings } from "@/hooks/store/user";

const RETURN_TO_KEY = "geotech3d_personal_space_return_to";

/** Remembers the workspace Personal Space was opened from, for this tab. */
export const rememberMySpaceReturn = (workspaceSlug: string) => {
  try {
    sessionStorage.setItem(RETURN_TO_KEY, workspaceSlug);
  } catch {
    // storage may be unavailable; the "Back to" link falls back to the last workspace
  }
};

const readMySpaceReturn = () => {
  try {
    return sessionStorage.getItem(RETURN_TO_KEY);
  } catch {
    return null;
  }
};

export const useMySpace = () => {
  const { workspaces, currentWorkspace } = useWorkspace();
  const { data: userSettings } = useUserSettings();

  const isInMySpace = !!currentWorkspace?.is_my_space;

  /** The company workspace the "Back to" link returns to. */
  const returnWorkspace = useMemo<IWorkspace | undefined>(() => {
    const companyWorkspaces = Object.values(workspaces ?? {}).filter((workspace) => !workspace.is_my_space);
    const bySlug = (slug: string | null | undefined) =>
      slug ? companyWorkspaces.find((workspace) => workspace.slug === slug) : undefined;
    return (
      bySlug(readMySpaceReturn()) ??
      bySlug(userSettings?.workspace?.last_workspace_slug) ??
      bySlug(userSettings?.workspace?.fallback_workspace_slug) ??
      companyWorkspaces[0]
    );
  }, [workspaces, userSettings]);

  return { isInMySpace, returnWorkspace };
};
