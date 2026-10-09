/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// components
import { Outlet, useParams } from "react-router";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { MySpaceTasksHeader } from "@/components/my-space/header";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { ProjectIssuesHeader } from "./header";
import { ProjectIssuesMobileHeader } from "./mobile-header";

function ProjectIssuesLayout() {
  const { projectId } = useParams();
  const { getProjectById } = useProject();
  // Geotech3D: My Space is a plain to-do list - no layouts, filters or analytics.
  const isPersonal = !!getProjectById(projectId)?.is_personal;

  return (
    <>
      <AppHeader
        header={isPersonal ? <MySpaceTasksHeader /> : <ProjectIssuesHeader />}
        mobileHeader={isPersonal ? undefined : <ProjectIssuesMobileHeader />}
      />
      <ContentWrapper>
        <Outlet />
      </ContentWrapper>
    </>
  );
}

export default observer(ProjectIssuesLayout);
