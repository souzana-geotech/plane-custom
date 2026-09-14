/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TWbsSourceItem } from "@plane/types";
import { computeWbsIndex, flattenWbsTree, getWbsAncestorIds, getWbsDescendantIds } from "../src/work-item/wbs";

/** build a source item with sensible defaults so tests stay readable */
const item = (
  id: string,
  parent_id: string | null = null,
  sort_order = 65535,
  created_at = "2026-01-01T00:00:00Z"
): TWbsSourceItem => ({ id, parent_id, sort_order, created_at });

/** id -> code, for compact assertions */
const codes = (items: TWbsSourceItem[]): Record<string, string> => {
  const index = computeWbsIndex(items);
  const result: Record<string, string> = {};
  for (const [id, node] of index.nodes) result[id] = node.code;
  return result;
};

describe("computeWbsIndex — Test 1: roots", () => {
  it("numbers root work items 1, 2, 3 in sort_order", () => {
    const items = [item("A", null, 100), item("B", null, 200), item("C", null, 300)];
    expect(codes(items)).toEqual({ A: "1", B: "2", C: "3" });
  });

  it("exposes roots in order and marks them depth 0", () => {
    const index = computeWbsIndex([item("A", null, 100), item("B", null, 200)]);
    expect(index.rootIds).toEqual(["A", "B"]);
    expect(index.nodes.get("A")?.depth).toBe(0);
    expect(index.nodes.get("A")?.path).toEqual([1]);
    expect(index.nodes.get("B")?.path).toEqual([2]);
    expect(index.nodes.get("A")?.parentId).toBeNull();
  });

  it("renumbers automatically when a sibling is inserted between two roots", () => {
    const before = [item("survey", null, 100), item("processing", null, 200)];
    expect(codes(before)).toEqual({ survey: "1", processing: "2" });

    // insert between the two, exactly as a midpoint drop would
    const after = [...before, item("new-task", null, 150)];
    expect(codes(after)).toEqual({ survey: "1", "new-task": "2", processing: "3" });
  });
});

describe("computeWbsIndex — Test 2: children", () => {
  it("numbers children as 1.1 and 1.2", () => {
    const items = [item("A", null, 100), item("B", "A", 100), item("C", "A", 200)];
    expect(codes(items)).toEqual({ A: "1", B: "1.1", C: "1.2" });
  });

  it("records childIds in sibling order and parentId on children", () => {
    const index = computeWbsIndex([item("A", null, 100), item("C", "A", 200), item("B", "A", 100)]);
    expect(index.nodes.get("A")?.childIds).toEqual(["B", "C"]);
    expect(index.nodes.get("B")?.parentId).toBe("A");
    expect(index.nodes.get("B")?.depth).toBe(1);
    expect(index.nodes.get("C")?.path).toEqual([1, 2]);
  });

  it("renumbers children when a sibling is appended", () => {
    const items = [item("P", null, 100), item("c1", "P", 100), item("c2", "P", 200), item("c3", "P", 300)];
    expect(codes(items)).toMatchObject({ c1: "1.1", c2: "1.2", c3: "1.3" });

    const withFourth = [...items, item("c4", "P", 400)];
    expect(codes(withFourth)).toMatchObject({ c1: "1.1", c2: "1.2", c3: "1.3", c4: "1.4" });
  });

  it("closes the gap when a middle sibling is deleted", () => {
    const items = [item("P", null, 100), item("c1", "P", 100), item("c2", "P", 200), item("c3", "P", 300)];
    const afterDelete = items.filter((i) => i.id !== "c2");
    // c3 becomes 1.2 — codes never leave holes
    expect(codes(afterDelete)).toEqual({ P: "1", c1: "1.1", c3: "1.2" });
  });
});

