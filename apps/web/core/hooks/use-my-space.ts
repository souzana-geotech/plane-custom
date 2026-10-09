/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Geotech3D: "My Space" - one private container per person, kept in the shared
 * My Space workspace (`IWorkspace.is_my_space`) and reached from every company
 * workspace. This hook opens it from the current workspace and remembers where
 * it was opened from, so the My Space sidebar can offer a way back.
 */

import { useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IWorkspace } from "@plane/types";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserSettings } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
// services
import { ProjectService } from "@/services/project/project.service";

const projectService = new ProjectService();

/** Where My Space was last opened from, per browser tab. */
const RETURN_TO_KEY = "geotech:my-space:return-to";

const readReturnTo = (): string | null => {
  try {
    return window.sessionStorage.getItem(RETURN_TO_KEY);
  } catch {
    return null;
  }
};

/** Remembers the company workspace a My Space link was followed from, for the "Back to" link. */
export const rememberMySpaceReturn = (slug: string) => {
  try {
    window.sessionStorage.setItem(RETURN_TO_KEY, slug);
  } catch {
    // Private mode or blocked storage: the back link falls back to the last workspace.
  }
};

export const mySpaceProjectPath = (workspaceSlug: string, projectId: string) =>
  `/${workspaceSlug}/projects/${projectId}/issues/`;

export const useMySpace = () => {
  const { t } = useTranslation();
  const router = useAppRouter();
  const { workspaceSlug } = useParams();
  const { workspaces, currentWorkspace, fetchWorkspaces } = useWorkspace();
  const { data: userSettings } = useUserSettings();
  const [isOpening, setIsOpening] = useState(false);

  const isInMySpace = !!currentWorkspace?.is_my_space;

  /** The company workspace the "Back to" link returns to. */
  const returnWorkspace = useMemo<IWorkspace | undefined>(() => {
    const companyWorkspaces = Object.values(workspaces ?? {}).filter((workspace) => !workspace.is_my_space);
    const bySlug = (slug: string | null | undefined) =>
      slug ? companyWorkspaces.find((workspace) => workspace.slug === slug) : undefined;
    return (
      bySlug(readReturnTo()) ??
      bySlug(userSettings?.workspace?.last_workspace_slug) ??
      bySlug(userSettings?.workspace?.fallback_workspace_slug) ??
      companyWorkspaces[0]
    );
    // `currentWorkspace` changes when My Space is entered, which is when the stored slug is read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, userSettings, currentWorkspace]);

  const openMySpace = useCallback(async () => {
    const fromSlug = workspaceSlug?.toString();
    if (!fromSlug || isOpening) return;
    setIsOpening(true);
    try {
      const mySpace = await projectService.openMySpace(fromSlug);
      rememberMySpaceReturn(fromSlug);
      // The first open joins the user to the My Space workspace; the workspace
      // layout only renders workspaces it already knows about.
      if (!Object.values(workspaces ?? {}).some((workspace) => workspace.slug === mySpace.workspace_slug)) {
        await fetchWorkspaces();
      }
      router.push(mySpaceProjectPath(mySpace.workspace_slug, mySpace.id));
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("my_space.open_error.title"),
        message: t("my_space.open_error.message"),
      });
    } finally {
      setIsOpening(false);
    }
  }, [workspaceSlug, isOpening, workspaces, fetchWorkspaces, router, t]);

  return { isInMySpace, isOpening, openMySpace, returnWorkspace };
};
