/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { LockOutline } from "@makeplane/propel/icons";
import { Calendar } from "@plane/propel/calendar";
import { useTranslation } from "@plane/i18n";
import type { TIssue } from "@plane/types";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { getDate, renderFormattedDate, renderFormattedPayloadDate } from "@plane/utils";
// services
import { IssueDueDateLockService } from "@/services/issue/issue_due_date_lock.service";

const service = new IssueDueDateLockService();

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  issue: Pick<TIssue, "id" | "target_date" | "start_date">;
  onSubmitted?: () => void;
};

/**
 * Geotech3D: the member-facing "Request change" form for a fixed due date.
 *
 * Submitting never changes the task — it records a request an admin reviews.
 * The submit button stays disabled until a date *different* from the current
 * due date is picked, which is also enforced server side.
 */
export const RequestDueDateChangeModal = observer(function RequestDueDateChangeModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId, issue, onSubmitted } = props;
  const { t } = useTranslation();

  const [requestedDate, setRequestedDate] = useState<Date | null>(null);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // start each visit from a clean form
  useEffect(() => {
    if (isOpen) {
      setRequestedDate(null);
      setReason("");
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const currentDate = getDate(issue.target_date);
  const requestedPayloadDate = requestedDate ? renderFormattedPayloadDate(requestedDate) : undefined;
  const isSameDate = !!requestedPayloadDate && requestedPayloadDate === issue.target_date;
  const canSubmit = !!requestedPayloadDate && !isSameDate && !isSubmitting;

  const handleSubmit = async () => {
    if (!requestedPayloadDate || isSameDate) return;
    setIsSubmitting(true);
    try {
      await service.createRequest(workspaceSlug, projectId, issue.id, {
        requested_target_date: requestedPayloadDate,
        reason: reason.trim(),
      });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("issue.due_date_lock.request.success_title"),
        message: t("issue.due_date_lock.request.success_message"),
      });
      onSubmitted?.();
      onClose();
    } catch (error) {
      const code = (error as { error_message?: string } | undefined)?.error_message;
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("issue.due_date_lock.request.error_title"),
        message:
          code === "DUE_DATE_CHANGE_REQUEST_EXISTS"
            ? t("issue.due_date_lock.request.already_pending")
            : code === "DUE_DATE_CHANGE_REQUEST_SAME_DATE"
              ? t("issue.due_date_lock.request.same_date")
              : t("common.error.message"),
      });
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.XL}>
      <div className="p-5">
        <div className="flex items-start gap-2">
          <LockOutline className="mt-0.5 h-4 w-4 flex-shrink-0 text-tertiary" />
          <div>
            <h3 className="text-body-md-semibold text-primary">{t("issue.due_date_lock.request.title")}</h3>
            <p className="mt-1 text-body-xs-regular text-tertiary">{t("issue.due_date_lock.request.description")}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
          <span className="text-body-xs-medium text-tertiary">{t("issue.due_date_lock.request.current_due_date")}</span>
          <span className="text-body-xs-semibold text-primary">
            {issue.target_date ? renderFormattedDate(issue.target_date) : "—"}
          </span>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-body-xs-medium text-secondary">
            {t("issue.due_date_lock.request.requested_due_date")}
          </p>
          <div className="flex justify-center rounded-md border border-subtle p-2">
            <Calendar
              mode="single"
              captionLayout="dropdown"
              selected={requestedDate ?? undefined}
              defaultMonth={requestedDate ?? currentDate ?? undefined}
              onSelect={(date: Date | undefined) => setRequestedDate(date ?? null)}
              showOutsideDays
              fixedWeeks
            />
          </div>
          {isSameDate && (
            <p className="mt-1.5 text-body-xs-regular text-danger-primary">
              {t("issue.due_date_lock.request.same_date")}
            </p>
          )}
        </div>

        <div className="mt-4">
          <label className="mb-2 block text-body-xs-medium text-secondary" htmlFor="due-date-request-reason">
            {t("issue.due_date_lock.request.reason")}
          </label>
          <textarea
            id="due-date-request-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
            placeholder={t("issue.due_date_lock.request.reason_placeholder")}
            className="focus:border-accent-primary w-full resize-none rounded-md border border-subtle bg-surface-1 px-3 py-2 text-body-sm-regular text-primary outline-none"
          />
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("issue.due_date_lock.request.cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
            {isSubmitting ? t("issue.due_date_lock.request.submitting") : t("issue.due_date_lock.request.submit")}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
});
