/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
// ui
import { StateGroupIcon } from "@plane/propel/icons";
import { Tooltip } from "@makeplane/propel/components/tooltip";
// components
import { SIDEBAR_WIDTH } from "@/components/gantt-chart/constants";
import { getBlockViewDetails } from "@/components/issues/issue-layouts/utils";
// constants
// hooks
import { useModule } from "@/hooks/store/use-module";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useAppRouter } from "@/hooks/use-app-router";
import { usePlatformOS } from "@/hooks/use-platform-os";

type Props = {
  moduleId: string;
};

export const ModuleGanttBlock = observer(function ModuleGanttBlock(props: Props) {
  const { moduleId } = props;
  // router
  const router = useAppRouter();
  const { workspaceSlug } = useParams();
  // store hooks
  const { getModuleById } = useModule();
  const { getStateById } = useProjectState();
  // derived values
  const moduleDetails = getModuleById(moduleId);
  // hooks
  const { isMobile } = usePlatformOS();

  const openModule = () =>
    router.push(`/${workspaceSlug?.toString()}/projects/${moduleDetails?.project_id}/modules/${moduleDetails?.id}`);

  // Geotech3D: the bar takes the colour of the Job's state, as set on the States page
  const { message, blockStyle } = getBlockViewDetails(
    moduleDetails,
    getStateById(moduleDetails?.state_id)?.color ?? ""
  );

  return (
    <Tooltip
      label={moduleDetails?.name ? `${moduleDetails.name}: ${message ?? ""}` : (message ?? "")}
      layout="stacked"
      align="start"
      disabled={isMobile}
    >
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- timeline bar, also the drag handle; the sidebar row is the keyboard link */}
      <div
        className="relative flex h-full w-full cursor-pointer items-center rounded-sm"
        style={blockStyle}
        onClick={openModule}
      >
        <div className="absolute top-0 left-0 h-full w-full bg-surface-1/50" />
        <div
          className="sticky w-auto truncate overflow-hidden px-2.5 py-1 text-13 text-primary"
          style={{ left: `${SIDEBAR_WIDTH}px` }}
        >
          {moduleDetails?.name}
        </div>
      </div>
    </Tooltip>
  );
});

export const ModuleGanttSidebarBlock = observer(function ModuleGanttSidebarBlock(props: Props) {
  const { moduleId } = props;
  const { workspaceSlug } = useParams();
  // store hooks
  const { getModuleById } = useModule();
  const { getStateById } = useProjectState();
  // derived values
  const moduleDetails = getModuleById(moduleId);
  const state = getStateById(moduleDetails?.state_id);

  return (
    <Link
      className="relative flex h-full w-full items-center gap-2"
      href={`/${workspaceSlug?.toString()}/projects/${moduleDetails?.project_id}/modules/${moduleDetails?.id}`}
      draggable={false}
    >
      <StateGroupIcon stateGroup={state?.group ?? "backlog"} color={state?.color} className="size-4 flex-shrink-0" />
      <h6 className="flex-grow truncate text-13 font-medium">{moduleDetails?.name}</h6>
    </Link>
  );
});
