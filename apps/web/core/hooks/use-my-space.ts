/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Geotech3D: "My Space" - one private container per person, kept in the shared
 * My Space workspace (`IWorkspace.is_my_space`). Users reach it from inside their
 * own workspace (`/<workspace>/my-space/`), so they normally never visit that
 * shared workspace. Should they land in it anyway, the sidebar offers a way back.
 */

import { useMemo } from "react";
// plane imports
import type { IWorkspace } from "@plane/types";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserSettings } from "@/hooks/store/user";

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
      bySlug(userSettings?.workspace?.last_workspace_slug) ??
      bySlug(userSettings?.workspace?.fallback_workspace_slug) ??
      companyWorkspaces[0]
    );
  }, [workspaces, userSettings]);

  return { isInMySpace, returnWorkspace };
};
