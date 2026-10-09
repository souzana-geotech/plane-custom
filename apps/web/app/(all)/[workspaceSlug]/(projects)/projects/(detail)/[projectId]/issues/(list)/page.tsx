/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// i18n
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { ProjectLayoutRoot } from "@/components/issues/issue-layouts/roots/project-layout-root";
import { MySpaceTaskList } from "@/components/my-space/task-list";
// hooks
import { useProject } from "@/hooks/store/use-project";
import type { Route } from "./+types/page";

function ProjectIssuesPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  // i18n
  const { t } = useTranslation();
  // store
  const { getProjectById } = useProject();

  // derived values
  const project = getProjectById(projectId);
  const pageTitle = project?.name ? `${project?.name} - ${t("issue.label", { count: 2 })}` : undefined; // Count is for pluralization

  return (
    <>
      <PageHead title={pageTitle} />
      <div className="h-full w-full">
        {/* Geotech3D: My Space is a plain to-do list, not a container layout. */}
        {project?.is_personal ? (
          <MySpaceTaskList workspaceSlug={workspaceSlug} projectId={projectId} />
        ) : (
          <ProjectLayoutRoot />
        )}
      </div>
    </>
  );
}

export default observer(ProjectIssuesPage);
