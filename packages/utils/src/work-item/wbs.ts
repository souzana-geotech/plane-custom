/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TWbsIndex, TWbsMoveInstruction, TWbsMovePlan, TWbsNode, TWbsSourceItem } from "@plane/types";

/**
 * Work Breakdown Structure numbering, derived from Plane's existing hierarchy.
 *
 * The WBS code of a work item is its 1-based position among its siblings,
 * prefixed by its parent's code:
 *
 *   root #1                 -> "1"
 *   root #1, child #2       -> "1.2"
 *   root #1, child #2, #3   -> "1.2.3"
 *
 * Nothing here is persisted. The code is recomputed from `parent_id` and
 * `sort_order` on every render, so inserting, deleting or moving a work item
 * renumbers its siblings automatically. A work item's `sequence_id`
 * (`PROJ-125`) is untouched and remains the canonical identifier.
 *
 * The calculator is deliberately total: corrupted hierarchies (cycles, missing
 * parents, self-parents) degrade to a safely renderable tree instead of
 * throwing or looping. It never mutates its input.
 */

/** ordered nodes keyed by resolved parent id; roots live under this key */
const ROOT_KEY = "__wbs_root__";

/**
 * Sort siblings deterministically.
 *
 * `sort_order` is the user-facing manual order. `created_at` then `id` are pure
 * tie-breakers, mirroring the backend's `order_by("sort_order", "-created_at")`
 * so the client and the server agree on sibling order.
 */
const compareSiblings = (a: TWbsSourceItem, b: TWbsSourceItem): number => {
  const aOrder = Number.isFinite(a.sort_order) ? a.sort_order : Number.MAX_SAFE_INTEGER;
  const bOrder = Number.isFinite(b.sort_order) ? b.sort_order : Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;

  const aCreated = a.created_at ?? "";
  const bCreated = b.created_at ?? "";
  if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;

  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
};

/**
 * Resolve each item's effective parent.
 *
 * An item is attached to its declared parent only when that parent exists in
 * the dataset and attaching it does not create a cycle. Everything else is
 * promoted to a root so no subtree is ever hidden.
 */
