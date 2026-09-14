/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import type { TWbsScope } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { Row } from "@plane/ui";
import { cn, flattenWbsTree, getWbsAncestorIds } from "@plane/utils";
// components
import { LayoutErrorBoundary } from "@/components/common/layout-error-boundary";
import RenderIfVisible from "@/components/core/render-if-visible-HOC";
import { ModuleIssueQuickActions } from "@/components/issues/issue-layouts/quick-action-dropdowns";
import { ListLoaderItemRow } from "@/components/ui/loader/layouts/list-layout-loader";
// hooks
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useModule } from "@/hooks/store/use-module";
import { useUserPermissions } from "@/hooks/store/user";
import { useWbs } from "@/hooks/store/use-wbs";
import { useIssues } from "@/hooks/store/use-issues";
import { usePlatformOS } from "@/hooks/use-platform-os";
// local imports
import { IssueLayoutEmptyState } from "../empty-states";
import type { TRenderQuickActions } from "../list/list-view-types";
import {
  WBS_CODE_MIN_WIDTH,
  WBS_DEFAULT_EXPANDED_DEPTH,
  WBS_INDENT_PER_DEPTH,
  WBS_VIRTUALIZATION_THRESHOLD,
} from "./constants";
import { WbsRow } from "./wbs-row";

/**
 * The Work Breakdown Structure layout.
 *
 * **The module is the WBS scope.** Geotech3D treats a Plane Module as the job
 * container (the future "Project / Job"), so this layout only exists in the
 * module detail context: it loads the module's own work items once through the
 * endpoint's server-side module filter, derives WBS numbering from
 * `parent_id` + `sort_order`, and renders the tree as a flat, virtualized
 * list. Every module's numbering starts at 1 — no numbering is ever shared
 * across modules, and the Plane project is never used as a WBS container.
 *
 * Clicking a row opens the existing peek overview; every property control is
 * the same one the List and Table layouts use. The layout is read-only with
 * respect to hierarchy: it never writes `parent_id` or `sort_order`.
 * Reordering and re-parenting are a later phase.
 */
