/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IUserLite } from "../users";

export type TDueDateChangeRequestStatus = "pending" | "approved" | "rejected";

/**
 * A member's request to change a task's fixed (admin-controlled) due date,
 * served by `.../issues/:issueId/due-date-change-requests/`.
 *
 * Submitting one never changes `target_date`; only an admin approving it does,
 * and the approval goes through the normal due-date update pipeline.
 */
export type TIssueDueDateChangeRequest = {
  id: string;
  issue: string;
  project: string;
  workspace: string;
  requested_by: string;
  requested_by_detail?: IUserLite;
  /** the date the requester is asking for */
  requested_target_date: string;
  /** the task's due date at the moment the request was raised */
  current_target_date: string | null;
  reason: string;
  status: TDueDateChangeRequestStatus;
  reviewed_by: string | null;
  reviewed_by_detail?: IUserLite;
  reviewed_at: string | null;
  /** reviewer's note; carries the rejection reason when rejected */
  review_comment: string;
  created_at: string;
  updated_at: string;
};

/** A row of the workspace-wide admin review queue. */
export type TWorkspaceDueDateChangeRequest = TIssueDueDateChangeRequest & {
  issue_detail: {
    id: string;
    name: string;
    sequence_id: number;
    project_id: string;
    project_identifier: string;
  };
};

export type TDueDateChangeRequestPayload = {
  requested_target_date: string;
  reason?: string;
};
