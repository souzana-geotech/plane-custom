/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { LockOutline } from "@makeplane/propel/icons";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";

type TIssueDueDateLockActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

/**
 * Geotech3D: history entry for an admin fixing or releasing a task's due date.
 * Written by `track_due_date_lock` in `plane.bgtasks.issue_activities_task`.
 */
export const IssueDueDateLockActivity = observer(function IssueDueDateLockActivity(props: TIssueDueDateLockActivity) {
  const { activityId, showIssue = true, ends } = props;
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);
  if (!activity) return <></>;

  const isLocked = activity.new_value === "locked";

  return (
    <IssueActivityBlockComponent
      icon={<LockOutline width={14} height={14} className="text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        {isLocked ? "fixed the due date" : "unfixed the due date"}
        {showIssue && " for "}
        {showIssue && <IssueLink activityId={activityId} />}.
      </>
    </IssueActivityBlockComponent>
  );
});
