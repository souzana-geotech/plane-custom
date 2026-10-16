/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useRouter } from "next/navigation";
// plane imports
import { Loader } from "@plane/ui";
// components
import { useContainerEntryUrl } from "@/components/navigation/container-entry";
import type { Route } from "./+types/page";

/** Geotech3D: opening a container lands on the page the user should see first (see `container-entry`). */
function ProjectRootPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const router = useRouter();
  const entryUrl = useContainerEntryUrl(workspaceSlug, projectId);

  useEffect(() => {
    if (entryUrl) router.replace(entryUrl);
  }, [entryUrl, router]);

  return (
    <Loader className="flex flex-col gap-3 p-page-x py-6">
      <Loader.Item height="28px" width="30%" />
      <Loader.Item height="160px" />
    </Loader>
  );
}

export default observer(ProjectRootPage);
