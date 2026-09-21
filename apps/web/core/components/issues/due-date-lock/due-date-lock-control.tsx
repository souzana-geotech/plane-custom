/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { LockOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import type { TIssue, TIssueDueDateChangeRequest } from "@plane/types";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { renderFormattedDate } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// services
import { IssueDueDateLockService } from "@/services/issue/issue_due_date_lock.service";
// local
import { useDueDateLock } from "./use-due-date-lock";

const service = new IssueDueDateLockService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  issue: Pick<TIssue, "id" | "target_date" | "is_due_date_locked">;
  isEditable: boolean;
};

const RequestRow = observer(function RequestRow(props: {
  request: TIssueDueDateChangeRequest;
  workspaceSlug: string;
  projectId: string;
  onReviewed: () => void;
}) {
  const { request, workspaceSlug, projectId, onReviewed } = props;
  const { t } = useTranslation();
  const [isReviewing, setIsReviewing] = useState<"approve" | "reject" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectReason, setShowRejectReason] = useState(false);

  const review = async (action: "approve" | "reject") => {
    setIsReviewing(action);
    try {
      await service.reviewRequest(
        workspaceSlug,
        projectId,
        request.id,
        action,
        action === "reject" ? rejectReason.trim() : ""
      );
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("common.success"),
        message:
          action === "approve"
            ? t("issue.due_date_lock.review.approved_success")
            : t("issue.due_date_lock.review.rejected_success"),
      });
      onReviewed();
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("common.error.label"),
        message: t("issue.due_date_lock.review.error"),
      });
    } finally {
      setIsReviewing(null);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-subtle bg-surface-2 p-2.5">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body-xs-regular text-secondary">
        <span className="text-body-xs-medium text-primary">{request.requested_by_detail?.display_name}</span>
        <span>{t("issue.due_date_lock.review.requested").toLowerCase()}</span>
        <span className="text-body-xs-semibold text-primary">{renderFormattedDate(request.requested_target_date)}</span>
        {request.current_target_date && (
          <span className="text-tertiary line-through">{renderFormattedDate(request.current_target_date)}</span>
        )}
      </div>

      <p className="mt-1 text-body-xs-regular text-tertiary">
        {request.reason?.trim() ? request.reason : t("issue.due_date_lock.review.no_reason")}
      </p>

      {showRejectReason && (
        <textarea
          rows={2}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          maxLength={2000}
          placeholder={t("issue.due_date_lock.review.reject_reason_placeholder")}
          className="focus:border-accent-primary mt-2 w-full resize-none rounded-md border border-subtle bg-surface-1 px-2 py-1.5 text-body-xs-regular text-primary outline-none"
        />
      )}

      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => review("approve")}
          loading={isReviewing === "approve"}
          disabled={isReviewing !== null}
        >
          {t("issue.due_date_lock.review.approve")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => (showRejectReason ? review("reject") : setShowRejectReason(true))}
          loading={isReviewing === "reject"}
          disabled={isReviewing !== null}
        >
          {t("issue.due_date_lock.review.reject")}
        </Button>
      </div>
    </div>
  );
});

/**
 * Geotech3D: the admin's fixed-due-date panel inside the task detail sidebar.
 *
 * Admins get the fix/unfix toggle and review any pending change request right
 * where the date lives, rather than in a separate admin area. Members see only
 * the fixed badge — their "Request change" action lives on the date control
 * itself.
 */
export const IssueDueDateLockControl = observer(function IssueDueDateLockControl(props: Props) {
  const { workspaceSlug, projectId, issue, isEditable } = props;
  const { t } = useTranslation();
  const { fetchIssue } = useIssueDetail();

  const { isLocked, canManageLock, isMutating, setLocked, requests, mutateRequests } = useDueDateLock({
    workspaceSlug,
    projectId,
    issue,
    withRequests: true,
  });

  const pendingRequests = requests?.filter((request) => request.status === "pending") ?? [];

  // Nothing to show to a member beyond the badge already on the date control.
  if (!canManageLock && !isLocked) return null;

  const handleToggle = async () => {
    const ok = await setLocked(!isLocked);
    // refresh the task so every surface picks up the new lock state
    if (ok) await fetchIssue(workspaceSlug, projectId, issue.id);
  };

  const handleReviewed = async () => {
    await mutateRequests();
    await fetchIssue(workspaceSlug, projectId, issue.id);
  };

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-body-xs-regular text-tertiary">
          <LockOutline className="h-3 w-3 flex-shrink-0" />
          {isLocked ? t("issue.due_date_lock.fixed") : t("issue.due_date_lock.fix")}
        </span>
        {canManageLock && isEditable && (
          <button
            type="button"
            onClick={handleToggle}
            disabled={isMutating}
            className="rounded px-1.5 py-0.5 text-body-xs-medium text-accent-primary hover:bg-accent-primary/10 disabled:opacity-50"
          >
            {isLocked ? t("issue.due_date_lock.unfix") : t("issue.due_date_lock.fix")}
          </button>
        )}
      </div>

      {canManageLock && pendingRequests.length > 0 && (
        <div className="mt-1">
          {pendingRequests.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              onReviewed={handleReviewed}
            />
          ))}
        </div>
      )}
    </div>
  );
});
