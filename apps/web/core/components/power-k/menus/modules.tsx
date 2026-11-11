/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import { StateGroupIcon } from "@plane/propel/icons";
import type { IModule } from "@plane/types";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
// local imports
import { PowerKMenuBuilder } from "./builder";

type Props = {
  modules: IModule[];
  onSelect: (module: IModule) => void;
  value?: string[];
};

export const PowerKModulesMenu = observer(function PowerKModulesMenu({ modules, onSelect, value }: Props) {
  const { getStateById } = useProjectState();

  return (
    <PowerKMenuBuilder
      items={modules}
      getKey={(module) => module.id}
      getIconNode={(module) => {
        const state = getStateById(module.state_id);
        return (
          <StateGroupIcon stateGroup={state?.group ?? "backlog"} color={state?.color} className="size-3.5 shrink-0" />
        );
      }}
      getValue={(module) => module.name}
      getLabel={(module) => module.name}
      isSelected={(module) => !!value?.includes(module.id)}
      onSelect={onSelect}
      emptyText="No projects / jobs found"
    />
  );
});
