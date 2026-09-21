/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TIssue, TIssueDueDateChangeRequest } from "@plane/types";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
// services
import { IssueDueDateLockService } from "@/services/issue/issue_due_date_lock.service";

const service = new IssueDueDateLockService();

export const DUE_DATE_LOCK_REQUESTS_KEY = (issueId: string | undefined) =>
  issueId ? `DUE_DATE_CHANGE_REQUESTS_${issueId}` : null;

type TUseDueDateLockProps = {
  workspaceSlug: string | undefined;
  projectId: string | undefined;
  issue:
    | Partial<Pick<TIssue, "is_due_date_locked" | "due_date_locked_by" | "due_date_locked_at" | "target_date" | "id">>
    | undefined
    | null;
  /** skip fetching the request list until something actually needs it */
  withRequests?: boolean;
};

/**
 * Geotech3D: everything a due-date surface needs to render the fixed state.
 *
 * `isLocked` is what the *server* says. `canManageLock` decides whether the
 * viewer sees the date picker (admins keep editing a fixed date) or the
 * "Due date is fixed / Request change" affordance. Disabling in the UI is a
 * courtesy — the lock is enforced server side regardless.
 */
export const useDueDateLock = (props: TUseDueDateLockProps) => {
  const { workspaceSlug, projectId, issue, withRequests = false } = props;
  const { t } = useTranslation();
  const { allowPermissions } = useUserPermissions();
  const { updateIssueLocally } = useIssues();
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  const isLocked = !!issue?.is_due_date_locked;

  const canManageLock = allowPermissions(
    [EUserPermissions.ADMIN],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );

  // A member sees the locked affordance; an admin keeps the normal date picker.
  const isDueDateReadOnly = isLocked && !canManageLock;

  const { data: requests, mutate: mutateRequests } = useSWR(
    withRequests && isLocked && workspaceSlug && projectId && issue?.id ? DUE_DATE_LOCK_REQUESTS_KEY(issue.id) : null,
    withRequests && isLocked && workspaceSlug && projectId && issue?.id
      ? () => service.listRequests(workspaceSlug, projectId, issue.id as string)
      : null
  );

  const pendingRequest: TIssueDueDateChangeRequest | undefined = useMemo(
    () => requests?.find((request) => request.status === "pending"),
    [requests]
  );

  const setLocked = useCallback(
    async (locked: boolean) => {
      if (!workspaceSlug || !projectId || !issue?.id) return;
      const issueId = issue.id;

      // Paint the new state before the request goes out: every surface reads
      // `is_due_date_locked` from the shared issue map, so the date control
      // swaps between the picker and the fixed affordance immediately instead
      // of after a refetch. `previous` restores it if the server says no.
      const previous: Partial<TIssue> = {
        is_due_date_locked: !!issue.is_due_date_locked,
        due_date_locked_by: issue.due_date_locked_by ?? null,
        due_date_locked_at: issue.due_date_locked_at ?? null,
      };
      updateIssueLocally(issueId, { is_due_date_locked: locked });

      setIsMutating(true);
      try {
        if (locked) {
          // The lock response carries who fixed it and when, which the fixed
          // affordance shows; unlocking clears both.
          const updated = await service.lock(workspaceSlug, projectId, issueId);
          updateIssueLocally(issueId, {
            is_due_date_locked: true,
            due_date_locked_by: updated?.due_date_locked_by ?? null,
            due_date_locked_at: updated?.due_date_locked_at ?? null,
          });
        } else {
          await service.unlock(workspaceSlug, projectId, issueId);
          updateIssueLocally(issueId, {
            is_due_date_locked: false,
            due_date_locked_by: null,
            due_date_locked_at: null,
          });
        }
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("common.success"),
          message: locked ? t("issue.due_date_lock.fixed_success") : t("issue.due_date_lock.unfixed_success"),
        });
        return true;
      } catch {
        updateIssueLocally(issueId, previous);
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("common.error.label"),
          message: t("issue.due_date_lock.fix_error"),
        });
        return false;
      } finally {
        setIsMutating(false);
      }
    },
    [
      workspaceSlug,
      projectId,
      issue?.id,
      issue?.is_due_date_locked,
      issue?.due_date_locked_by,
      issue?.due_date_locked_at,
      updateIssueLocally,
      t,
    ]
  );

  return {
    isLocked,
    canManageLock,
    isDueDateReadOnly,
    isMutating,
    pendingRequest,
    requests,
    mutateRequests,
    setLocked,
    isRequestModalOpen,
    openRequestModal: () => setIsRequestModalOpen(true),
    closeRequestModal: () => setIsRequestModalOpen(false),
  };
};
