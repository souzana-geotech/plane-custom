/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Command } from "cmdk";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import type { IModule, IState } from "@plane/types";
import { Spinner } from "@plane/ui";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
// local imports
import { PowerKProjectStatesMenuItems } from "../work-item/state-menu-item";

type Props = {
  handleSelect: (stateId: string) => void;
  moduleDetails: IModule;
};

/** Geotech3D: a Job's status is one of its container's task states. */
export const PowerKModuleStatusMenu = observer(function PowerKModuleStatusMenu(props: Props) {
  const { handleSelect, moduleDetails } = props;
  // router
  const { workspaceSlug } = useParams();
  // store hooks
  const { getProjectStateIds, getStateById } = useProjectState();
  // derived values
  const states = getProjectStateIds(moduleDetails.project_id)
    ?.map((stateId) => getStateById(stateId))
    .filter((state): state is IState => !!state);

  if (!states) return <Spinner />;

  return (
    <Command.Group>
      <PowerKProjectStatesMenuItems
        handleSelect={handleSelect}
        projectId={moduleDetails.project_id}
        selectedStateId={moduleDetails.state_id ?? undefined}
        states={states}
        workspaceSlug={workspaceSlug?.toString() ?? ""}
      />
    </Command.Group>
  );
});
