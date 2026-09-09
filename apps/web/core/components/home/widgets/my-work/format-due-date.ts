/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { renderFormattedDateWithoutYear } from "@plane/utils";
import { addDaysToDateString, todayString } from "./use-my-work-items";

/**
 * Turns a `YYYY-MM-DD` due date into plain language: "today", "tomorrow", or "Sep 15" —
 * never a raw ISO string or a number of days. Works the same for a past (overdue) date,
 * which is the point: overdue rows show "Due Sep 4", not "Due -2 days".
 */
export const formatFriendlyDate = (dateStr: string, t: (key: string) => string): string => {
  const today = todayString();
  if (dateStr === today) return t("home.due.today");
  if (dateStr === addDaysToDateString(today, 1)) return t("home.due.tomorrow");
  return renderFormattedDateWithoutYear(dateStr);
};
