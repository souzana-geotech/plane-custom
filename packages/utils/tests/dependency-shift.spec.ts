/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TDependencyShiftNode } from "../src/dependency-shift";
import { computeDependencyShifts } from "../src/dependency-shift";
import { getWorkingDaysDelta, shiftByWorkingDays } from "../src/working-days";

// September 2026: Sep 7 = Monday, Sep 12 = Saturday, Sep 13 = Sunday, Sep 14 = Monday.

/** tiny graph builder: nodes with dates plus dependent -> blockers edges */
const graph = (
  nodes: Record<string, { start?: string | null; target?: string | null }>,
  blockedBy: Record<string, string[]>
) => {
  const dependents: Record<string, string[]> = {};
  for (const [dependentId, blockerIds] of Object.entries(blockedBy)) {
    for (const blockerId of blockerIds) (dependents[blockerId] ??= []).push(dependentId);
  }
  return {
    getNode: (id: string): TDependencyShiftNode | undefined =>
      nodes[id] ? { start_date: nodes[id].start ?? null, target_date: nodes[id].target ?? null } : undefined,
    getDependentIds: (id: string) => dependents[id] ?? [],
    getBlockerIds: (id: string) => blockedBy[id] ?? [],
  };
};

describe("shiftByWorkingDays / getWorkingDaysDelta", () => {
  it("shifts across Sunday in both directions", () => {
    expect(shiftByWorkingDays("2026-09-11", 2)?.getDate()).toBe(14); // Fri -> Sat, [skip Sun], Mon
    expect(shiftByWorkingDays("2026-09-14", -2)?.getDate()).toBe(11); // Mon -> Sat, Fri
  });

  it("is the inverse of getWorkingDaysDelta", () => {
    for (let delta = -8; delta <= 8; delta++) {
      const shifted = shiftByWorkingDays("2026-09-07", delta);
      expect(getWorkingDaysDelta("2026-09-07", shifted)).toBe(delta);
    }
  });

  it("rolls a Sunday input forward to Monday", () => {
    expect(shiftByWorkingDays("2026-09-13", 0)?.getDate()).toBe(14);
  });
});

describe("computeDependencyShifts — live single dependency", () => {
  const { getNode, getDependentIds, getBlockerIds } = graph(
    {
      survey: { start: "2026-09-08", target: "2026-09-10" },
      processing: { start: "2026-09-11", target: "2026-09-12" },
    },
    { processing: ["survey"] }
  );

  it("shifts the dependent forward, skipping Sunday and preserving the working-day duration", () => {
    const shifts = computeDependencyShifts({
      movedId: "survey",
      oldTargetDate: "2026-09-10",
      newTargetDate: "2026-09-12", // +2 working days (Thu -> Sat)
      getNode,
      getDependentIds,
      getBlockerIds,
    });
    // Fri Sep 11 - Sat Sep 12 (2 working days) -> Mon Sep 14 - Tue Sep 15
    expect(shifts.get("processing")).toEqual({ start_date: "2026-09-14", target_date: "2026-09-15" });
  });

  it("shifts the dependent backward", () => {
    const shifts = computeDependencyShifts({
      movedId: "survey",
      oldTargetDate: "2026-09-10",
      newTargetDate: "2026-09-09",
      getNode,
      getDependentIds,
      getBlockerIds,
    });
    expect(shifts.get("processing")).toEqual({ start_date: "2026-09-10", target_date: "2026-09-11" });
  });

  it("returns an empty map when the target did not change", () => {
    const shifts = computeDependencyShifts({
      movedId: "survey",
      oldTargetDate: "2026-09-10",
      newTargetDate: "2026-09-10",
      getNode,
      getDependentIds,
      getBlockerIds,
    });
    expect(shifts.size).toBe(0);
  });

  it("keeps a dependent gated off by isShiftable in place", () => {
    const shifts = computeDependencyShifts({
      movedId: "survey",
      oldTargetDate: "2026-09-10",
      newTargetDate: "2026-09-14",
      getNode,
      getDependentIds,
      getBlockerIds,
      isShiftable: () => false,
    });
    expect(shifts.size).toBe(0);
  });
});

