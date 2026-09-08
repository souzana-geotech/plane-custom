/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
// i18n
import { useTranslation } from "@plane/i18n";
// plane imports
import { renderFormattedDate } from "@plane/utils";
// services
import { IssueDependencyScheduleService } from "@/services/issue/issue_dependency_schedule.service";

const issueDependencyScheduleService = new IssueDependencyScheduleService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
};

/**
 * Minimal indicator for work items whose schedule is pushed forward by a delayed
 * `blocked_by` dependency. Renders nothing unless the backend scheduling service
 * reports the work item as dependency delayed. The delay is inherited from the
 * upstream work item — distinct from the work item being overdue by itself.
 */
export function IssueDependencyDelayIndicator(props: Props) {
  const { workspaceSlug, projectId, issueId } = props;
  const { t } = useTranslation();

  const { data: schedule } = useSWR(
    workspaceSlug && projectId && issueId ? `ISSUE_DEPENDENCY_SCHEDULE_${workspaceSlug}_${projectId}_${issueId}` : null,
    workspaceSlug && projectId && issueId
      ? () => issueDependencyScheduleService.retrieve(workspaceSlug, projectId, issueId)
      : null,
    { revalidateIfStale: true, revalidateOnFocus: true }
  );

  if (!schedule || !schedule.is_dependency_delayed) return null;

  const { delayed_by, adjusted_start_date, adjusted_target_date } = schedule;
  const delayedByName = `${delayed_by.project_identifier}-${delayed_by.sequence_id} ${delayed_by.name}`;
  const adjustedDatesLabel =
    adjusted_start_date && adjusted_target_date && adjusted_start_date !== adjusted_target_date
      ? t("issue.dependency_delay.adjusted_dates", {
          startDate: renderFormattedDate(adjusted_start_date),
          targetDate: renderFormattedDate(adjusted_target_date),
        })
      : adjusted_target_date
        ? t("issue.dependency_delay.adjusted_date", { targetDate: renderFormattedDate(adjusted_target_date) })
        : null;

  return (
    <div className="my-2 flex flex-col gap-1 rounded-md bg-danger-subtle px-3 py-2">
      <span className="text-body-xs-medium text-danger-primary">{t("issue.dependency_delay.label")}</span>
      <span className="truncate text-body-xs-regular text-secondary" title={delayedByName}>
        {t("issue.dependency_delay.delayed_by", { name: delayedByName })}
      </span>
      {adjustedDatesLabel && <span className="text-body-xs-regular text-secondary">{adjustedDatesLabel}</span>}
    </div>
  );
}
