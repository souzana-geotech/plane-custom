/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isEmpty } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type {
  TIssue,
  TIssueParams,
  TLoader,
  TWbsIndex,
  TWbsNode,
  TWbsScope,
  TWorkItemFilterExpression,
} from "@plane/types";
import { computeWbsIndex, getWbsAncestorIds } from "@plane/utils";
// services
import { IssueService } from "@/services/issue";
// store
import type { IIssueRootStore } from "../root.store";

/**
 * Page size for the WBS snapshot fetch.
 *
 * The backend paginator caps `per_page` at 1000 (plane/utils/paginator.py), so
 * this is the largest single round trip the existing endpoint allows.
 */
const WBS_PER_PAGE = 1000;

/**
 * Safety cap on pages. 20 x 1000 = 20,000 work items — far beyond any project
 * we expect, but it guarantees the loop terminates if the server ever reports
 * `next_page_results` incorrectly. Hitting it sets `isTruncated`.
 */
const WBS_MAX_PAGES = 20;

export interface IWbsStore {
  // observables
  loader: TLoader;
  error: string | undefined;
  isTruncated: boolean;
  issueIds: string[];
  expandedIssueIds: Set<string>;
  filteredIssueIds: Set<string> | undefined;
  // computed
  wbsIndex: TWbsIndex;
  rootIssueIds: string[];
  visibleIssueIds: Set<string> | undefined;
  // helpers
  getWbsNode: (issueId: string) => TWbsNode | undefined;
  getChildIds: (issueId: string) => string[];
  getIsExpanded: (issueId: string) => boolean;
  // actions
  fetchWbsIssues: (scope: TWbsScope, loadType?: TLoader) => Promise<void>;
  applyFilters: (scope: TWbsScope, expression: TWorkItemFilterExpression | undefined) => Promise<void>;
  refetch: (loadType?: TLoader) => Promise<void>;
  toggleExpanded: (issueId: string) => void;
  setExpandedForIds: (issueIds: string[], expanded: boolean) => void;
  expandAll: () => void;
  collapseAll: () => void;
  clear: () => void;
}

/**
 * Data layer for the WBS layout.
 *
 * **Scope rule: the WBS is module-scoped.** A snapshot is always fetched for
 * one `TWbsScope` — the job container, currently a Plane Module — using the
 * endpoint's server-side `module` filter. The store never loads "all project
 * issues", and numbering always starts at 1 within the scope, so every module
 * carries its own independent tree.
 *
 * The store deliberately holds **no issue data of its own** — only the ordered
 * list of ids that belong to the current scope's snapshot. Every work item is
 * written into, and read back from, the authoritative `rootIssueStore.issues`
 * map, so the WBS view always renders the same objects every other layout does
 * and inline edits made elsewhere are reflected immediately.
 *
 * WBS codes are never persisted: `wbsIndex` is a MobX `computed` recalculated
 * from `parent_id` + `sort_order` whenever the underlying issues change.
 */
export class WbsStore implements IWbsStore {
  // observables
  loader: TLoader = undefined;
  error: string | undefined = undefined;
  isTruncated: boolean = false;
  issueIds: string[] = [];
  expandedIssueIds: Set<string> = new Set<string>();
  /** ids matching the active user filters; `undefined` while no filter is active */
  filteredIssueIds: Set<string> | undefined = undefined;
  // root store
  rootIssueStore: IIssueRootStore;
  // services
  issueService: IssueService;
  // in-flight request guard, so a scope switch cancels the previous snapshot
  private currentRequestKey: string | undefined = undefined;
  // in-flight request guard for the filter-match fetch, separately cancellable
  private currentFilterRequestKey: string | undefined = undefined;
  // the scope of the currently loaded snapshot, for mutation refreshes
  private currentScope: TWbsScope | undefined = undefined;
  // the filter expression of the current snapshot, re-applied after mutation refreshes
  private currentFilterExpression: TWorkItemFilterExpression | undefined = undefined;

  constructor(rootStore: IIssueRootStore) {
    makeObservable(this, {
      // observables
      loader: observable.ref,
      error: observable.ref,
      isTruncated: observable.ref,
      issueIds: observable,
      expandedIssueIds: observable,
      filteredIssueIds: observable.ref,
      // computed
      wbsIndex: computed,
      rootIssueIds: computed,
      visibleIssueIds: computed,
      // actions
      fetchWbsIssues: action,
      applyFilters: action,
      refetch: action,
      toggleExpanded: action,
      setExpandedForIds: action,
      expandAll: action,
      collapseAll: action,
      clear: action,
    });

    this.rootIssueStore = rootStore;
    this.issueService = new IssueService();
  }

