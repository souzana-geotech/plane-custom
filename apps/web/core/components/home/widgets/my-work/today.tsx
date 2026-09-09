/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// local imports
import { TaskCard } from "./task-card";
import { todayString, type TMyWorkItem } from "./use-my-work-items";

type TGroupKey = "overdue" | "due_today" | "in_progress";

const GROUPS: { key: TGroupKey; emoji: string; i18nKey: string; countClassName: string; showStatus: boolean }[] = [
  {
    key: "overdue",
    emoji: "🔴",
    i18nKey: "home.today.overdue",
    countClassName: "text-danger-primary",
    showStatus: true,
  },
  {
    key: "due_today",
    emoji: "🟠",
    i18nKey: "home.today.due_today",
    countClassName: "text-warning-primary",
    showStatus: true,
  },
  {
    key: "in_progress",
    emoji: "🔵",
    i18nKey: "home.today.in_progress",
    countClassName: "text-tertiary",
    showStatus: false,
  },
];

type TTodaySectionProps = {
  workspaceSlug: string;
  workItems: TMyWorkItem[];
  isLoading: boolean;
};

/**
 * The most important section on My Work: what's late, what's due today, and what the user is
 * actively working on. Due-date groups (overdue/due today) and the status group (in progress)
 * are independent — a task can legitimately show up in both.
 */
export const TodaySection = observer(function TodaySection(props: TTodaySectionProps) {
  const { workspaceSlug, workItems, isLoading } = props;
  const { t } = useTranslation();

  const today = todayString();
  const grouped: Record<TGroupKey, TMyWorkItem[]> = {
    overdue: workItems.filter((item) => item.target_date && item.target_date < today),
    due_today: workItems.filter((item) => item.target_date === today),
    in_progress: workItems.filter((item) => item.state__group === "started"),
  };
  const isEmpty = !isLoading && GROUPS.every((group) => grouped[group.key].length === 0);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-16 font-semibold text-primary">{t("home.today.title")}</h2>

      {isLoading ? (
        <Loader className="flex flex-col gap-2">
          <Loader.Item height="48px" />
          <Loader.Item height="48px" />
          <Loader.Item height="48px" />
        </Loader>
      ) : isEmpty ? (
        <div className="rounded-md border border-subtle px-4 py-8 text-center">
          <p className="text-14 font-medium text-primary">{t("home.today.empty.title")}</p>
          <p className="mt-1 text-13 text-tertiary">{t("home.today.empty.description")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {GROUPS.map((group) => {
            const items = grouped[group.key];
            if (items.length === 0) return null;
            return (
              <div key={group.key} className="flex flex-col">
                <h3 className="flex items-center gap-1.5 px-1 pb-1 text-13 font-medium text-secondary">
                  <span aria-hidden>{group.emoji}</span>
                  {t(group.i18nKey)}
                  <span className={cn("tabular-nums", group.countClassName)}>· {items.length}</span>
                </h3>
                <div className="flex flex-col">
                  {items.map((item) => (
                    <TaskCard
                      key={`${group.key}-${item.id}`}
                      item={item}
                      workspaceSlug={workspaceSlug}
                      showStatus={group.showStatus}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
});