describe("computeWbsIndex — Test 3: deep hierarchy", () => {
  it("supports unlimited depth: 1, 1.1, 1.1.1, 1.1.1.1", () => {
    const items = [item("A"), item("B", "A"), item("C", "B"), item("D", "C")];
    expect(codes(items)).toEqual({ A: "1", B: "1.1", C: "1.1.1", D: "1.1.1.1" });
  });

  it("keeps numbering correct far past any legacy 3-level UI cap", () => {
    const items: TWbsSourceItem[] = [item("n0")];
    for (let i = 1; i < 40; i++) items.push(item(`n${i}`, `n${i - 1}`));

    const index = computeWbsIndex(items);
    expect(index.nodes.get("n39")?.depth).toBe(39);
    expect(index.nodes.get("n39")?.code).toBe(`1${".1".repeat(39)}`);
    expect(index.nodes.get("n39")?.path).toHaveLength(40);
  });

  it("produces the documented multi-branch structure", () => {
    const items = [
      item("survey", null, 100),
      item("field", "survey", 100),
      item("gps", "field", 100),
      item("topo", "field", 200),
      item("office", "survey", 200),
      item("processing", "office", 100),
      item("qa", "office", 200),
      item("deliverables", "survey", 300),
      item("scanning-project", null, 200),
      item("site-scan", "scanning-project", 100),
    ];

    expect(codes(items)).toEqual({
      survey: "1",
      field: "1.1",
      gps: "1.1.1",
      topo: "1.1.2",
      office: "1.2",
      processing: "1.2.1",
      qa: "1.2.2",
      deliverables: "1.3",
      "scanning-project": "2",
      "site-scan": "2.1",
    });
  });

  it("orders orderedIds depth-first", () => {
    const index = computeWbsIndex([
      item("A", null, 100),
      item("A1", "A", 100),
      item("A1a", "A1", 100),
      item("A2", "A", 200),
      item("B", null, 200),
    ]);
    expect(index.orderedIds).toEqual(["A", "A1", "A1a", "A2", "B"]);
  });
});

describe("computeWbsIndex — Test 4: sibling ordering", () => {
  it("sort_order determines numbering, not array position", () => {
    const items = [item("third", null, 300), item("first", null, 100), item("second", null, 200)];
    expect(codes(items)).toEqual({ first: "1", second: "2", third: "3" });
  });

  it("handles negative and fractional sort_order from midpoint inserts", () => {
    const items = [item("a", null, 0), item("b", null, -65535), item("c", null, 0.5)];
    expect(codes(items)).toEqual({ b: "1", a: "2", c: "3" });
  });

  it("sorts children independently of other branches", () => {
    const items = [
      item("P1", null, 100),
      item("P2", null, 200),
      // P2's children deliberately carry lower sort_order values than P1's
      item("p2c1", "P2", 1),
      item("p2c2", "P2", 2),
      item("p1c1", "P1", 900),
      item("p1c2", "P1", 950),
    ];
    expect(codes(items)).toMatchObject({
      p1c1: "1.1",
      p1c2: "1.2",
      p2c1: "2.1",
      p2c2: "2.2",
    });
  });
});

describe("computeWbsIndex — Test 5: deterministic tie-breakers", () => {
  it("falls back to created_at when sort_order ties", () => {
    const items = [item("late", null, 100, "2026-03-01T00:00:00Z"), item("early", null, 100, "2026-01-01T00:00:00Z")];
    expect(codes(items)).toEqual({ early: "1", late: "2" });
  });

  it("falls back to id when sort_order and created_at both tie", () => {
    const items = [item("zzz", null, 100, "2026-01-01T00:00:00Z"), item("aaa", null, 100, "2026-01-01T00:00:00Z")];
    expect(codes(items)).toEqual({ aaa: "1", zzz: "2" });
  });

  it("is stable across input permutations", () => {
    const base = [
      item("c", null, 100, "2026-01-01T00:00:00Z"),
      item("a", null, 100, "2026-01-01T00:00:00Z"),
      item("b", null, 100, "2026-01-01T00:00:00Z"),
    ];
    const expected = { a: "1", b: "2", c: "3" };
    expect(codes(base)).toEqual(expected);
    expect(codes(base.toReversed())).toEqual(expected);
    expect(codes([base[1], base[2], base[0]])).toEqual(expected);
  });

  it("treats missing created_at as earliest without crashing", () => {
    const items: TWbsSourceItem[] = [
      { id: "withDate", parent_id: null, sort_order: 100, created_at: "2026-01-01T00:00:00Z" },
      { id: "noDate", parent_id: null, sort_order: 100 },
    ];
    expect(codes(items)).toEqual({ noDate: "1", withDate: "2" });
  });

  it("does not mutate the input array or its items", () => {
    const items = [item("b", null, 200), item("a", null, 100)];
    const snapshot = JSON.parse(JSON.stringify(items));
    computeWbsIndex(items);
    expect(items).toEqual(snapshot);
    expect(items[0].id).toBe("b");
  });
});

