/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TIssueActivity } from "@plane/types";

export const getRelationActivityContent = (activity: TIssueActivity | undefined): string | undefined => {
  if (!activity) return;

  switch (activity.field) {
    case "blocking":
      return activity.old_value === ""
        ? `marked this task is blocking task `
        : `removed the blocking task `;
    case "blocked_by":
      return activity.old_value === ""
        ? `marked this task is being blocked by `
        : `removed this task being blocked by task `;
    case "duplicate":
      return activity.old_value === ""
        ? `marked this task as duplicate of `
        : `removed this task as a duplicate of `;
    case "relates_to":
      return activity.old_value === "" ? `marked that this task relates to ` : `removed the relation from `;
  }

  return;
};
