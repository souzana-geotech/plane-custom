/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { getDate, renderFormattedPayloadDate } from "./datetime";
import { getWorkingDaysDelta, shiftByWorkingDays } from "./working-days";

/**
 * Pure dependency auto-shift engine, mirroring the backend
 * `plane.bgtasks.dependency_auto_shift_task` semantics so live (in-browser) shifts
 * and the persisted backend shifts always agree:
 *
 * - a dependent is anchored to its *latest required date* — the latest target date
 *   across all of its `blocked_by` blockers — and shifts by exactly the working-day
 *   change of that requirement (planned slack is preserved, in both directions);
 * - shifts are measured and applied in working days (Monday-Saturday; Sunday is
 *   excluded), preserving each task's working-day duration;
 * - the shift propagates through the whole chain in one topologically-ordered pass;
 *   every node is visited at most once and dependency cycles are detected and left
 *   untouched, so no input can loop.
 */

/** dates a node carries; payload format (`yyyy-mm-dd`) or null */
export type TDependencyShiftNode = {
  start_date: string | null | undefined;
  target_date: string | null | undefined;
};

/** shifted dates for one dependent, in payload format */
export type TDependencyShiftUpdate = {
  start_date: string | null;
  target_date: string | null;
};

export type TDependencyShiftArgs = {
  /** the task being moved */
  movedId: string;
  /** its target date before the move */
  oldTargetDate: string | Date | null | undefined;
  /** its target date after the move */
  newTargetDate: string | Date | null | undefined;
  /** dates of any node in the graph (moved task, dependents, blockers) */
  getNode: (id: string) => TDependencyShiftNode | undefined;
  /** ids of tasks directly blocked by the given task (`blocking` edges) */
  getDependentIds: (id: string) => string[];
  /** ids of tasks the given task is blocked by (`blocked_by` edges) */
  getBlockerIds: (id: string) => string[];
  /** optional gate; return false to keep a dependent (e.g. completed work) in place */
  isShiftable?: (id: string) => boolean;
};

/** safety cap on the traversal, matching the backend's bounded pass */
const MAX_AFFECTED_NODES = 500;

const toTime = (value: Date | string | null | undefined): number | undefined => {
  const parsed = getDate(value ?? undefined);
  return parsed && !isNaN(parsed.getTime()) ? parsed.getTime() : undefined;
};

/** every transitive dependent of the seed, bounded and cycle-safe */
const downstreamClosure = (seedId: string, getDependentIds: (id: string) => string[]): Set<string> => {
  const affected = new Set<string>([seedId]);
  let frontier = [seedId];
  while (frontier.length > 0 && affected.size < MAX_AFFECTED_NODES) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const dependentId of getDependentIds(id)) {
        if (affected.has(dependentId) || affected.size >= MAX_AFFECTED_NODES) continue;
        affected.add(dependentId);
        next.push(dependentId);
      }
    }
    frontier = next;
  }
  return affected;
};

/** Kahn's algorithm; nodes stuck in a cycle are omitted from the order */
const topologicalOrder = (affected: Set<string>, getBlockerIds: (id: string) => string[]): string[] => {
  const inSetBlockers = new Map<string, string[]>();
  const dependentsOf = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const id of affected) {
    const blockers = getBlockerIds(id).filter((blockerId) => affected.has(blockerId));
    inSetBlockers.set(id, blockers);
    inDegree.set(id, blockers.length);
    for (const blockerId of blockers) {
      const bucket = dependentsOf.get(blockerId);
      if (bucket) bucket.push(id);
      else dependentsOf.set(blockerId, [id]);
    }
  }

  const queue = [...affected].filter((id) => inDegree.get(id) === 0);
  const ordered: string[] = [];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    ordered.push(current);
    for (const dependentId of dependentsOf.get(current) ?? []) {
      const degree = (inDegree.get(dependentId) ?? 0) - 1;
      inDegree.set(dependentId, degree);
      if (degree === 0) queue.push(dependentId);
    }
  }
  return ordered;
};

/**
 * @returns a map of dependent id -> shifted dates (payload format). The moved task
 * itself is never in the result; an empty map means nothing needs to move.
 */
export const computeDependencyShifts = (args: TDependencyShiftArgs): Map<string, TDependencyShiftUpdate> => {
  const { movedId, oldTargetDate, newTargetDate, getNode, getDependentIds, getBlockerIds, isShiftable } = args;
  const result = new Map<string, TDependencyShiftUpdate>();

  const movedOldTarget = toTime(oldTargetDate);
  const movedNewTarget = toTime(newTargetDate);
  if (movedOldTarget === undefined || movedNewTarget === undefined || movedOldTarget === movedNewTarget) return result;

  const affected = downstreamClosure(movedId, getDependentIds);
  const ordered = topologicalOrder(affected, getBlockerIds);

  // target times before/after the pass, per node; untouched blockers contribute
  // their current value on both sides
  const oldTargets = new Map<string, number>([[movedId, movedOldTarget]]);
  const newTargets = new Map<string, number>([[movedId, movedNewTarget]]);

  const requirement = (id: string, values: Map<string, number>): number | undefined => {
    let latest: number | undefined;
    for (const blockerId of getBlockerIds(id)) {
      const value = values.get(blockerId) ?? toTime(getNode(blockerId)?.target_date);
      if (value !== undefined && (latest === undefined || value > latest)) latest = value;
    }
    return latest;
  };

  for (const id of ordered) {
    if (id === movedId) continue;
    if (isShiftable && !isShiftable(id)) continue;
    const node = getNode(id);
    if (!node || (!node.start_date && !node.target_date)) continue;

    const oldRequirement = requirement(id, oldTargets);
    const newRequirement = requirement(id, newTargets);
    if (oldRequirement === undefined || newRequirement === undefined) continue;
    const delta = getWorkingDaysDelta(new Date(oldRequirement), new Date(newRequirement));
    if (!delta) continue;

    const newStart = node.start_date ? shiftByWorkingDays(node.start_date, delta) : undefined;
    const newTarget = node.target_date ? shiftByWorkingDays(node.target_date, delta) : undefined;
    if (node.target_date) {
      const oldTargetTime = toTime(node.target_date);
      const newTargetTime = newTarget?.getTime();
      if (oldTargetTime !== undefined) oldTargets.set(id, oldTargetTime);
      if (newTargetTime !== undefined) newTargets.set(id, newTargetTime);
    }

    result.set(id, {
      start_date: newStart ? (renderFormattedPayloadDate(newStart) ?? null) : null,
      target_date: newTarget ? (renderFormattedPayloadDate(newTarget) ?? null) : null,
    });
  }

  return result;
};