  /**
   * The computed WBS tree.
   *
   * Reads issues straight out of the authoritative issue map, so any update to
   * `parent_id` or `sort_order` — made here or in any other layout — renumbers
   * the tree on the next render with no explicit invalidation.
   */
  get wbsIndex(): TWbsIndex {
    const issuesMap = this.rootIssueStore.issues.issuesMap;
    const source = [];
    for (const issueId of this.issueIds) {
      const issue = issuesMap[issueId];
      if (!issue) continue;
      source.push({
        id: issue.id,
        parent_id: issue.parent_id,
        sort_order: issue.sort_order,
        created_at: issue.created_at,
      });
    }
    return computeWbsIndex(source);
  }

  get rootIssueIds(): string[] {
    return this.wbsIndex.rootIds;
  }

  /**
   * The ids the view should render, or `undefined` when no filter is active.
   *
   * A filter narrows visibility, it never renumbers: every match is shown with
   * its full ancestor chain so the stable WBS code still reads in context.
   */
  get visibleIssueIds(): Set<string> | undefined {
    if (!this.filteredIssueIds) return undefined;
    const index = this.wbsIndex;
    const visible = new Set<string>();
    for (const issueId of this.filteredIssueIds) {
      if (!index.nodes.has(issueId)) continue;
      visible.add(issueId);
      for (const ancestorId of getWbsAncestorIds(index, issueId)) visible.add(ancestorId);
    }
    return visible;
  }

  getWbsNode = computedFn((issueId: string): TWbsNode | undefined => this.wbsIndex.nodes.get(issueId));

  getChildIds = computedFn((issueId: string): string[] => this.wbsIndex.nodes.get(issueId)?.childIds ?? []);

  getIsExpanded = computedFn((issueId: string): boolean => this.expandedIssueIds.has(issueId));

  /**
   * Load every work item of the WBS scope (one module) in as few requests as
   * possible.
   *
   * Uses the existing work-item endpoint with its existing server-side module
   * filter — no client-side filtering of a project-wide fetch, and no new API:
   * - `module=<scope>`   so ONLY the scope's work items are returned
   * - `sub_issue=true`   so children are included (the API defaults to hiding them)
   * - `order_by=sort_order` so siblings arrive in manual order
   * - no `group_by`      so the response is a flat array
   *
   * Pages are walked sequentially rather than fetching each node's children on
   * expand, which is what keeps the view free of N+1 requests.
   *
   * Numbering is scope-local: a work item whose parent is outside the module
   * renders as a root (never silently dropped), because Plane doesn't cascade
   * module membership through the hierarchy.
   */
  fetchWbsIssues = async (scope: TWbsScope, loadType: TLoader = "init-loader") => {
    const { workspaceSlug, projectId, moduleId } = scope;
    const requestKey = `${workspaceSlug}_${projectId}_${moduleId}_${Date.now()}`;
    this.currentRequestKey = requestKey;
    this.currentScope = scope;

    runInAction(() => {
      this.loader = loadType;
      this.error = undefined;
      this.isTruncated = false;
    });

    try {
      const result = await this.fetchScopePages(scope, undefined, () => this.currentRequestKey !== requestKey);

      // another fetch started while this one was in flight — discard the result
      if (!result) return;

      // write the work items into the authoritative issue map — never a copy
      this.rootIssueStore.issues.addIssue(result.collected);

      runInAction(() => {
        if (this.currentRequestKey !== requestKey) return;
        this.issueIds = result.collected.map((issue) => issue.id);
        this.isTruncated = result.truncated;
        this.loader = undefined;
      });

      // a mutation refresh may have changed the scope's membership, so the
      // active filter's match set is refreshed alongside the snapshot
      if (this.currentFilterExpression) this.applyFilters(scope, this.currentFilterExpression).catch(() => {});
    } catch (error) {
      runInAction(() => {
        if (this.currentRequestKey !== requestKey) return;
        this.loader = undefined;
        this.error = error instanceof Error ? error.message : "WBS_FETCH_FAILED";
      });
      throw error;
    }
  };

