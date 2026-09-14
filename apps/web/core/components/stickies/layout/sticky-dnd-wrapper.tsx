/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import type {
  DropTargetRecord,
  DragLocationHistory,
} from "@atlaskit/pragmatic-drag-and-drop/dist/types/internal-types";
import type { ElementDragPayload } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { pointerOutsideOfPreview } from "@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { attachInstruction } from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";
import { observer } from "mobx-react";
import { usePathname } from "next/navigation";
import { createRoot } from "react-dom/client";
// plane types
import type { InstructionType } from "@plane/types";
import { DropIndicator } from "@plane/ui";
// components
import { StickyNote } from "../sticky";
// helpers
import { getInstructionFromPayload } from "./sticky.helpers";

type Props = {
  stickyId: string;
  workspaceSlug: string;
  isLastChild: boolean;
  handleDrop: (self: DropTargetRecord, source: ElementDragPayload, location: DragLocationHistory) => void;
};

export const StickyDNDWrapper = observer(function StickyDNDWrapper(props: Props) {
  const { stickyId, workspaceSlug, isLastChild, handleDrop } = props;
  // states
  const [isDragging, setIsDragging] = useState(false);
  const [instruction, setInstruction] = useState<InstructionType | undefined>(undefined);
  // refs
  const elementRef = useRef<HTMLDivElement>(null);
  // navigation
  const pathname = usePathname();

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const initialData = { id: stickyId, type: "sticky" };

    if (pathname.includes("stickies"))
      return combine(
        draggable({
          element,
          dragHandle: element,
          getInitialData: () => initialData,
          onDragStart: () => {
            setIsDragging(true);
          },
          onDrop: () => {
            setIsDragging(false);
          },
          onGenerateDragPreview: ({ nativeSetDragImage }) => {
            setCustomNativeDragPreview({
              getOffset: pointerOutsideOfPreview({ x: "-200px", y: "0px" }),
              render: ({ container }) => {
                const root = createRoot(container);
                root.render(
                  <div className="scale-50">
                    <div className="-m-2 max-h-[150px]">
                      <StickyNote
                        className={"w-[290px]"}
                        workspaceSlug={workspaceSlug.toString()}
                        stickyId={stickyId}
                        showToolbar={false}
                      />
                    </div>
                  </div>
                );
                return () => root.unmount();
              },
              nativeSetDragImage,
            });
          },
        }),
        dropTargetForElements({
          element,
          canDrop: ({ source }) => source.data?.type === "sticky",
          getData: ({ input, element: dropTargetElement }) => {
            const blockedStates: InstructionType[] = ["make-child"];
            if (!isLastChild) {
              blockedStates.push("reorder-below");
            }

            return attachInstruction(initialData, {
              input,
              element: dropTargetElement,
              currentLevel: 1,
              indentPerLevel: 0,
              mode: isLastChild ? "last-in-group" : "standard",
              block: blockedStates,
            });
          },
          onDrag: ({ self, source, location }) => {
            setInstruction(getInstructionFromPayload(self, source, location));
          },
          onDragLeave: () => {
            setInstruction(undefined);
          },
          onDrop: ({ self, source, location }) => {
            setInstruction(undefined);
            handleDrop(self, source, location);
          },
        })
      );
  }, [handleDrop, isDragging, isLastChild, pathname, stickyId, workspaceSlug]);

  return (
    <div
      ref={elementRef}
      className="box-border flex w-full flex-col p-[8px]"
      // A sticky must never be split down the middle by a column break.
      style={{ breakInside: "avoid" }}
    >
      <DropIndicator isVisible={instruction === "reorder-above"} />
      <StickyNote key={stickyId || "new"} workspaceSlug={workspaceSlug} stickyId={stickyId} />
      <DropIndicator isVisible={instruction === "reorder-below"} />
    </div>
  );
});