const WbsLayoutContent = observer(function WbsLayoutContent() {
  // refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const didAutoExpandRef = useRef(false);
  // router
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId, moduleId: routerModuleId } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  const projectId = routerProjectId?.toString();
  const moduleId = routerModuleId?.toString();
  // i18n
  const { t } = useTranslation();
  // store hooks — module stores throughout: filters/layout persistence, actions
  // (incl. "Remove from module") and empty state all follow the module context.
  const wbs = useWbs();
  const { getModuleById } = useModule();
  const { issuesFilter } = useIssues(EIssuesStoreType.MODULE);
  const { updateIssue, removeIssue, removeIssueFromView, archiveIssue } = useIssuesActions(EIssuesStoreType.MODULE);
  const { allowPermissions } = useUserPermissions();
  const { isMobile } = usePlatformOS();

  // derived values
  const scope: TWbsScope | undefined =
    workspaceSlug && projectId && moduleId ? { workspaceSlug, projectId, moduleId } : undefined;
  const moduleDetails = moduleId ? getModuleById(moduleId) : undefined;
  const displayProperties = issuesFilter?.issueFilters?.displayProperties;
  // the Filter button's expression narrows the WBS the same way it narrows
  // every other layout, except codes stay stable: filtering hides, never
  // renumbers
  const richFilters = issuesFilter?.issueFilters?.richFilters;
  const isEditingAllowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  // load the snapshot once per scope (module)
  useEffect(() => {
    if (!scope) return;
    didAutoExpandRef.current = false;
    wbs.clear();
    wbs.fetchWbsIssues(scope).catch(() => {
      // the error is surfaced through `wbs.error`; nothing to do here
    });
    return () => wbs.clear();
    // scope is reconstructed each render; its parts are the real dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug, projectId, moduleId, wbs]);

  // apply the module's filter expression to the WBS view whenever it changes;
  // the serialized value captures the expression's real dependency
  const serializedFilters = JSON.stringify(richFilters ?? null);
  useEffect(() => {
    if (!scope) return;
    wbs.applyFilters(scope, richFilters).catch(() => {
      // the error is surfaced through `wbs.error`; nothing to do here
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug, projectId, moduleId, serializedFilters, wbs]);

  const wbsIndex = wbs.wbsIndex;

  // Reveal filter matches: a match hidden inside a collapsed branch would make
  // the filter look broken, so every ancestor of a matched node is expanded.
  useEffect(() => {
    const filtered = wbs.filteredIssueIds;
    if (!filtered || filtered.size === 0) return;
    const toExpand = new Set<string>();
    for (const issueId of filtered) {
      for (const ancestorId of getWbsAncestorIds(wbsIndex, issueId)) toExpand.add(ancestorId);
    }
    if (toExpand.size > 0) wbs.setExpandedForIds([...toExpand], true);
  }, [wbs, wbs.filteredIssueIds, wbsIndex]);

  // Expand the first level on first load so the tree is not a wall of roots.
  useEffect(() => {
    if (didAutoExpandRef.current) return;
    if (wbs.loader === "init-loader" || wbsIndex.nodes.size === 0) return;
    didAutoExpandRef.current = true;

    const toExpand: string[] = [];
    for (const [id, node] of wbsIndex.nodes) {
      if (node.depth < WBS_DEFAULT_EXPANDED_DEPTH && node.childIds.length > 0) toExpand.push(id);
    }
    if (toExpand.length > 0) wbs.setExpandedForIds(toExpand, true);
  }, [wbs, wbsIndex, wbs.loader]);

  // with a filter active, only matches and their ancestors render — with their
  // original codes, since filtering never renumbers the tree
  const visibleIssueIds = wbs.visibleIssueIds;
  const visibleRows = useMemo(
    () =>
      flattenWbsTree(
        wbsIndex,
        (id) => wbs.expandedIssueIds.has(id),
        visibleIssueIds ? (id) => visibleIssueIds.has(id) : undefined
      ),
    [wbsIndex, wbs.expandedIssueIds, visibleIssueIds]
  );

  const canEditProperties = useCallback(
    (issueProjectId: string | undefined) => {
      if (!workspaceSlug || !issueProjectId) return isEditingAllowed;
      return allowPermissions(
        [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
        EUserPermissionsLevel.PROJECT,
        workspaceSlug,
        issueProjectId
      );
    },
    [allowPermissions, isEditingAllowed, workspaceSlug]
  );

  const handleToggleExpanded = useCallback((issueId: string) => wbs.toggleExpanded(issueId), [wbs]);

  // Deleting a work item cascades to its subtree on the server and removing it
  // from the module changes the scope's membership, so the snapshot is reloaded
  // rather than patched locally.
  const refreshSnapshot = useCallback(() => {
    wbs.refetch().catch(() => {});
  }, [wbs]);

  const renderQuickActions: TRenderQuickActions = useCallback(
    ({ issue, parentRef, customActionButton, placement, portalElement }) => (
      <ModuleIssueQuickActions
        parentRef={parentRef}
        issue={issue}
        customActionButton={customActionButton}
        placements={placement}
        portalElement={portalElement}
        handleDelete={async () => {
          await removeIssue(issue.project_id, issue.id);
          refreshSnapshot();
        }}
        handleUpdate={async (data) => updateIssue && updateIssue(issue.project_id, issue.id, data)}
        handleRemoveFromView={async () => {
          if (!removeIssueFromView) return;
          await removeIssueFromView(issue.project_id, issue.id);
          refreshSnapshot();
        }}
        handleArchive={async () => {
          if (!archiveIssue) return;
          await archiveIssue(issue.project_id, issue.id);
          refreshSnapshot();
        }}
        readOnly={!canEditProperties(issue.project_id ?? undefined)}
      />
    ),
    [removeIssue, updateIssue, removeIssueFromView, archiveIssue, canEditProperties, refreshSnapshot]
  );

  // The layout only makes sense inside a module (WBS scope) context.
  if (!scope) return null;

  // ---- loading -------------------------------------------------------------
  if (wbs.loader === "init-loader") {
    return (
      <div className="size-full overflow-hidden">
        {Array.from({ length: 12 }).map((_, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <ListLoaderItemRow key={index} defaultPropertyCount={4} />
        ))}
      </div>
    );
  }

  // ---- error ---------------------------------------------------------------
  if (wbs.error) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-14 text-secondary">{t("issue.wbs.error.title")}</p>
        <p className="text-13 text-tertiary">{t("issue.wbs.error.message")}</p>
        <Button variant="secondary" size="sm" onClick={refreshSnapshot}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  // ---- empty ---------------------------------------------------------------
  if (visibleRows.length === 0) {
    return <IssueLayoutEmptyState storeType={EIssuesStoreType.MODULE} />;
  }

  const shouldVirtualize = visibleRows.length > WBS_VIRTUALIZATION_THRESHOLD;

  return (
    <div ref={containerRef} className="size-full overflow-auto">
      {/* scope identity — module code + name. Deliberately separate from WBS
          numbering: "GT3D-001" names the job container, "1.2.3" names a node. */}
      {moduleDetails && (
        <Row className="flex min-h-10 items-center gap-2 border-b border-subtle bg-surface-1">
          {moduleDetails.module_code && (
            <>
              <span className="flex-shrink-0 text-13 font-semibold tracking-wide text-secondary tabular-nums">
                {moduleDetails.module_code}
              </span>
              <span className="flex-shrink-0 text-13 text-placeholder">|</span>
            </>
          )}
          <span className="truncate text-13 font-medium text-primary">{moduleDetails.name}</span>
        </Row>
      )}

      {/* column header */}
      <Row className="sticky top-0 z-[2] flex min-h-9 items-center gap-2 border-b border-subtle bg-surface-1 text-11 font-medium tracking-wide text-tertiary uppercase">
        <div className="flex min-w-0 flex-grow items-center gap-2" style={{ paddingLeft: `${WBS_INDENT_PER_DEPTH}px` }}>
          <span className="flex-shrink-0" style={{ minWidth: `${WBS_CODE_MIN_WIDTH}px` }}>
            {t("issue.wbs.columns.wbs")}
          </span>
          <span className="truncate">{t("issue.wbs.columns.task")}</span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button variant="link" size="sm" onClick={() => wbs.expandAll()}>
            {t("issue.wbs.expand_all")}
          </Button>
          <Button variant="link" size="sm" onClick={() => wbs.collapseAll()}>
            {t("issue.wbs.collapse_all")}
          </Button>
        </div>
      </Row>

      {/* honest notice when the module exceeds what a single snapshot can hold */}
      {wbs.isTruncated && (
        <Row className="flex min-h-9 items-center border-b border-subtle bg-layer-2 text-11 text-tertiary">
          {t("issue.wbs.truncated", { count: wbs.issueIds.length })}
        </Row>
      )}

      <div className={cn({ "opacity-60": wbs.loader === "mutation" })}>
        {visibleRows.map((row) => {
          const ancestorPath = row.code.split(".").slice(0, -1);
          const rowElement = (
            <WbsRow
              issueId={row.id}
              code={row.code}
              depth={row.depth}
              hasChildren={row.hasChildren}
              isExpanded={row.isExpanded}
              ancestorPath={ancestorPath.map((_, index) => ancestorPath.slice(0, index + 1).join("."))}
              onToggleExpanded={handleToggleExpanded}
              displayProperties={displayProperties}
              canEditProperties={canEditProperties}
              updateIssue={updateIssue}
              quickActions={renderQuickActions}
            />
          );

          if (!shouldVirtualize) return <div key={row.id}>{rowElement}</div>;

          return (
            <RenderIfVisible
              key={row.id}
              root={containerRef}
              verticalOffset={200}
              classNames="relative"
              placeholderChildren={
                <ListLoaderItemRow shouldAnimate={false} renderForPlaceHolder defaultPropertyCount={4} />
              }
              shouldRecordHeights={isMobile}
            >
              {rowElement}
            </RenderIfVisible>
          );
        })}
      </div>
    </div>
  );
});

export const WbsLayout = observer(function WbsLayout() {
  return (
    <LayoutErrorBoundary>
      <WbsLayoutContent />
    </LayoutErrorBoundary>
  );
});
