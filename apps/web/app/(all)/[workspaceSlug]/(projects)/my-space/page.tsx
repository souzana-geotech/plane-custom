/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/ui";
// components
import { PageHead } from "@/components/core/page-title";
import { MySpaceTaskList } from "@/components/my-space/task-list";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
// services
import { ProjectService } from "@/services/project/project.service";

const projectService = new ProjectService();

/**
 * Geotech3D: My Space, shown inside whichever workspace the user is working in.
 *
 * The personal container lives in the shared My Space workspace; this page asks
 * for it (setting it up on first use) and renders its list here, so opening My
 * Space never switches workspace.
 */
function MySpacePage() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams();
  const searchParams = useSearchParams();
  const { workspaces, fetchWorkspaces } = useWorkspace();
  const slug = workspaceSlug?.toString();

  const { data: mySpace, error } = useSWR(
    slug ? `MY_SPACE_OPEN_${slug}` : null,
    () => projectService.openMySpace(slug!),
    { revalidateOnFocus: false }
  );

  // The first open joins the user to the My Space workspace; refresh the list of
  // workspaces so My Work can find it too.
  useEffect(() => {
    if (!mySpace) return;
    if (!Object.values(workspaces ?? {}).some((workspace) => workspace.slug === mySpace.workspace_slug)) {
      void fetchWorkspaces();
    }
  }, [mySpace, workspaces, fetchWorkspaces]);

  return (
    <>
      <PageHead title={t("my_space.title")} />
      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
          <p className="text-13 font-medium text-primary">{t("my_space.open_error.title")}</p>
          <p className="text-12 text-tertiary">{t("my_space.open_error.message")}</p>
        </div>
      ) : !mySpace ? (
        <Loader className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6">
          <Loader.Item height="28px" width="30%" />
          <Loader.Item height="40px" />
          <Loader.Item height="120px" />
        </Loader>
      ) : (
        <MySpaceTaskList
          workspaceSlug={mySpace.workspace_slug}
          projectId={mySpace.id}
          initialTaskId={searchParams?.get("task")}
        />
      )}
    </>
  );
}

export default observer(MySpacePage);
