/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { observer } from "mobx-react";
import { StateGroupIcon } from "@plane/propel/icons";
import type { IState } from "@plane/types";
import { cn } from "@plane/utils";
// local imports
import { MODULE_KANBAN_CARD_TARGET, MODULE_KANBAN_DRAG_TYPE, ModuleKanbanCard } from "./card";

export type TModuleKanbanDropTarget = { id: string; edge: "top" | "bottom" };

type Props = {
  state: IState;
  moduleIds: string[];
  isDragAllowed: boolean;
  isReorderAllowed: boolean;
  onMove: (moduleId: string, stateId: string, target: TModuleKanbanDropTarget | undefined) => void;
};

export const ModuleKanbanColumn = observer(function ModuleKanbanColumn(props: Props) {
  const { state, moduleIds, isDragAllowed, isReorderAllowed, onMove } = props;
  const stateId = state.id;
  // refs
  const columnRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // states
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  useEffect(() => {
    const column = columnRef.current;
    const list = listRef.current;
    if (!column || !list) return;

    return combine(
      dropTargetForElements({
        element: column,
        // outside manual order, a card dropped back on its own column is not a move
        canDrop: ({ source }) =>
          source.data.type === MODULE_KANBAN_DRAG_TYPE && (isReorderAllowed || source.data.stateId !== stateId),
        getData: () => ({ stateId }),
        onDragEnter: () => setIsDraggingOver(true),
        onDragLeave: () => setIsDraggingOver(false),
        onDrop: ({ source, location }) => {
          setIsDraggingOver(false);
          const moduleId = source.data.id;
          if (typeof moduleId !== "string") return;
          // the innermost target is the card under the pointer, when there is one
          const inner = location.current.dropTargets[0];
          const edge = inner ? extractClosestEdge(inner.data) : null;
          const target =
            inner?.data.type === MODULE_KANBAN_CARD_TARGET &&
            typeof inner.data.id === "string" &&
            (edge === "top" || edge === "bottom")
              ? { id: inner.data.id, edge }
              : undefined;
          onMove(moduleId, stateId, target);
        },
      }),
      autoScrollForElements({ element: list })
    );
  }, [stateId, isReorderAllowed, onMove]);

  return (
    <div
      ref={columnRef}
      className={cn(
        "flex h-full w-[300px] flex-shrink-0 flex-col rounded-lg border border-transparent bg-layer-1 transition-colors",
        { "border-accent-strong": isDraggingOver }
      )}
    >
      <div className="flex flex-shrink-0 items-center gap-2 px-3 py-2.5">
        <StateGroupIcon stateGroup={state.group} color={state.color} />
        <span className="truncate text-13 font-medium text-primary">{state.name}</span>
        <span className="text-13 text-tertiary">{moduleIds.length}</span>
      </div>
      <div
        ref={listRef}
        className="vertical-scrollbar scrollbar-sm flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
      >
        {moduleIds.map((moduleId) => (
          <ModuleKanbanCard
            key={moduleId}
            moduleId={moduleId}
            isDragAllowed={isDragAllowed}
            isReorderAllowed={isReorderAllowed}
          />
        ))}
      </div>
    </div>
  );
});