describe("computeWbsIndex — Test 6: orphans", () => {
  it("renders an item whose parent is missing as a root instead of crashing", () => {
    const items = [item("A", null, 100), item("orphan", "does-not-exist", 200)];
    const index = computeWbsIndex(items);

    expect(index.rootIds).toEqual(["A", "orphan"]);
    expect(index.nodes.get("orphan")?.code).toBe("2");
    expect(index.nodes.get("orphan")?.depth).toBe(0);
    expect(index.nodes.get("orphan")?.parentId).toBeNull();
    expect(index.nodes.get("orphan")?.isOrphan).toBe(true);
    expect(index.orphanIds).toEqual(["orphan"]);
  });

  it("keeps an orphan's own subtree intact", () => {
    const items = [item("orphan", "missing", 100), item("child", "orphan", 100), item("grandchild", "child", 100)];
    expect(codes(items)).toEqual({ orphan: "1", child: "1.1", grandchild: "1.1.1" });
  });

  it("does not flag genuine roots as orphans", () => {
    const index = computeWbsIndex([item("A"), item("B", "A")]);
    expect(index.orphanIds).toEqual([]);
    expect(index.nodes.get("A")?.isOrphan).toBe(false);
  });
});

describe("computeWbsIndex — Test 7: cycles", () => {
  it("does not hang on a three-node cycle A -> B -> C -> A", () => {
    const items = [item("A", "C", 100), item("B", "A", 200), item("C", "B", 300)];
    const index = computeWbsIndex(items);

    // every node is still emitted exactly once
    expect(index.orderedIds).toHaveLength(3);
    expect(new Set(index.orderedIds).size).toBe(3);
    expect(index.cyclicIds.length).toBeGreaterThan(0);
  });

  it("detaches a self-parent and marks it cyclic", () => {
    const items = [item("A", "A", 100), item("B", null, 200)];
    const index = computeWbsIndex(items);

    expect(index.nodes.get("A")?.parentId).toBeNull();
    expect(index.nodes.get("A")?.isCyclic).toBe(true);
    expect(index.nodes.get("A")?.code).toBe("1");
    expect(index.nodes.get("B")?.code).toBe("2");
    expect(index.cyclicIds).toEqual(["A"]);
  });

  it("does not hang on a two-node cycle", () => {
    const index = computeWbsIndex([item("A", "B", 100), item("B", "A", 200)]);
    expect(index.orderedIds).toHaveLength(2);
    expect(index.cyclicIds.length).toBeGreaterThan(0);
  });

  it("keeps the healthy part of the tree correct alongside a cycle", () => {
    const items = [item("good", null, 100), item("goodChild", "good", 100), item("x", "y", 200), item("y", "x", 300)];
    const index = computeWbsIndex(items);

    expect(index.nodes.get("good")?.code).toBe("1");
    expect(index.nodes.get("goodChild")?.code).toBe("1.1");
    expect(index.orderedIds).toHaveLength(4);
  });

  it("never emits a node twice even in a large corrupted graph", () => {
    const items: TWbsSourceItem[] = [];
    for (let i = 0; i < 50; i++) items.push(item(`n${i}`, `n${(i + 1) % 50}`, i));

    const index = computeWbsIndex(items);
    expect(index.orderedIds).toHaveLength(50);
    expect(new Set(index.orderedIds).size).toBe(50);
  });
});

describe("computeWbsIndex — Test 8: empty and degenerate input", () => {
  it("returns an empty index for an empty array", () => {
    const index = computeWbsIndex([]);
    expect(index.nodes.size).toBe(0);
    expect(index.rootIds).toEqual([]);
    expect(index.orderedIds).toEqual([]);
  });

  it("returns an empty index for undefined and null", () => {
    expect(computeWbsIndex(undefined).orderedIds).toEqual([]);
    expect(computeWbsIndex(null).orderedIds).toEqual([]);
  });

  it("de-duplicates repeated ids", () => {
    const index = computeWbsIndex([item("A", null, 100), item("A", null, 100)]);
    expect(index.orderedIds).toEqual(["A"]);
  });

  it("handles a single work item", () => {
    expect(codes([item("only")])).toEqual({ only: "1" });
  });
});

