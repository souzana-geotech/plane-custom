/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/ui";
// components
import { PageHead } from "@/components/core/page-title";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import { rememberMySpaceReturn } from "@/hooks/use-my-space";
// services
import { ProjectService } from "@/services/project/project.service";

const projectService = new ProjectService();

/**
 * Geotech3D: the way into Personal Space from any workspace.
 *
 * Personal Space is an ordinary container (tasks, Jobs, cycles, views, pages) in
 * the shared Personal Space workspace. This page asks for the caller's own one
 * (setting it up on first use), remembers which workspace they came from for the
 * sidebar's "Back to" link, and opens the container there.
 */
function MySpacePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { workspaceSlug } = useParams();
  const { workspaces, fetchWorkspaces } = useWorkspace();
  const slug = workspaceSlug?.toString();

  const { data: mySpace, error } = useSWR(
    slug ? `MY_SPACE_OPEN_${slug}` : null,
    () => projectService.openMySpace(slug!),
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if (!mySpace || !slug) return;
    let cancelled = false;
    const open = async () => {
      // The first open joins the user to the Personal Space workspace; the app
      // only opens workspaces it knows about.
      if (!Object.values(workspaces ?? {}).some((workspace) => workspace.slug === mySpace.workspace_slug)) {
        await fetchWorkspaces();
      }
      if (cancelled) return;
      rememberMySpaceReturn(slug);
      router.replace(`/${mySpace.workspace_slug}/projects/${mySpace.id}/issues/`);
    };
    void open();
    return () => {
      cancelled = true;
    };
  }, [mySpace, slug, workspaces, fetchWorkspaces, router]);

  return (
    <>
      <PageHead title={t("my_space.title")} />
      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
          <p className="text-13 font-medium text-primary">{t("my_space.open_error.title")}</p>
          <p className="text-12 text-tertiary">{t("my_space.open_error.message")}</p>
        </div>
      ) : (
        <Loader className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6">
          <Loader.Item height="28px" width="30%" />
          <Loader.Item height="40px" />
          <Loader.Item height="120px" />
        </Loader>
      )}
    </>
  );
}

export default observer(MySpacePage);
