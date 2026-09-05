/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane package imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EmptyStateDetailed } from "@plane/propel/empty-state";
import { cn } from "@plane/utils";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { WORKSPACE_DASHBOARD_WIDGETS } from "./widget-registry";

type Props = {
  workspaceSlug: string;
};

export const WorkspaceDashboardRoot = observer(function WorkspaceDashboardRoot(props: Props) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();
  // store hooks
  const { toggleCreateProjectModal } = useCommandPalette();
  const { workspaceProjectIds, loader } = useProject();
  const { allowPermissions } = useUserPermissions();

  // the analytics endpoints backing the widgets are admin/member only
  const canViewDashboard = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  if (!canViewDashboard) return <NotAuthorizedView />;

  if (workspaceProjectIds && workspaceProjectIds.length === 0 && loader !== "init-loader")
    return (
      <EmptyStateDetailed
        assetKey="project"
        title={t("workspace_projects.empty_state.no_projects.title")}
        description={t("workspace_projects.empty_state.no_projects.description")}
        actions={[
          {
            label: "Create a project",
            onClick: () => {
              toggleCreateProjectModal(true);
            },
          },
        ]}
      />
    );

  return (
    <div className="h-full w-full overflow-y-auto px-6 py-6 md:px-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {WORKSPACE_DASHBOARD_WIDGETS.map((widget) => {
          const WidgetComponent = widget.component;
          return (
            <div key={widget.key} className={cn(widget.fullWidth && "lg:col-span-2")}>
              <WidgetComponent workspaceSlug={workspaceSlug} />
            </div>
          );
        })}
      </div>
    </div>
  );
});
