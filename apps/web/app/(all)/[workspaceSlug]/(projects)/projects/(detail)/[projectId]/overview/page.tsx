/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { ProjectOverview } from "@/components/project/overview/root";
// hooks
import { useProject } from "@/hooks/store/use-project";
import type { Route } from "./+types/page";

function ProjectOverviewPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { t } = useTranslation();
  const { getProjectById } = useProject();
  const project = getProjectById(projectId);

  return (
    <>
      <PageHead title={project?.name ? `${project.name} - ${t("common.overview")}` : undefined} />
      <ProjectOverview workspaceSlug={workspaceSlug} projectId={projectId} />
    </>
  );
}

export default observer(ProjectOverviewPage);
