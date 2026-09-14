/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachInstruction, extractInstruction } from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { ChevronRightOutline } from "@makeplane/propel/icons";
// plane imports
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayProperties, TIssue, TWbsMoveInstruction } from "@plane/types";
import { ControlLink, DropIndicator, Row } from "@plane/ui";
import { cn, generateWorkItemLink } from "@plane/utils";
// components
import { IssueIdentifier } from "@/components/issues/issue-detail/issue-identifier";
import { IssueProperties } from "@/components/issues/issue-layouts/properties";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { usePlatformOS } from "@/hooks/use-platform-os";
// local imports
import type { TRenderQuickActions } from "../list/list-view-types";
import { WBS_CODE_MIN_WIDTH, WBS_INDENT_PER_DEPTH, WBS_MAX_VISUAL_INDENT_DEPTH } from "./constants";

type Props = {
  issueId: string;
  /** derived WBS code, e.g. "1.2.3" — presentation only, never persisted */
  code: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  /** dotted codes of this row's ancestors, nearest-last, for the deep-node hint */
  ancestorPath: string[];
  /** whether this row is the last visible row of the tree (drop hitbox mode) */
  isLastRow: boolean;
  /** structural editing enabled — false while filters are active or the tree is truncated */
  canDrag: boolean;
  /** whether the given dragged row may be dropped on this row (self/descendant guard) */
  canDropFromSource: (sourceId: string, targetId: string) => boolean;
  /** apply a planned move — above / below / inside this row */
  onMove: (sourceId: string, targetId: string, instruction: TWbsMoveInstruction) => void;
  onToggleExpanded: (issueId: string) => void;
  displayProperties: IIssueDisplayProperties | undefined;
  canEditProperties: (projectId: string | undefined) => boolean;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
};

const WBS_DRAG_TYPE = "WBS_ISSUE";

/** the three drop intentions the tree-item hitbox can report for a row */
const WBS_INSTRUCTIONS: TWbsMoveInstruction[] = ["reorder-above", "reorder-below", "make-child"];

const isWbsInstruction = (value: string | undefined): value is TWbsMoveInstruction =>
  !!value && (WBS_INSTRUCTIONS as string[]).includes(value);

/**
 * A single row of the WBS tree.
 *
 * The tree is rendered as a flat list — depth becomes left padding rather than
 * nested DOM — so hierarchy depth is unbounded without deepening the markup.
 *
 * Everything to the right of the title reuses the shared `IssueProperties`
 * component, so state, priority, assignees, dates, labels, cycle, module and
 * estimate behave exactly as they do in the List and Table layouts.
 */
