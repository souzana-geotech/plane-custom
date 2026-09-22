/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "next/navigation";
// plane imports
import { EUserPermissions } from "@plane/constants";
// hooks
import { useUser, useUserPermissions } from "@/hooks/store/user";

/**
 * Geotech3D: a guest may move a task that is assigned to them to another state,
 * and do nothing else with it. Every other property stays read-only, so the
 * state dropdown asks this instead of the blanket `isEditable` the layouts pass
 * down. Mirrors the server-side rule in `plane.utils.guest_scope`.
 *
 * @param projectId the container the task belongs to
 * @param assigneeIds the task's current assignees
 * @returns true when the signed-in user is a guest assigned to this task
 */
export const useCanGuestAssigneeUpdateState = (
  projectId: string | null | undefined,
  assigneeIds: string[] | null | undefined
): boolean => {
  const { workspaceSlug: routeWorkspaceSlug } = useParams();
  const { data: currentUser } = useUser();
  const { getProjectRoleByWorkspaceSlugAndProjectId } = useUserPermissions();

  const workspaceSlug = routeWorkspaceSlug?.toString();
  if (!workspaceSlug || !projectId || !currentUser) return false;
  if (getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId) !== EUserPermissions.GUEST) return false;

  return !!assigneeIds?.includes(currentUser.id);
};
