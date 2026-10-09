/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import type { TIssueServiceType, TWorkItemWidgets } from "@plane/types";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local imports
import { IssueDetailWidgetActionButtons } from "./action-buttons";
import { IssueDetailWidgetCollapsibles } from "./issue-detail-widget-collapsibles";
import { IssueDetailWidgetModals } from "./issue-detail-widget-modals";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  renderWidgetModals?: boolean;
  issueServiceType: TIssueServiceType;
  hideWidgets?: TWorkItemWidgets[];
};

export const IssueDetailWidgets = observer(function IssueDetailWidgets(props: Props) {
  const {
    workspaceSlug,
    projectId,
    issueId,
    disabled,
    renderWidgetModals = true,
    issueServiceType,
    hideWidgets: hideWidgetsProp,
  } = props;
  const { getProjectById } = useProject();
  // Geotech3D: My Space tasks are personal to-dos; relations are a team tool.
  const hideWidgets: TWorkItemWidgets[] | undefined = getProjectById(projectId)?.is_personal
    ? [...(hideWidgetsProp ?? []), "relations"]
    : hideWidgetsProp;

  return (
    <>
      <div className="flex flex-col space-y-4">
        <IssueDetailWidgetActionButtons
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
          hideWidgets={hideWidgets}
        />
        <IssueDetailWidgetCollapsibles
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
          hideWidgets={hideWidgets}
        />
      </div>
      {renderWidgetModals && (
        <IssueDetailWidgetModals
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          issueServiceType={issueServiceType}
          hideWidgets={hideWidgets}
        />
      )}
    </>
  );
});
