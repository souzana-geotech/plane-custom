/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { usePathname } from "next/navigation";
import { Outlet } from "react-router";
// plane imports
import { Header, Row } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { getContainerTabFromPath, rememberContainerTab } from "@/components/navigation/container-entry";
import { TabNavigationRoot } from "@/components/navigation/tab-navigation-root";
import { AppSidebarToggleButton } from "@/components/sidebar/sidebar-toggle-button";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { useProjectNavigationPreferences } from "@/hooks/use-navigation-preferences";
// layouts
import { ProjectAuthWrapper } from "@/layouts/auth-layout/project-wrapper";
// local imports
import type { Route } from "./+types/layout";

function ProjectLayout({ params }: Route.ComponentProps) {
  // router
  const { workspaceSlug, projectId } = params;
  // store hooks
  const { sidebarCollapsed } = useAppTheme();
  // preferences
  const { preferences: projectPreferences } = useProjectNavigationPreferences();
  const pathname = usePathname();

  // Geotech3D: remember which part of the container the user is in, so it opens there next time.
  useEffect(() => {
    const tabKey = pathname ? getContainerTabFromPath(pathname, projectId) : null;
    if (tabKey) rememberContainerTab(projectId, tabKey);
  }, [pathname, projectId]);

  return (
    <>
      {projectPreferences.navigationMode === "TABBED" && (
        <div className="z-20">
          <Row className="flex h-header w-full items-center gap-2 border-b border-subtle bg-surface-1">
            <div className="flex h-full w-full items-center gap-2 divide-x divide-subtle">
              <div className="flex size-full min-w-0 flex-1 items-center gap-2">
                {sidebarCollapsed && (
                  <div className="shrink-0">
                    <AppSidebarToggleButton />
                  </div>
                )}
                <Header className={cn("h-full min-w-0 shrink", { "pl-1.5": !sidebarCollapsed })}>
                  <Header.LeftItem className="flex h-full max-w-full items-center gap-2">
                    <TabNavigationRoot workspaceSlug={workspaceSlug} projectId={projectId} />
                  </Header.LeftItem>
                </Header>
              </div>
            </div>
          </Row>
        </div>
      )}
      <ProjectAuthWrapper workspaceSlug={workspaceSlug} projectId={projectId}>
        <Outlet />
      </ProjectAuthWrapper>
    </>
  );
}

export default observer(ProjectLayout);
