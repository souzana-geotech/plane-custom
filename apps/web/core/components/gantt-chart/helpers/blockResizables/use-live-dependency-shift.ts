/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef } from "react";
// plane imports
import type { IBlockUpdateDependencyData, IGanttBlock } from "@plane/types";
import { computeDependencyShifts } from "@plane/utils";
import type { TDependencyShiftUpdate } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";

type TDragSnapshot = {
  /** original positions of dependents we moved, for restoring when a shift returns to zero */
  originalPositions: Map<string, { marginLeft: number; width: number }>;
  /** dependents currently drawn at a shifted position */
  shifted: Set<string>;
};

/**
 * Live dependency auto-shift for gantt drags.
 *
 * While a bar is being moved (or right-resized), every `blocked_by` dependent —
 * through the whole chain — is repositioned instantly in the local timeline store
 * using the same working-day engine the backend applies (`computeDependencyShifts`),
 * with no network round-trip. On drop, the computed dependent dates are returned so
 * they persist in the same bulk request as the dragged block; those updates carry
 * the `dependency_auto_shift` marker, which tells the backend auto-shift to stand
 * down and prevents double shifting. When no dependent was shifted locally (e.g.
 * relations not loaded), nothing is marked and the backend auto-shift still acts
 * as the safety layer.
 *
 * Everything here is additive: with no `blocked_by` dependents the hook computes an
 * empty shift set and the drag behaves exactly as before.
 */
export const useLiveDependencyShift = (block: IGanttBlock) => {
  // store hooks
  const { currentViewData, getBlockById, updateBlockPosition, getPositionFromDateOnGantt, getDateFromPositionOnGantt } =
    useTimeLineChartStore();
  const {
    relation: { getRelationByIssueIdRelationType },
  } = useIssueDetail();
  const { getStateById } = useProjectState();
  // refs
  const snapshotRef = useRef<TDragSnapshot | null>(null);

  const getDependentIds = (id: string): string[] => getRelationByIssueIdRelationType(id, "blocking") ?? [];
  const getBlockerIds = (id: string): string[] => getRelationByIssueIdRelationType(id, "blocked_by") ?? [];
  const getNode = (id: string) => {
    const nodeBlock = getBlockById(id);
    if (!nodeBlock) return undefined;
    return { start_date: nodeBlock.start_date ?? null, target_date: nodeBlock.target_date ?? null };
  };
  const isShiftable = (id: string): boolean => {
    const data = getBlockById(id)?.data;
    if (!data) return false;
    const stateGroup = getStateById(data.state_id)?.group;
    return stateGroup !== "completed" && stateGroup !== "cancelled";
  };

  /** dependent shifts for the dragged block's tentative target date */
  const computeShifts = (tentativeTargetDate: Date) =>
    computeDependencyShifts({
      movedId: block.id,
      // block dates are not mutated during a drag, so this stays the pre-drag value
      oldTargetDate: block.target_date,
      newTargetDate: tentativeTargetDate,
      getNode,
      getDependentIds,
      getBlockerIds,
      isShiftable,
    });

  /** the dragged block's tentative target date, derived from its live position */
  const tentativeTarget = (): Date | undefined => {
    const currBlock = getBlockById(block.id);
    if (!currBlock?.position || !currBlock.target_date) return undefined;
    return getDateFromPositionOnGantt(currBlock.position.marginLeft + currBlock.position.width, -1);
  };

  /** timeline position for a dependent's shifted dates */
  const positionFor = (
    dates: TDependencyShiftUpdate,
    fallback: { marginLeft: number; width: number }
  ): { marginLeft: number; width: number } | undefined => {
    if (!currentViewData) return undefined;
    const anchorDate = dates.start_date ?? dates.target_date;
    if (!anchorDate) return undefined;
    const marginLeft = getPositionFromDateOnGantt(anchorDate, 0);
    if (marginLeft === undefined) return undefined;
    // single-date blocks keep their default width, exactly like the initial layout
    if (!dates.start_date || !dates.target_date) return { marginLeft, width: fallback.width };
    const targetPosition = getPositionFromDateOnGantt(dates.target_date, 0);
    if (targetPosition === undefined) return undefined;
    return { marginLeft, width: targetPosition + currentViewData.data.dayWidth - marginLeft };
  };

  /** call on drag start; only target-affecting drags (move / right resize) shift dependents */
  const start = (dragDirection: "left" | "right" | "move") => {
    snapshotRef.current =
      dragDirection !== "left" && block.target_date ? { originalPositions: new Map(), shifted: new Set() } : null;
  };

  /** call after each live position update of the dragged block */
  const update = () => {
    const snapshot = snapshotRef.current;
    if (!snapshot) return;
    const target = tentativeTarget();
    if (!target) return;
    const shifts = computeShifts(target);

    for (const [id, dates] of shifts) {
      const dependentBlock = getBlockById(id);
      if (!dependentBlock?.position) continue;
      if (!snapshot.originalPositions.has(id)) snapshot.originalPositions.set(id, { ...dependentBlock.position });
      const desired = positionFor(dates, snapshot.originalPositions.get(id) ?? dependentBlock.position);
      if (!desired) continue;
      updateBlockPosition(
        id,
        desired.marginLeft - dependentBlock.position.marginLeft,
        desired.width - dependentBlock.position.width
      );
      snapshot.shifted.add(id);
    }

    // a dependent whose shift returned to zero snaps back to its original spot
    const returnedToOrigin: string[] = [];
    for (const id of snapshot.shifted) {
      if (shifts.has(id)) continue;
      const original = snapshot.originalPositions.get(id);
      const dependentBlock = getBlockById(id);
      if (original && dependentBlock?.position)
        updateBlockPosition(
          id,
          original.marginLeft - dependentBlock.position.marginLeft,
          original.width - dependentBlock.position.width
        );
      returnedToOrigin.push(id);
    }
    for (const id of returnedToOrigin) snapshot.shifted.delete(id);
  };

  /** call on drop; returns the dependent updates to persist alongside the dragged block */
  const drop = (): IBlockUpdateDependencyData[] => {
    const snapshot = snapshotRef.current;
    snapshotRef.current = null;
    if (!snapshot) return [];
    const target = tentativeTarget();
    if (!target) return [];
    return [...computeShifts(target)].map(([id, dates]) => ({
      id,
      start_date: dates.start_date ?? undefined,
      target_date: dates.target_date ?? undefined,
      meta: getBlockById(id)?.meta,
      dependency_auto_shift: true,
    }));
  };

  return { start, update, drop };
};