export const WbsRow = observer(function WbsRow(props: Props) {
  const {
    issueId,
    code,
    depth,
    hasChildren,
    isExpanded,
    ancestorPath,
    isLastRow,
    canDrag,
    canDropFromSource,
    onMove,
    onToggleExpanded,
    displayProperties,
    canEditProperties,
    updateIssue,
    quickActions,
  } = props;
  // refs
  const rowRef = useRef<HTMLDivElement | null>(null);
  // drag-and-drop state
  const [dropInstruction, setDropInstruction] = useState<TWbsMoveInstruction | undefined>(undefined);
  const [isBeingDragged, setIsBeingDragged] = useState(false);
  // router
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  // i18n
  const { t } = useTranslation();
  // store hooks
  const { getProjectIdentifierById } = useProject();
  const { getIsIssuePeeked, setPeekIssue, issue: issueStore } = useIssueDetail();
  const { isMobile } = usePlatformOS();

  // derived values
  const issue = issueStore.getIssueById(issueId);

  // Drag-and-drop: the row is draggable and a tree-item drop target. The
  // hitbox reports one of three intentions — above / below / make child —
  // which the layout root turns into a single parent_id + sort_order mutation
  // through Plane's existing optimistic update path.
  useEffect(() => {
    const element = rowRef.current;
    if (!element || !canDrag) return;

    return combine(
      draggable({
        element,
        canDrag: () => canDrag,
        getInitialData: () => ({ id: issueId, type: WBS_DRAG_TYPE }),
        onDragStart: () => setIsBeingDragged(true),
        onDrop: () => setIsBeingDragged(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          source?.data?.type === WBS_DRAG_TYPE && canDropFromSource(source?.data?.id as string, issueId),
        getData: ({ input, element: targetElement }) =>
          attachInstruction(
            { id: issueId, type: WBS_DRAG_TYPE },
            {
              input,
              element: targetElement,
              currentLevel: depth,
              indentPerLevel: WBS_INDENT_PER_DEPTH,
              // an expanded parent's lower half means "into", the very last row
              // additionally exposes "below" so items can be dropped at the end
              mode: isExpanded && hasChildren ? "expanded" : isLastRow ? "last-in-group" : "standard",
            }
          ),
        onDrag: ({ self }) => {
          const instruction = extractInstruction(self?.data)?.type;
          setDropInstruction(isWbsInstruction(instruction) ? instruction : undefined);
        },
        onDragLeave: () => setDropInstruction(undefined),
        onDrop: ({ self, source }) => {
          setDropInstruction(undefined);
          const instruction = extractInstruction(self?.data)?.type;
          const sourceId = source?.data?.id;
          if (typeof sourceId !== "string" || !isWbsInstruction(instruction)) return;
          onMove(sourceId, issueId, instruction);
        },
      })
    );
  }, [canDrag, canDropFromSource, depth, hasChildren, isExpanded, isLastRow, issueId, onMove]);

  if (!issue) return null;

  const projectIdentifier = getProjectIdentifierById(issue.project_id);
  const canEditIssueProperties = canEditProperties(issue.project_id ?? undefined);

  // Indentation stops growing past a certain depth so very deep trees stay
  // readable; the WBS code itself keeps the full hierarchy unambiguous.
  const indent = Math.min(depth, WBS_MAX_VISUAL_INDENT_DEPTH) * WBS_INDENT_PER_DEPTH;

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: issue.project_id,
    issueId: issue.id,
    projectIdentifier,
    sequenceId: issue.sequence_id,
    isArchived: !!issue.archived_at,
  });

  // Opens the existing peek overview — the WBS view never introduces a second
  // work item detail surface.
  const handlePeekOverview = () => {
    if (!workspaceSlug || !issue.project_id || getIsIssuePeeked(issue.id)) return;
    setPeekIssue({
      workspaceSlug,
      projectId: issue.project_id,
      issueId: issue.id,
      nestingLevel: depth,
      isArchived: !!issue.archived_at,
    });
  };

  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onToggleExpanded(issueId);
  };

  const codeTooltip = ancestorPath.length > 0 ? `${ancestorPath.join(" › ")} › ${code}` : t("issue.layouts.wbs_number");

  return (
    <ControlLink
      id={`wbs-issue-${issue.id}`}
      href={workItemLink}
      onClick={handlePeekOverview}
      className="w-full cursor-pointer"
      disabled={!!issue.tempId || issue.is_draft}
    >
      <Row
        ref={rowRef}
        className={cn(
          // narrow viewports stack the property chips under the title, exactly
          // like the list layout, so chips never overlap the WBS code and name
          "group/wbs-row relative flex min-h-11 flex-col gap-2 border-b border-subtle bg-layer-transparent py-2 text-13 transition-colors hover:bg-layer-transparent-hover md:flex-row md:items-center",
          {
            "border-accent-strong": getIsIssuePeeked(issue.id),
            // the row being dragged fades; a "make child" target highlights whole
            "opacity-50": isBeingDragged,
            "bg-accent-subtle": dropInstruction === "make-child",
          }
        )}
      >
        <DropIndicator
          classNames="absolute top-0 right-0 left-0 z-[2]"
          isVisible={dropInstruction === "reorder-above"}
        />
        <DropIndicator
          classNames="absolute -bottom-[1px] right-0 left-0 z-[2]"
          isVisible={dropInstruction === "reorder-below"}
        />
        <div className="flex min-w-0 flex-grow items-center gap-2" style={{ paddingLeft: `${indent}px` }}>
          {/* expand / collapse — visibility only, never changes the hierarchy */}
          <div className="grid size-4 flex-shrink-0 place-items-center">
            {hasChildren && (
              <button
                type="button"
                aria-label={isExpanded ? t("common.collapse") : t("common.expand")}
                aria-expanded={isExpanded}
                className="grid size-4 place-items-center rounded-xs text-placeholder hover:text-tertiary"
                onClick={handleToggle}
              >
                <ChevronRightOutline className={cn("size-4 transition-transform", { "rotate-90": isExpanded })} />
              </button>
            )}
          </div>

          {/* derived WBS number — sits alongside, never replaces, the work item identifier */}
          <Tooltip label={codeTooltip} layout="stacked" disabled={isMobile}>
            <span
              className="flex-shrink-0 text-13 font-medium text-tertiary tabular-nums"
              style={{ minWidth: `${WBS_CODE_MIN_WIDTH}px` }}
            >
              {code}
            </span>
          </Tooltip>

          {/* the canonical Plane identifier, e.g. PROJ-125 */}
          {displayProperties?.key && issue.project_id && (
            <div className="flex-shrink-0">
              <IssueIdentifier
                issueId={issueId}
                projectId={issue.project_id}
                size="xs"
                variant="tertiary"
                displayProperties={displayProperties}
              />
            </div>
          )}

          <Tooltip label={issue.name} layout="stacked" align="start" disabled={isMobile}>
            <p className="truncate text-body-xs-medium text-primary">{issue.name}</p>
          </Tooltip>
        </div>

        <div
          role="presentation"
          className="flex flex-shrink-0 items-center gap-2"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <IssueProperties
            className="relative flex flex-wrap items-center gap-2 whitespace-nowrap"
            issue={issue}
            isReadOnly={!canEditIssueProperties}
            updateIssue={updateIssue}
            displayProperties={displayProperties}
            activeLayout="WBS"
          />
          <div className="block rounded-sm border border-strong">{quickActions({ issue, parentRef: rowRef })}</div>
        </div>
      </Row>
    </ControlLink>
  );
});
