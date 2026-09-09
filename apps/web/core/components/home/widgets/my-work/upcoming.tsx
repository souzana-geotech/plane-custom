/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { renderFormattedDateWithoutYear } from "@plane/utils";
// local imports
import { TaskCard } from "./task-card";
import { addDaysToDateString, todayString, type TMyWorkItem } from "./use-my-work-items";

const UPCOMING_WINDOW_DAYS = 7;

type TUpcomingSectionProps = {
  workspaceSlug: string;
  workItems: TMyWorkItem[];
  isLoading: boolean;
};

/** "What do I need to think about next?" — the next 7 days, grouped by date. */
export const UpcomingSection = observer(function UpcomingSection(props: TUpcomingSectionProps) {
  const { workspaceSlug, workItems, isLoading } = props;
  const { t } = useTranslation();

  const today = todayString();
  const windowEnd = addDaysToDateString(today, UPCOMING_WINDOW_DAYS);
  const upcoming = workItems.filter(
    (item) => item.target_date && item.target_date > today && item.target_date <= windowEnd
  );

  const groupedByDate = new Map<string, TMyWorkItem[]>();
  for (const item of upcoming) {
    const date = item.target_date as string;
    const existing = groupedByDate.get(date);
    if (existing) existing.push(item);
    else groupedByDate.set(date, [item]);
  }
  // oxlint-disable-next-line unicorn/no-array-sort
  const sortedDates = [...groupedByDate.keys()].sort();
  const tomorrow = addDaysToDateString(today, 1);

  const isEmpty = !isLoading && sortedDates.length === 0;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-16 font-semibold text-primary">{t("home.upcoming.title")}</h2>

      {isEmpty ? (
        <div className="rounded-md border border-subtle px-4 py-8 text-center">
          <p className="text-14 font-medium text-primary">{t("home.upcoming.empty.title")}</p>
          <p className="mt-1 text-13 text-tertiary">{t("home.upcoming.empty.description")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {sortedDates.map((date) => (
            <div key={date} className="flex flex-col">
              <h3 className="px-1 pb-1 text-13 font-medium text-secondary">
                {date === tomorrow ? t("home.upcoming.tomorrow") : renderFormattedDateWithoutYear(date)}
              </h3>
              <div className="flex flex-col">
                {(groupedByDate.get(date) ?? []).map((item) => (
                  <TaskCard key={item.id} item={item} workspaceSlug={workspaceSlug} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
});
