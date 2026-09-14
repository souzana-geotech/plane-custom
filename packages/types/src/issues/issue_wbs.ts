/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Work Breakdown Structure (WBS) types.
 *
 * A WBS number ("1.2.3") is a *derived presentation value*. It is never stored
 * in the database, never returned by an API and never replaces a work item's
 * `sequence_id` (`PROJ-125`) — the two are separate concepts that coexist.
 *
 * The whole structure is computed from the two fields Plane already persists on
 * every work item: `parent_id` (hierarchy) and `sort_order` (sibling order).
 */

/**
 * The container a WBS tree belongs to.
 *
 * Geotech3D architecture: the canonical WBS scope is the **job container** —
 * today that is a Plane Module (`moduleId`), which we will eventually surface
 * as our "Project / Job". The Plane project only appears here because Plane's
 * URLs and endpoints are addressed through it; it is *not* the WBS container,
 * and nothing may derive a WBS from "all issues of a Plane project".
 *
 * When the terminology flip happens, only the field carrying the scope id
 * should need renaming — every consumer already treats it as "the job".
 */
export type TWbsScope = {
  /** routing/addressing context required by Plane's REST paths */
  workspaceSlug: string;
  /** routing/addressing context required by Plane's REST paths */
  projectId: string;
  /** the WBS container: a Plane Module today, our "Project / Job" tomorrow */
  moduleId: string;
};

/** the minimum shape the WBS calculator needs from a work item */
export type TWbsSourceItem = {
  id: string;
  parent_id: string | null;
  sort_order: number;
  /** deterministic tie-breaker when two siblings share a `sort_order` */
  created_at?: string | null;
};

/** one node of the computed WBS index */
export type TWbsNode = {
  id: string;
  /** dotted WBS code derived from sibling position, e.g. "1.2.3" */
  code: string;
  /** 0 for roots, 1 for their children, and so on — unbounded */
  depth: number;
  /** 1-based sibling index per level, e.g. [1, 2, 3] for "1.2.3" */
  path: number[];
  /** resolved parent within the computed tree — null for roots and orphans */
  parentId: string | null;
  /** ordered ids of this node's direct children */
  childIds: string[];
  /**
   * True when the item declares a `parent_id` that is not present in the source
   * data (filtered out, archived, deleted or simply not loaded). Such items are
   * rendered as roots so their subtree never silently disappears.
   */
  isOrphan: boolean;
  /**
   * True when the item takes part in a `parent_id` cycle (A -> B -> A). Such
   * items are detached and rendered as roots so traversal always terminates.
   * The underlying data is never modified.
   */
  isCyclic: boolean;
};

/**
 * A drop intention on the WBS tree, matching the tree-item hitbox used by
 * Plane's existing drag-and-drop (above / below / make child).
 */
export type TWbsMoveInstruction = "reorder-above" | "reorder-below" | "make-child";

/**
 * The outcome of planning a WBS move. A successful plan is exactly one
 * existing-API mutation on the moved work item — `parent_id` + `sort_order` —
 * never anything more; descendants follow automatically because the hierarchy
 * itself is untouched.
 */
export type TWbsMovePlan =
  | {
      ok: true;
      /** the new parent — null makes the work item a root */
      parentId: string | null;
      /** midpoint / gap sort order within the new sibling group */
      sortOrder: number;
    }
  | {
      ok: false;
      /**
       * - "self": dropped onto itself
       * - "descendant": dropped inside its own subtree (would create a cycle)
       * - "not-found": source or target is not part of the computed tree
       */
      reason: "self" | "descendant" | "not-found";
    };

/** result of `computeWbsIndex` */
export type TWbsIndex = {
  /** id -> node, for O(1) lookup while rendering */
  nodes: Map<string, TWbsNode>;
  /** ordered ids of the top-level nodes (real roots, orphans and cycle members) */
  rootIds: string[];
  /** ids of every node in depth-first WBS order */
  orderedIds: string[];
  /** ids detached because they belong to a `parent_id` cycle — for diagnostics */
  cyclicIds: string[];
  /** ids whose declared parent is missing from the source data — for diagnostics */
  orphanIds: string[];
};
