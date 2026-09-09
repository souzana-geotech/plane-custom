/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo } from "react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IState } from "@plane/types";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
// services
import { IssueService } from "@/services/issue/issue.service";
// local imports
import { patchMyWorkItemInCache, revalidateMyWork, type TMyWorkItem } from "./use-my-work-items";

const issueService = new IssueService();

/**
 * Quick actions available from a task card. They go through the same task PATCH endpoint the
 * full task view uses (so permissions and activity logs are identical), then refresh the page's lists.
 */
export const useTaskActions = (workspaceSlug: string) => {
  const { t } = useTranslation();
  const { getProjectStates } = useProjectState();

  const getStateOptions = useCallback(
    (projectId: string): IState[] => getProjectStates(projectId) ?? [],
    [getProjectStates]
  );

  const changeState = useCallback(
    async (item: TMyWorkItem, stateId: string) => {
      const previousStateId = item.state_id;
      const nextState = getProjectStates(item.project_id)?.find((state) => state.id === stateId);
      await patchMyWorkItemInCache(item.id, { state_id: stateId });
      try {
        await issueService.patchIssue(workspaceSlug, item.project_id, item.id, { state_id: stateId });
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title:
            nextState?.group === "completed" ? t("home.card.toasts.marked_done") : t("home.card.toasts.status_updated"),
          message: item.name,
        });
      } catch {
        await patchMyWorkItemInCache(item.id, { state_id: previousStateId });
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("home.card.toasts.status_update_failed"),
          message: item.name,
        });
      } finally {
        void revalidateMyWork();
      }
    },
    [workspaceSlug, getProjectStates, t]
  );

  const changeDueDate = useCallback(
    async (item: TMyWorkItem, targetDate: string | null) => {
      const previous = item.target_date;
      await patchMyWorkItemInCache(item.id, { target_date: targetDate });
      try {
        await issueService.patchIssue(workspaceSlug, item.project_id, item.id, { target_date: targetDate });
      } catch {
        await patchMyWorkItemInCache(item.id, { target_date: previous });
        setToast({ type: TOAST_TYPE.ERROR, title: t("home.card.toasts.due_date_update_failed"), message: item.name });
      } finally {
        void revalidateMyWork();
      }
    },
    [workspaceSlug, t]
  );

  const markDone = useCallback(
    async (item: TMyWorkItem) => {
      const states = getProjectStates(item.project_id) ?? [];
      const doneState =
        states.find((state) => state.group === "completed" && state.default) ??
        states.find((state) => state.group === "completed");
      if (!doneState) {
        setToast({ type: TOAST_TYPE.ERROR, title: t("home.card.toasts.status_update_failed"), message: item.name });
        return;
      }
      await changeState(item, doneState.id);
    },
    [changeState, getProjectStates, t]
  );

  return useMemo(
    () => ({ changeState, changeDueDate, markDone, getStateOptions }),
    [changeState, changeDueDate, markDone, getStateOptions]
  );
};
