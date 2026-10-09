/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane types
import type { IWorkspace } from "@plane/types";
import { Spinner } from "@plane/ui";
// components
import { PowerKWorkspacesMenu } from "@/components/power-k/menus/workspaces";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";

type Props = {
  handleSelect: (workspace: IWorkspace) => void;
};

export const PowerKOpenWorkspaceMenu = observer(function PowerKOpenWorkspaceMenu(props: Props) {
  const { handleSelect } = props;
  // store hooks
  const { loader, workspaces } = useWorkspace();
  // derived values
  // Geotech3D: the shared My Space workspace is not one of the user's workspaces to switch to.
  const workspacesList = workspaces ? Object.values(workspaces).filter((workspace) => !workspace.is_my_space) : [];

  if (loader) return <Spinner />;

  return <PowerKWorkspacesMenu workspaces={workspacesList} onSelect={handleSelect} />;
});
