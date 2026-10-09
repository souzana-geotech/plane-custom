/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
import { LockOutline } from "@makeplane/propel/icons";
// plane imports
import { EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EUserWorkspaceRoles } from "@plane/types";
import type { IState } from "@plane/types";
import { cn, renderFormattedDateWithoutYear } from "@plane/utils";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserPermissions } from "@/hooks/store/user";
import { useMySpace } from "@/hooks/use-my-space";
// services
import { ProjectService } from "@/services/project/project.service";
import { ProjectStateService } from "@/services/project/project-state.service";
import { WorkspaceService } from "@/services/workspace.service";
// local imports
import { useMyWork } from "./my-work-context";
import { RowSkeleton, SectionLabel } from "./section";
import { StatusDot } from "./status-chip";
import { DUE_TEXT_CLASSNAME } from "./task-row";
import { getDueBucket, getVisualStatus, OPEN_STATE_GROUPS, type TMyWorkItem } from "./use-my-work-items";

const projectService = new ProjectService();
const stateService = new ProjectStateService();
const workspaceService = new WorkspaceService();

const MAX_ROWS = 8;

/**
 * Geotech3D: the user's open My Space tasks, on My Work in every company workspace.
 *
 * My Space lives in its own shared workspace, so the work queue's stores (containers
 * and states of the current workspace) know nothing about these tasks. This section
 * reads them straight from the My Space workspace; a task opens in My Space shown
 * inside this same workspace (`/<workspace>/my-space/?task=<id>`).
 */
export const MySpaceQueue = observer(function MySpaceQueue() {
  const { t } = useTranslation();
  const { workspaceSlug } = useMyWork();
  const { workspaces } = useWorkspace();
  const { isInMySpace } = useMySpace();
  const { allowPermissions } = useUserPermissions();
  // Guests have no My Space.
  const canHaveMySpace = allowPermissions(
    [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    EUserPermissionsLevel.WORKSPACE,
    workspaceSlug
  );

  const mySpaceSlug = useMemo(
    () => Object.values(workspaces ?? {}).find((workspace) => workspace.is_my_space)?.slug,
    [workspaces]
  );
  const enabled = !!mySpaceSlug && !isInMySpace && canHaveMySpace;

  // Only the caller's own container is visible to them in the My Space workspace.
  const { data: container } = useSWR(enabled ? `MY_SPACE_CONTAINER_${mySpaceSlug}` : null, async () => {
    const projects = await projectService.getProjectsLite(mySpaceSlug!);
    return projects.find((project) => project.is_personal) ?? null;
  });
  const { data: items, isLoading } = useSWR(
    enabled && container ? `MY_SPACE_OPEN_TASKS_${mySpaceSlug}_${container.id}` : null,
    async () => {
      const response = await workspaceService.getViewIssues(mySpaceSlug!, {
        state_group: OPEN_STATE_GROUPS,
        order_by: "target_date",
        per_page: 50,
        cursor: "50:0:0",
      });
      return ((response?.results ?? []) as unknown as TMyWorkItem[]).filter(
        (item) => item.project_id === container!.id
      );
    }
  );
  const { data: states } = useSWR(enabled && container ? `MY_SPACE_STATES_${mySpaceSlug}_${container.id}` : null, () =>
    stateService.getStates(mySpaceSlug!, container!.id)
  );

  const stateById = useMemo(() => new Map((states ?? []).map((state: IState) => [state.id, state])), [states]);

  // Inside My Space the home page already lists these tasks.
  if (isInMySpace || !canHaveMySpace) return null;

  const header = (
    <div className="flex items-center gap-2 border-b border-subtle bg-layer-1 px-3 py-1.5 light:bg-surface-2">
      <LockOutline className="size-3.5 text-geo-grey" />
      <SectionLabel>{t("my_space.title")}</SectionLabel>
      {items && <span className="text-11 text-geo-grey tabular-nums">{items.length}</span>}
      {container && mySpaceSlug && (
        <Link
          href={`/${workspaceSlug}/my-space/`}
          className="ml-auto text-12 font-medium text-secondary hover:text-primary hover:underline"
        >
          {t("my_space.open")}
        </Link>
      )}
    </div>
  );

  return (
    <section
      aria-label={t("my_space.title")}
      className="overflow-hidden rounded-lg border border-subtle bg-surface-1 light:border-subtle-1 light:shadow-raised-100"
    >
      {header}
      {!mySpaceSlug ? (
        // Never opened yet: My Space is created on first use.
        <div className="flex items-center justify-between gap-3 px-3 py-3">
          <p className="text-12 text-tertiary">{t("my_space.home.intro")}</p>
          <Link
            href={`/${workspaceSlug}/my-space/`}
            className="flex-shrink-0 rounded-md border border-strong px-2.5 py-1 text-12 font-medium text-secondary hover:bg-layer-transparent-hover"
          >
            {t("my_space.open")}
          </Link>
        </div>
      ) : isLoading || !container ? (
        <RowSkeleton count={2} />
      ) : !items || items.length === 0 ? (
        <p className="px-3 py-3 text-12 text-tertiary">{t("my_space.home.empty")}</p>
      ) : (
        <ul className="flex flex-col">
          {items.slice(0, MAX_ROWS).map((item) => {
            const state = item.state_id ? stateById.get(item.state_id) : undefined;
            const status = getVisualStatus(state?.group, item.target_date);
            const dueBucket = getDueBucket(item.target_date);
            // Opens in My Space inside this workspace, with the task's panel open.
            const link = `/${workspaceSlug}/my-space/?task=${item.id}`;
            return (
              <li
                key={item.id}
                className="flex min-h-11 items-center gap-3 border-b border-subtle px-3 py-2 last:border-b-0 hover:bg-layer-transparent-hover"
              >
                <StatusDot status={status} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link
                    href={link}
                    className="truncate text-13 font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
                  >
                    {item.name}
                  </Link>
                  <span className="text-12 text-geo-grey tabular-nums">
                    {container.identifier}-{item.sequence_id}
                    {state && ` · ${state.name}`}
                  </span>
                </div>
                {item.target_date && (
                  <span className={cn("flex-shrink-0 text-12", DUE_TEXT_CLASSNAME[dueBucket])}>
                    {renderFormattedDateWithoutYear(item.target_date)}
                  </span>
                )}
              </li>
            );
          })}
          {items.length > MAX_ROWS && (
            <li className="px-3 py-2 text-12 text-tertiary">
              {t("my_space.home.more", { count: items.length - MAX_ROWS })}
            </li>
          )}
        </ul>
      )}
    </section>
  );
});