  /**
   * Apply (or clear) the module's Filter-button expression on the WBS view.
   *
   * The matching ids are fetched from the same endpoint with the same
   * `filters` param every other layout sends — the server stays the single
   * authority on what matches; nothing is re-implemented client-side. The
   * result only narrows visibility (`visibleIssueIds`): the numbering
   * snapshot is untouched, so WBS codes never change when a filter is applied.
   */
  applyFilters = async (scope: TWbsScope, expression: TWorkItemFilterExpression | undefined) => {
    // nothing active — drop the narrowing and show the full tree again
    if (isEmpty(expression)) {
      this.currentFilterExpression = undefined;
      this.currentFilterRequestKey = undefined;
      runInAction(() => {
        this.filteredIssueIds = undefined;
      });
      return;
    }

    this.currentFilterExpression = expression;
    const requestKey = `${scope.workspaceSlug}_${scope.projectId}_${scope.moduleId}_filtered_${Date.now()}`;
    this.currentFilterRequestKey = requestKey;

    const filterParams: Partial<Record<TIssueParams, string | boolean>> = {
      filters: JSON.stringify(expression),
    };

    try {
      // the previous match set stays visible until the new one lands — no flicker
      const result = await this.fetchScopePages(scope, filterParams, () => this.currentFilterRequestKey !== requestKey);
      if (!result) return;

      runInAction(() => {
        if (this.currentFilterRequestKey !== requestKey) return;
        this.filteredIssueIds = new Set(result.collected.map((issue) => issue.id));
      });
    } catch (error) {
      // an unfiltered tree under active filter chips would lie — surface the
      // failure through the same error state the snapshot fetch uses (Retry
      // reloads the snapshot, which re-applies the current filters)
      runInAction(() => {
        if (this.currentFilterRequestKey !== requestKey) return;
        this.error = error instanceof Error ? error.message : "WBS_FILTER_FETCH_FAILED";
      });
      throw error;
    }
  };

  /** Reload the currently loaded scope, e.g. after a delete cascaded server-side. */
  refetch = async (loadType: TLoader = "mutation") => {
    if (!this.currentScope) return;
    await this.fetchWbsIssues(this.currentScope, loadType);
  };

  /**
   * Walk every page of the scope's work items through the existing endpoint.
   * `extraParams` narrows the query (the filter-match fetch); `isCancelled`
   * lets the caller discard a response superseded by a newer request.
   * Returns `undefined` when cancelled mid-flight.
   */
  private fetchScopePages = async (
    scope: TWbsScope,
    extraParams: Partial<Record<TIssueParams, string | boolean>> | undefined,
    isCancelled: () => boolean
  ): Promise<{ collected: TIssue[]; truncated: boolean } | undefined> => {
    const collected: TIssue[] = [];
    let page = 0;
    let hasNextPage = true;

    while (hasNextPage && page < WBS_MAX_PAGES) {
      const params: Partial<Record<TIssueParams, string | boolean>> = {
        module: scope.moduleId,
        sub_issue: true,
        order_by: "sort_order",
        cursor: `${WBS_PER_PAGE}:${page}:0`,
        per_page: `${WBS_PER_PAGE}`,
        ...extraParams,
      };

      // pages are cursor-sequential — each request needs the previous page's result
      // oxlint-disable-next-line no-await-in-loop
      const response = await this.issueService.getIssues(scope.workspaceSlug, scope.projectId, params);

      if (isCancelled()) return undefined;

      // no group_by is sent, so `results` is always a flat array here
      const results = Array.isArray(response?.results) ? (response.results as TIssue[]) : [];
      collected.push(...results);

      hasNextPage = Boolean(response?.next_page_results) && results.length > 0;
      page += 1;
    }

    return { collected, truncated: hasNextPage && page >= WBS_MAX_PAGES };
  };

  /** Expansion is view-only state — it never touches the work item hierarchy. */
  toggleExpanded = (issueId: string) => {
    runInAction(() => {
      const next = new Set(this.expandedIssueIds);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      this.expandedIssueIds = next;
    });
  };

  setExpandedForIds = (issueIds: string[], expanded: boolean) => {
    runInAction(() => {
      const next = new Set(this.expandedIssueIds);
      for (const issueId of issueIds) {
        if (expanded) next.add(issueId);
        else next.delete(issueId);
      }
      this.expandedIssueIds = next;
    });
  };

  expandAll = () => {
    const expandable: string[] = [];
    for (const [id, node] of this.wbsIndex.nodes) {
      if (node.childIds.length > 0) expandable.push(id);
    }
    runInAction(() => {
      this.expandedIssueIds = new Set(expandable);
    });
  };

  collapseAll = () => {
    runInAction(() => {
      this.expandedIssueIds = new Set<string>();
    });
  };

  clear = () => {
    this.currentRequestKey = undefined;
    this.currentFilterRequestKey = undefined;
    this.currentScope = undefined;
    this.currentFilterExpression = undefined;
    runInAction(() => {
      this.issueIds = [];
      this.expandedIssueIds = new Set<string>();
      this.filteredIssueIds = undefined;
      this.loader = undefined;
      this.error = undefined;
      this.isTruncated = false;
    });
  };
}