describe("computeDependencyShifts — chain propagation", () => {
  it("propagates through A -> B -> C -> D across a weekend", () => {
    const { getNode, getDependentIds, getBlockerIds } = graph(
      {
        a: { target: "2026-09-08" },
        b: { start: "2026-09-09", target: "2026-09-10" },
        c: { start: "2026-09-11", target: "2026-09-12" },
        d: { start: "2026-09-14", target: "2026-09-15" },
      },
      { b: ["a"], c: ["b"], d: ["c"] }
    );
    const shifts = computeDependencyShifts({
      movedId: "a",
      oldTargetDate: "2026-09-08",
      newTargetDate: "2026-09-09", // +1 working day
      getNode,
      getDependentIds,
      getBlockerIds,
    });
    expect(shifts.get("b")).toEqual({ start_date: "2026-09-10", target_date: "2026-09-11" });
    // C crosses the weekend: Sat Sep 12 stays working, Sunday Sep 13 is skipped
    expect(shifts.get("c")).toEqual({ start_date: "2026-09-12", target_date: "2026-09-14" });
    expect(shifts.get("d")).toEqual({ start_date: "2026-09-15", target_date: "2026-09-16" });
  });

  it("never loops on a dependency cycle", () => {
    const { getNode, getDependentIds, getBlockerIds } = graph(
      {
        a: { start: "2026-09-08", target: "2026-09-09" },
        b: { start: "2026-09-10", target: "2026-09-11" },
      },
      { b: ["a"], a: ["b"] }
    );
    const shifts = computeDependencyShifts({
      movedId: "a",
      oldTargetDate: "2026-09-09",
      newTargetDate: "2026-09-10",
      getNode,
      getDependentIds,
      getBlockerIds,
    });
    expect(shifts.size).toBe(0);
  });
});

describe("computeDependencyShifts — multiple dependencies", () => {
  const nodes = {
    early: { target: "2026-09-08" },
    late: { target: "2026-09-11" },
    x: { start: "2026-09-12", target: "2026-09-14" },
  };
  const edges = { x: ["early", "late"] };

  it("does not move the dependent when a non-binding blocker moves", () => {
    const { getNode, getDependentIds, getBlockerIds } = graph(nodes, edges);
    const shifts = computeDependencyShifts({
      movedId: "early",
      oldTargetDate: "2026-09-08",
      newTargetDate: "2026-09-10", // still before the late blocker's Sep 11
      getNode,
      getDependentIds,
      getBlockerIds,
    });
    expect(shifts.size).toBe(0);
  });

  it("moves the dependent by the change of the latest required date", () => {
    const { getNode, getDependentIds, getBlockerIds } = graph(nodes, edges);
    const shifts = computeDependencyShifts({
      movedId: "late",
      oldTargetDate: "2026-09-11",
      newTargetDate: "2026-09-14", // requirement Sep 11 -> Sep 14 = +2 working days
      getNode,
      getDependentIds,
      getBlockerIds,
    });
    expect(shifts.get("x")).toEqual({ start_date: "2026-09-15", target_date: "2026-09-16" });
  });

  it("limits a backward move to the other blocker's finish", () => {
    const { getNode, getDependentIds, getBlockerIds } = graph(
      {
        b1: { target: "2026-09-10" },
        b2: { target: "2026-09-09" },
        x: { start: "2026-09-11", target: "2026-09-12" },
      },
      { x: ["b1", "b2"] }
    );
    const shifts = computeDependencyShifts({
      movedId: "b1",
      oldTargetDate: "2026-09-10",
      newTargetDate: "2026-09-04", // requirement only drops to b2's Sep 9: -1 working day
      getNode,
      getDependentIds,
      getBlockerIds,
    });
    expect(shifts.get("x")).toEqual({ start_date: "2026-09-10", target_date: "2026-09-11" });
  });
});

describe("computeDependencyShifts — Sunday handling", () => {
  it("a dependent landing on Sunday rolls to Monday", () => {
    const { getNode, getDependentIds, getBlockerIds } = graph(
      {
        survey: { target: "2026-09-11" },
        processing: { start: "2026-09-12", target: "2026-09-12" },
      },
      { processing: ["survey"] }
    );
    const shifts = computeDependencyShifts({
      movedId: "survey",
      oldTargetDate: "2026-09-11",
      newTargetDate: "2026-09-12", // +1 working day
      getNode,
      getDependentIds,
      getBlockerIds,
    });
    // Sat Sep 12 + 1 working day skips Sunday Sep 13 entirely
    expect(shifts.get("processing")).toEqual({ start_date: "2026-09-14", target_date: "2026-09-14" });
  });
});