describe("flattenWbsTree", () => {
  const items = [
    item("A", null, 100),
    item("A1", "A", 100),
    item("A1a", "A1", 100),
    item("A2", "A", 200),
    item("B", null, 200),
  ];

  it("returns only roots when everything is collapsed", () => {
    const rows = flattenWbsTree(computeWbsIndex(items), () => false);
    expect(rows.map((r) => r.code)).toEqual(["1", "2"]);
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[0].isExpanded).toBe(false);
    expect(rows[1].hasChildren).toBe(false);
  });

  it("returns the full depth-first list when everything is expanded", () => {
    const rows = flattenWbsTree(computeWbsIndex(items), () => true);
    expect(rows.map((r) => r.code)).toEqual(["1", "1.1", "1.1.1", "1.2", "2"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1, 0]);
  });

  it("honours partial expansion", () => {
    const expanded = new Set(["A"]);
    const rows = flattenWbsTree(computeWbsIndex(items), (id) => expanded.has(id));
    expect(rows.map((r) => r.code)).toEqual(["1", "1.1", "1.2", "2"]);
  });

  it("returns no rows for an empty index", () => {
    expect(flattenWbsTree(computeWbsIndex([]), () => true)).toEqual([]);
  });

  describe("with a visibility predicate (filter active)", () => {
    // visible sets in these tests always include ancestors, matching the
    // documented contract (the store's visibleIssueIds guarantees it)
    it("renders only visible nodes, keeping their original codes", () => {
      const visible = new Set(["A", "A1", "A1a"]);
      const rows = flattenWbsTree(
        computeWbsIndex(items),
        () => true,
        (id) => visible.has(id)
      );
      // codes are unchanged — A2 stays hidden but A1 is still 1.1, A1a still 1.1.1
      expect(rows.map((r) => r.code)).toEqual(["1", "1.1", "1.1.1"]);
      expect(rows.map((r) => r.id)).toEqual(["A", "A1", "A1a"]);
    });

    it("skips a hidden node's entire subtree", () => {
      const visible = new Set(["A", "A2", "B"]);
      const rows = flattenWbsTree(
        computeWbsIndex(items),
        () => true,
        (id) => visible.has(id)
      );
      expect(rows.map((r) => r.id)).toEqual(["A", "A2", "B"]);
    });

    it("computes hasChildren from visible children only", () => {
      // A's only visible child is A2 — the chevron must reflect what
      // expanding would actually reveal
      const visible = new Set(["A", "A2"]);
      const rows = flattenWbsTree(
        computeWbsIndex(items),
        () => false,
        (id) => visible.has(id)
      );
      expect(rows.map((r) => r.id)).toEqual(["A"]);
      expect(rows[0].hasChildren).toBe(true);

      const onlyRoot = new Set(["A"]);
      const rootRows = flattenWbsTree(
        computeWbsIndex(items),
        () => true,
        (id) => onlyRoot.has(id)
      );
      expect(rootRows.map((r) => r.id)).toEqual(["A"]);
      expect(rootRows[0].hasChildren).toBe(false);
    });

    it("still honours collapse state under a filter", () => {
      const visible = new Set(["A", "A1", "A1a", "B"]);
      const expanded = new Set(["A"]);
      const rows = flattenWbsTree(
        computeWbsIndex(items),
        (id) => expanded.has(id),
        (id) => visible.has(id)
      );
      // A1 is visible but collapsed, so A1a stays hidden
      expect(rows.map((r) => r.id)).toEqual(["A", "A1", "B"]);
    });

    it("returns no rows when nothing is visible", () => {
      const rows = flattenWbsTree(
        computeWbsIndex(items),
        () => true,
        () => false
      );
      expect(rows).toEqual([]);
    });
  });
});

describe("getWbsAncestorIds / getWbsDescendantIds", () => {
  const index = computeWbsIndex([
    item("A", null, 100),
    item("A1", "A", 100),
    item("A1a", "A1", 100),
    item("A1b", "A1", 200),
    item("A2", "A", 200),
  ]);

  it("lists ancestors nearest-first", () => {
    expect(getWbsAncestorIds(index, "A1a")).toEqual(["A1", "A"]);
    expect(getWbsAncestorIds(index, "A")).toEqual([]);
  });

  it("returns an empty ancestor list for an unknown id", () => {
    expect(getWbsAncestorIds(index, "nope")).toEqual([]);
  });

  it("lists descendants depth-first", () => {
    expect(getWbsDescendantIds(index, "A")).toEqual(["A1", "A1a", "A1b", "A2"]);
    expect(getWbsDescendantIds(index, "A1a")).toEqual([]);
  });

  it("terminates on a cyclic index", () => {
    const cyclic = computeWbsIndex([item("A", "B", 100), item("B", "A", 200)]);
    expect(getWbsAncestorIds(cyclic, "A").length).toBeLessThanOrEqual(2);
    expect(getWbsDescendantIds(cyclic, "A").length).toBeLessThanOrEqual(2);
  });
});
