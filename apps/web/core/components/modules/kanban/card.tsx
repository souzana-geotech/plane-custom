/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { preserveOffsetOnSource } from "@atlaskit/pragmatic-drag-and-drop/element/preserve-offset-on-source";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarOutline, UserAltOutline, WorkItemsOutline } from "@makeplane/propel/icons";
import { LinearProgress } from "@makeplane/propel/components/linear-progress";
import { cn, renderFormattedDate } from "@plane/utils";
// components
import { ButtonAvatars } from "@/components/dropdowns/member/avatar";
import { ModuleQuickActions } from "@/components/modules/quick-actions";
// hooks
import { useModule } from "@/hooks/store/use-module";

export const MODULE_KANBAN_DRAG_TYPE = "MODULE_KANBAN_CARD";
export const MODULE_KANBAN_CARD_TARGET = "MODULE_KANBAN_CARD_TARGET";

type Props = {
  moduleId: string;
  isDragAllowed: boolean;
  /** true when the page is in manual order, so a card can be dropped above or below another */
  isReorderAllowed: boolean;
};

export const ModuleKanbanCard = observer(function ModuleKanbanCard(props: Props) {
  const { moduleId, isDragAllowed, isReorderAllowed } = props;
  // refs
  const cardRef = useRef<HTMLAnchorElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // router
  const { workspaceSlug, projectId } = useParams();
  // states
  const [isDragging, setIsDragging] = useState(false);
  const [dropEdge, setDropEdge] = useState<"top" | "bottom" | null>(null);
  // store hooks
  const { getModuleById } = useModule();
  // derived values
  const moduleDetails = getModuleById(moduleId);
  const status = moduleDetails?.status;
  const hasModule = !!moduleDetails;

  useEffect(() => {
    const element = cardRef.current;
    const wrapper = wrapperRef.current;
    if (!element || !wrapper) return;

    const readEdge = (data: Record<string | symbol, unknown>) => {
      const edge = extractClosestEdge(data);
      return edge === "top" || edge === "bottom" ? edge : null;
    };

    return combine(
      dropTargetForElements({
        element: wrapper,
        canDrop: ({ source }) =>
          isReorderAllowed && source.data.type === MODULE_KANBAN_DRAG_TYPE && source.data.id !== moduleId,
        getData: ({ input, element: target }) =>
          attachClosestEdge(
            { id: moduleId, type: MODULE_KANBAN_CARD_TARGET },
            { input, element: target, allowedEdges: ["top", "bottom"] }
          ),
        onDragEnter: ({ self }) => setDropEdge(readEdge(self.data)),
        onDrag: ({ self }) => setDropEdge(readEdge(self.data)),
        onDragLeave: () => setDropEdge(null),
        onDrop: () => setDropEdge(null),
      }),
      draggable({
        element,
        canDrag: () => isDragAllowed,
        getInitialData: () => ({ id: moduleId, status, type: MODULE_KANBAN_DRAG_TYPE }),
        // the browser's own snapshot of a link inside a scrolling board captures the page around it,
        // so hand it a copy of just this card
        onGenerateDragPreview: ({ nativeSetDragImage, location }) => {
          setCustomNativeDragPreview({
            nativeSetDragImage,
            getOffset: preserveOffsetOnSource({ element, input: location.current.input }),
            render: ({ container }) => {
              const preview = element.cloneNode(true) as HTMLElement;
              preview.style.width = `${element.getBoundingClientRect().width}px`;
              container.appendChild(preview);
            },
          });
        },
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      })
    );
  }, [moduleId, status, isDragAllowed, isReorderAllowed, hasModule]);

  if (!moduleDetails) return null;

  const totalTasks =
    moduleDetails.backlog_issues +
    moduleDetails.unstarted_issues +
    moduleDetails.started_issues +
    moduleDetails.completed_issues +
    moduleDetails.cancelled_issues;
  const completedTasks = moduleDetails.completed_issues;
  const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
  const title = moduleDetails.module_code ? `${moduleDetails.module_code} | ${moduleDetails.name}` : moduleDetails.name;
  const startDate = renderFormattedDate(moduleDetails.start_date);
  const endDate = renderFormattedDate(moduleDetails.target_date);

  return (
    <div ref={wrapperRef} className="relative" data-prevent-progress>
      {dropEdge && (
        <div
          className={cn("pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-accent-primary", {
            "-top-[5px]": dropEdge === "top",
            "-bottom-[5px]": dropEdge === "bottom",
          })}
        />
      )}
      <Link
        ref={cardRef}
        href={`/${workspaceSlug}/projects/${moduleDetails.project_id}/modules/${moduleDetails.id}`}
        className={cn(
          "flex w-full flex-col gap-2.5 rounded-lg border border-subtle bg-layer-2 p-3 shadow-raised-100 transition-all hover:border-strong hover:shadow-raised-200",
          { "opacity-50": isDragging }
        )}
      >
        <span className="line-clamp-2 pr-6 text-13 font-medium break-words text-primary" title={title}>
          {title}
        </span>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <WorkItemsOutline className="size-3.5 flex-shrink-0 text-tertiary" />
            <span className="text-11 text-tertiary">
              {completedTasks}/{totalTasks} tasks
            </span>
          </div>
          {moduleDetails.lead_id ? (
            <ButtonAvatars showTooltip={false} userIds={moduleDetails.lead_id} />
          ) : (
            <UserAltOutline className="size-3.5 flex-shrink-0 text-tertiary" />
          )}
        </div>
        <LinearProgress
          value={progress}
          size="md"
          variant="brand"
          showValue={false}
          aria-label="Project / Job progress"
        />
        {(startDate || endDate) && (
          <div className="flex items-center gap-1.5 text-11 text-tertiary">
            <CalendarOutline className="size-3 flex-shrink-0" />
            <span className="truncate">
              {startDate || "No start date"} → {endDate || "No end date"}
            </span>
          </div>
        )}
      </Link>
      {workspaceSlug && projectId && (
        <div className="absolute top-2 right-1.5">
          <ModuleQuickActions
            parentRef={wrapperRef}
            moduleId={moduleId}
            projectId={projectId.toString()}
            workspaceSlug={workspaceSlug.toString()}
          />
        </div>
      )}
    </div>
  );
});
