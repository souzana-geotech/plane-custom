/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef } from "react";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IModule } from "@plane/types";
import { getModuleSortOrderOnDrop, groupModulesByState } from "@plane/utils";
// hooks
import { useModule } from "@/hooks/store/use-module";
import { useModuleFilter } from "@/hooks/store/use-module-filter";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { ModuleKanbanColumn } from "./column";
import type { TModuleKanbanDropTarget } from "./column";

type Props = {
  moduleIds: string[];
};

/**
 * Projects / Jobs as one column per container state (the same states as the container's tasks, in the
 * order set on the States settings page). Dragging a card to another column changes its state;
 * the order inside a column follows the page's "order by" choice. In manual order a card can also be
 * dropped above or below another one, which rewrites the same sort order the timeline uses.
 */
export const ModulesKanbanView = observer(function ModulesKanbanView(props: Props) {
  const { moduleIds } = props;
  // refs
  const boardRef = useRef<HTMLDivElement | null>(null);
  // router
  const { workspaceSlug, projectId } = useParams();
  // store hooks
  const { getModuleById, getProjectModuleIds, updateModuleDetails } = useModule();
  const { allowPermissions } = useUserPermissions();
  const { currentProjectDisplayFilters: displayFilters } = useModuleFilter();
  const { getProjectStates } = useProjectState();
  // derived values
  const isDragAllowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );
  const modules = moduleIds.map((id) => getModuleById(id)).filter((m): m is IModule => !!m);
  const states = getProjectStates(projectId?.toString()) ?? [];
  const grouped = groupModulesByState(
    modules,
    states.map((state) => state.id)
  );
  const isReorderAllowed = isDragAllowed && displayFilters?.order_by === "sort_order";
  // the drop handler reads the columns as they are at drop time without being rebuilt on every render
  const groupedRef = useRef(grouped);
  groupedRef.current = grouped;

  useEffect(() => {
    const element = boardRef.current;
    if (!element) return;
    return autoScrollForElements({ element });
  }, []);

  const handleMove = useCallback(
    (moduleId: string, stateId: string, target: TModuleKanbanDropTarget | undefined) => {
      if (!workspaceSlug || !projectId) return;
      const payload: Partial<IModule> = {};
      if (getModuleById(moduleId)?.state_id !== stateId) payload.state_id = stateId;
      if (isReorderAllowed) {
        // the manual order is shared by every column, including Jobs hidden by a filter
        const otherSortOrders = (getProjectModuleIds(projectId.toString()) ?? [])
          .filter((id) => id !== moduleId)
          .map((id) => getModuleById(id)?.sort_order)
          .filter((order): order is number => typeof order === "number");
        const sortOrder = getModuleSortOrderOnDrop(
          groupedRef.current[stateId] ?? [],
          moduleId,
          target?.id,
          target?.edge,
          otherSortOrders
        );
        if (sortOrder !== undefined) payload.sort_order = sortOrder;
      }
      if (Object.keys(payload).length === 0) return;

      updateModuleDetails(workspaceSlug.toString(), projectId.toString(), moduleId, payload).catch(
        (err: { detail?: string } | undefined) => {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: "Error!",
            message: err?.detail ?? "Project / Job could not be moved. Please try again.",
          });
        }
      );
    },
    [workspaceSlug, projectId, isReorderAllowed, getModuleById, getProjectModuleIds, updateModuleDetails]
  );

  return (
    <div
      ref={boardRef}
      className="horizontal-scrollbar scrollbar-lg flex size-full gap-3 overflow-x-auto px-page-x py-page-y"
    >
      {states.map((state) => (
        <ModuleKanbanColumn
          key={state.id}
          state={state}
          moduleIds={(grouped[state.id] ?? []).map((m) => m.id)}
          isDragAllowed={isDragAllowed}
          isReorderAllowed={isReorderAllowed}
          onMove={handleMove}
        />
      ))}
    </div>
  );
});
