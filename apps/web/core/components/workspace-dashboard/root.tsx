/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { AlertTriangle, RefreshCw } from "lucide-react";
// plane package imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { EmptyStateDetailed } from "@plane/propel/empty-state";
import { cn } from "@plane/utils";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useProject } from "@/hooks/store/use-project";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { WorkspaceDashboardContext } from "./data/context";
import { useWorkspaceDashboardData } from "./data/use-workspace-dashboard-data";
import { WorkspaceDashboardFilters } from "./filters";
import { WORKSPACE_DASHBOARD_WIDGETS } from "./widget-registry";

type Props = {
  workspaceSlug: string;
};

const WorkspaceDashboardContent = observer(function WorkspaceDashboardContent(props: Props) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspace();
  const dashboard = useWorkspaceDashboardData(workspaceSlug);
  const { isLoading, error, retry, allModules, allWorkItems } = dashboard;
  const isEmpty = !isLoading && !error && allModules.length === 0 && allWorkItems.length === 0;

  return (
    <WorkspaceDashboardContext.Provider value={dashboard}>
      <div className="h-full w-full overflow-y-auto px-6 py-6 md:px-8">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
          <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="tracking-wider text-11 font-semibold text-tertiary uppercase">{currentWorkspace?.name}</p>
              <h1 className="text-20 font-semibold text-primary">{t("workspace_dashboard.title")}</h1>
              <p className="mt-1 text-13 text-tertiary">{t("workspace_dashboard.subtitle")}</p>
            </div>
            <WorkspaceDashboardFilters />
          </header>

          {error ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-danger-subtle bg-danger-subtle px-6 py-10 text-center">
              <AlertTriangle className="size-6 text-danger-primary" />
              <p className="text-14 font-medium text-primary">{t("workspace_dashboard.error.title")}</p>
              <p className="max-w-md text-13 text-secondary">{t("workspace_dashboard.error.description")}</p>
              <Button variant="secondary" size="sm" onClick={retry} prependIcon={<RefreshCw className="size-3.5" />}>
                {t("workspace_dashboard.error.retry")}
              </Button>
            </div>
          ) : isEmpty ? (
            <div className="rounded-lg border border-subtle bg-surface-1 px-6 py-10 text-center">
              <p className="text-14 font-medium text-primary">{t("workspace_dashboard.empty.title")}</p>
              <p className="mx-auto mt-1 max-w-lg text-13 text-secondary">
                {t("workspace_dashboard.empty.description")}
              </p>
            </div>
          ) : (
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
          )}

          <p className="text-11 text-tertiary">{t("workspace_dashboard.coverage_note")}</p>
        </div>
      </div>
    </WorkspaceDashboardContext.Provider>
  );
});

export const WorkspaceDashboardRoot = observer(function WorkspaceDashboardRoot(props: Props) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();
  // store hooks
  const { toggleCreateProjectModal } = useCommandPalette();
  const { workspaceProjectIds, loader } = useProject();
  const { allowPermissions } = useUserPermissions();

  // management view: workspace admins only
  const canViewDashboard = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);

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

  return <WorkspaceDashboardContent workspaceSlug={workspaceSlug} />;
});