const resolveParents = (items: TWbsSourceItem[], byId: Map<string, TWbsSourceItem>) => {
  const effectiveParentOf = new Map<string, string | null>();
  const orphanIds: string[] = [];
  const cyclicIds: string[] = [];

  for (const item of items) {
    const declaredParentId = item.parent_id;

    // real root
    if (!declaredParentId) {
      effectiveParentOf.set(item.id, null);
      continue;
    }

    // self-parent — treat as a degenerate cycle
    if (declaredParentId === item.id) {
      effectiveParentOf.set(item.id, null);
      cyclicIds.push(item.id);
      continue;
    }

    // parent not in the loaded dataset (filtered, archived, deleted, unpaged)
    if (!byId.has(declaredParentId)) {
      effectiveParentOf.set(item.id, null);
      orphanIds.push(item.id);
      continue;
    }

    // walk up the declared chain looking for this item; a hit means a cycle.
    // `seen` also stops the walk if the chain loops without passing through
    // `item`, so a corrupted graph can never spin here.
    const seen = new Set<string>([item.id]);
    let cursor: string | null | undefined = declaredParentId;
    let isCyclic = false;

    while (cursor) {
      if (seen.has(cursor)) {
        isCyclic = true;
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parent_id ?? null;
    }

    if (isCyclic) {
      effectiveParentOf.set(item.id, null);
      cyclicIds.push(item.id);
      continue;
    }

    effectiveParentOf.set(item.id, declaredParentId);
  }

  return { effectiveParentOf, orphanIds, cyclicIds };
};

/**
 * Build the WBS index for a flat collection of work items.
 *
 * Runs in O(n log n) — one grouping pass plus one sort per sibling group — and
 * allocates a single `Map` for lookups during render.
 *
 * @param items flat list of work items; order is irrelevant
 * @returns nodes keyed by id, root ids, and depth-first ordered ids
 */
export const computeWbsIndex = (items: TWbsSourceItem[] | undefined | null): TWbsIndex => {
  const empty: TWbsIndex = {
    nodes: new Map<string, TWbsNode>(),
    rootIds: [],
    orderedIds: [],
    cyclicIds: [],
    orphanIds: [],
  };

  if (!items || items.length === 0) return empty;

  // de-duplicate by id; last write wins, matching how the issue store merges
  const byId = new Map<string, TWbsSourceItem>();
  for (const item of items) {
    if (item?.id) byId.set(item.id, item);
  }
  if (byId.size === 0) return empty;

  const uniqueItems = Array.from(byId.values());
  const { effectiveParentOf, orphanIds, cyclicIds } = resolveParents(uniqueItems, byId);

  // group children under their effective parent
  const childrenOf = new Map<string, TWbsSourceItem[]>();
  for (const item of uniqueItems) {
    const key = effectiveParentOf.get(item.id) ?? ROOT_KEY;
    const bucket = childrenOf.get(key);
    if (bucket) bucket.push(item);
    else childrenOf.set(key, [item]);
  }
  for (const bucket of childrenOf.values()) bucket.sort(compareSiblings);

  const orphanSet = new Set(orphanIds);
  const cyclicSet = new Set(cyclicIds);
  const nodes = new Map<string, TWbsNode>();
  const orderedIds: string[] = [];

  // Iterative depth-first walk. `parent_id` cycles are already broken above, so
  // this cannot loop; the explicit stack also removes recursion depth as a
  // failure mode for very deep hierarchies.
  type Frame = { id: string; code: string; depth: number; path: number[]; parentId: string | null };
  const rootBucket = childrenOf.get(ROOT_KEY) ?? [];
  const rootIds = rootBucket.map((item) => item.id);

  const stack: Frame[] = [];
  for (let i = rootBucket.length - 1; i >= 0; i--) {
    const item = rootBucket[i];
    stack.push({ id: item.id, code: `${i + 1}`, depth: 0, path: [i + 1], parentId: null });
  }

  const visited = new Set<string>();

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    // defensive: a node is emitted at most once even if the graph is malformed
    if (visited.has(frame.id)) continue;
    visited.add(frame.id);

    const children = childrenOf.get(frame.id) ?? [];
    const childIds = children.map((child) => child.id);

    nodes.set(frame.id, {
      id: frame.id,
      code: frame.code,
      depth: frame.depth,
      path: frame.path,
      parentId: frame.parentId,
      childIds,
      isOrphan: orphanSet.has(frame.id),
      isCyclic: cyclicSet.has(frame.id),
    });
    orderedIds.push(frame.id);

    // push in reverse so the first child is processed first
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (visited.has(child.id)) continue;
      const index = i + 1;
      stack.push({
        id: child.id,
        code: `${frame.code}.${index}`,
        depth: frame.depth + 1,
        path: [...frame.path, index],
        parentId: frame.id,
      });
    }
  }

  return { nodes, rootIds, orderedIds, cyclicIds, orphanIds };
};

/** row emitted by `flattenWbsTree`, ready to render as a single list item */
export type TWbsVisibleRow = {
  id: string;
  code: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
};

/**
 * Flatten the index into the rows that are currently visible, honouring
 * collapse state.
 *
 * Rendering a flat array (indenting by `depth`) rather than nested DOM keeps the
 * markup shallow at any hierarchy depth and lets the existing virtualization
 * helpers work unchanged.
 *
 * @param index result of `computeWbsIndex`
 * @param isExpanded predicate answering whether a node's children are shown
 * @param isVisible optional predicate narrowing the tree to a subset (an active
 *   filter). Codes are untouched — filtering hides rows, it never renumbers.
 *   The caller must include the ancestors of every visible node (a filter match
 *   is shown in context); a node for which `isVisible` is false is skipped along
 *   with its whole subtree.
 */
export const flattenWbsTree = (
  index: TWbsIndex,
  isExpanded: (id: string) => boolean,
  isVisible?: (id: string) => boolean
): TWbsVisibleRow[] => {
  const rows: TWbsVisibleRow[] = [];
  const stack: string[] = [];

  for (let i = index.rootIds.length - 1; i >= 0; i--) stack.push(index.rootIds[i]);

  const visited = new Set<string>();

  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || visited.has(id)) continue;
    visited.add(id);

    // an invisible node cannot have a visible descendant (ancestors of every
    // visible node are visible by contract), so its subtree is skipped whole
    if (isVisible && !isVisible(id)) continue;

    const node = index.nodes.get(id);
    if (!node) continue;

    // with a filter active, the chevron reflects what expanding would reveal
    const childIds = isVisible ? node.childIds.filter((childId) => isVisible(childId)) : node.childIds;
    const hasChildren = childIds.length > 0;
    const expanded = hasChildren && isExpanded(id);
    rows.push({ id, code: node.code, depth: node.depth, hasChildren, isExpanded: expanded });

    if (!expanded) continue;
    for (let i = childIds.length - 1; i >= 0; i--) stack.push(childIds[i]);
  }

  return rows;
};

