/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane package imports
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { WorkspaceDashboardRoot } from "@/components/workspace-dashboard";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";

function WorkspaceDashboardsPage() {
  const params = useParams();
  const workspaceSlug = params.workspaceSlug?.toString() ?? "";
  const { currentWorkspace } = useWorkspace();
  const { t } = useTranslation();
  // derived values
  const pageTitle = currentWorkspace?.name ? `${currentWorkspace?.name} - ${t("workspace_dashboards")}` : undefined;

  return (
    <>
      <PageHead title={pageTitle} />
      <WorkspaceDashboardRoot workspaceSlug={workspaceSlug} />
    </>
  );
}

export default observer(WorkspaceDashboardsPage);