/**
 * Matches the spacing Plane's own layouts use when assigning `sort_order`
 * (see `handleSortOrder` in the issue-layouts drag-and-drop utils).
 */
const WBS_SORT_ORDER_GAP = 65535;

const finiteSortOrder = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Plan a WBS drag-and-drop move as a single mutation on the moved work item.
 *
 * The plan never touches descendants — they follow automatically because only
 * the moved item's `parent_id` / `sort_order` change and the hierarchy is
 * derived. Cycle safety: a move onto itself or into its own subtree is
 * rejected here for UX, and again by the server, which is the real boundary.
 *
 * `getSortOrder` reads the authoritative `sort_order` of a work item (the
 * index deliberately does not carry it, to stay a pure presentation value).
 */
export const planWbsMove = (
  index: TWbsIndex,
  getSortOrder: (id: string) => number | undefined,
  sourceId: string,
  targetId: string,
  instruction: TWbsMoveInstruction
): TWbsMovePlan => {
  const source = index.nodes.get(sourceId);
  const target = index.nodes.get(targetId);
  if (!source || !target) return { ok: false, reason: "not-found" };
  if (sourceId === targetId) return { ok: false, reason: "self" };
  // the target must not live inside the moved subtree — that would be a cycle
  if (getWbsAncestorIds(index, targetId).includes(sourceId)) return { ok: false, reason: "descendant" };

  if (instruction === "make-child") {
    // append at the end of the target's children (visible or not)
    const siblingIds = target.childIds.filter((id) => id !== sourceId);
    const lastSort = siblingIds.length > 0 ? getSortOrder(siblingIds[siblingIds.length - 1]) : undefined;
    return {
      ok: true,
      parentId: targetId,
      sortOrder: finiteSortOrder(lastSort) ? lastSort + WBS_SORT_ORDER_GAP : WBS_SORT_ORDER_GAP,
    };
  }

  // reorder-above / reorder-below: join the target's sibling group next to it
  const parentId = target.parentId;
  const groupIds = parentId === null ? index.rootIds : (index.nodes.get(parentId)?.childIds ?? []);
  const siblingIds = groupIds.filter((id) => id !== sourceId);
  const targetPosition = siblingIds.indexOf(targetId);
  if (targetPosition === -1) return { ok: false, reason: "not-found" };

  const insertionIndex = instruction === "reorder-above" ? targetPosition : targetPosition + 1;
  const previousSort = insertionIndex > 0 ? getSortOrder(siblingIds[insertionIndex - 1]) : undefined;
  const nextSort = insertionIndex < siblingIds.length ? getSortOrder(siblingIds[insertionIndex]) : undefined;

  let sortOrder: number;
  if (finiteSortOrder(previousSort) && finiteSortOrder(nextSort)) sortOrder = (previousSort + nextSort) / 2;
  else if (finiteSortOrder(nextSort)) sortOrder = nextSort - WBS_SORT_ORDER_GAP;
  else if (finiteSortOrder(previousSort)) sortOrder = previousSort + WBS_SORT_ORDER_GAP;
  else sortOrder = WBS_SORT_ORDER_GAP;

  return { ok: true, parentId, sortOrder };
};

/**
 * Ids of a node's ancestors, nearest parent first.
 *
 * Used to show where a deeply nested item sits without inventing a new
 * navigation concept. Bounded by the index size, so it is cycle-safe.
 */
export const getWbsAncestorIds = (index: TWbsIndex, issueId: string): string[] => {
  const ancestors: string[] = [];
  const seen = new Set<string>([issueId]);
  let cursor = index.nodes.get(issueId)?.parentId ?? null;

  while (cursor && !seen.has(cursor)) {
    ancestors.push(cursor);
    seen.add(cursor);
    cursor = index.nodes.get(cursor)?.parentId ?? null;
  }

  return ancestors;
};

/** ids of every descendant of a node, in depth-first order */
export const getWbsDescendantIds = (index: TWbsIndex, issueId: string): string[] => {
  const descendants: string[] = [];
  const root = index.nodes.get(issueId);
  if (!root) return descendants;

  const stack = root.childIds.toReversed();
  const visited = new Set<string>([issueId]);

  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    descendants.push(id);

    const node = index.nodes.get(id);
    if (!node) continue;
    for (let i = node.childIds.length - 1; i >= 0; i--) stack.push(node.childIds[i]);
  }

  return descendants;
};
