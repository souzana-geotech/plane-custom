/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { CheckDoneOutline, InboxOutline, RefreshOutline } from "@makeplane/propel/icons";
import { cn } from "@plane/utils";
// local imports
import { useMyWork, type TQueueFilter } from "./my-work-context";
import { EmptyBlock, RowSkeleton, SectionLabel } from "./section";
import { TaskRow } from "./task-row";
import { getDueBucket, useItemStateGroup, type TDueBucket, type TMyWorkItem } from "./use-my-work-items";

const PAGE_STEP = 20;

/** Group order for the prioritised "All" view: what's late first, then today, this week, later, undated. */
const GROUP_ORDER: TDueBucket[] = ["overdue", "today", "upcoming", "later", "none"];
const GROUP_LABEL_KEY: Record<TDueBucket, string> = {
  overdue: "home.queue.groups.overdue",
  today: "home.queue.groups.today",
  upcoming: "home.queue.groups.this_week",
  later: "home.queue.groups.later",
  none: "home.queue.groups.no_date",
};

const EMPTY_KEY: Record<TQueueFilter, string> = {
  all: "home.queue.empty.all",
  overdue: "home.queue.empty.overdue",
  due_today: "home.queue.empty.due_today",
  in_progress: "home.queue.empty.in_progress",
  upcoming: "home.queue.empty.upcoming",
  done: "home.queue.empty.done",
};

type TGroup = { key: TDueBucket; items: TMyWorkItem[] };

/**
 * The single work queue. "All" is the prioritised workload grouped by urgency; every other filter
 * is a flat list of the matching tasks. Nothing on the page repeats what's shown here.
 */
export const WorkQueue = observer(function WorkQueue() {
  const { t } = useTranslation();
  const {
    workspaceSlug,
    workItems,
    doneItems,
    isLoading,
    isDoneLoading,
    error,
    retry,
    filter,
    projectFilter,
    setProjectFilter,
    matchesFilter,
  } = useMyWork();
  const getStateGroup = useItemStateGroup();
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setVisibleCount(PAGE_STEP), [filter, projectFilter]);

  const byUrgency = useMemo(() => {
    const rank = (item: TMyWorkItem) => GROUP_ORDER.indexOf(getDueBucket(item.target_date));
    // within a group, in-progress work comes first, then the nearest date
    return (a: TMyWorkItem, b: TMyWorkItem) =>
      rank(a) - rank(b) ||
      Number(getStateGroup(b) === "started") - Number(getStateGroup(a) === "started") ||
      (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999");
  }, [getStateGroup]);

  const items = useMemo<TMyWorkItem[]>(() => {
    if (filter === "done") return doneItems;
    const list = filter === "all" ? workItems : workItems.filter((item) => matchesFilter(item, filter));
    // oxlint-disable-next-line unicorn/no-array-sort
    return [...list].sort(byUrgency);
  }, [filter, workItems, doneItems, matchesFilter, byUrgency]);

  const visibleItems = items.slice(0, visibleCount);

  const groups = useMemo<TGroup[]>(() => {
    if (filter !== "all") return [{ key: "none", items: visibleItems }];
    const map = new Map<TDueBucket, TMyWorkItem[]>();
    for (const item of visibleItems) {
      const bucket = getDueBucket(item.target_date);
      const existing = map.get(bucket);
      if (existing) existing.push(item);
      else map.set(bucket, [item]);
    }
    return GROUP_ORDER.filter((key) => map.has(key)).map((key) => ({ key, items: map.get(key) ?? [] }));
  }, [filter, visibleItems]);

  const isBusy = filter === "done" ? isDoneLoading : isLoading;
  const hiddenCount = items.length - visibleItems.length;

  return (
    <section
      aria-label={t("home.title")}
      className="overflow-hidden rounded-lg border border-subtle bg-surface-1 light:border-subtle-1 light:shadow-raised-100"
    >
      {error && !isBusy ? (
        <EmptyBlock
          icon={<RefreshOutline className="size-4" />}
          title={t("home.queue.error.title")}
          description={t("home.queue.error.description")}
          action={
            <button
              type="button"
              onClick={retry}
              className="rounded-md border border-strong px-2.5 py-1 text-12 font-medium text-secondary hover:bg-layer-transparent-hover"
            >
              {t("home.queue.error.retry")}
            </button>
          }
        />
      ) : isBusy ? (
        <RowSkeleton />
      ) : items.length === 0 ? (
        <EmptyBlock
          icon={filter === "done" ? <CheckDoneOutline className="size-4" /> : <InboxOutline className="size-4" />}
          title={t(`${EMPTY_KEY[filter]}.title`)}
          description={projectFilter ? t("home.my_tasks.empty.filtered") : t(`${EMPTY_KEY[filter]}.description`)}
          action={
            projectFilter && (
              <button
                type="button"
                onClick={() => setProjectFilter(null)}
                className="rounded-md border border-strong px-2.5 py-1 text-12 font-medium text-secondary hover:bg-layer-transparent-hover"
              >
                {t("home.my_tasks.clear_filters")}
              </button>
            )
          }
        />
      ) : (
        <>
          {groups.map((group) => (
            <div key={group.key}>
              {filter === "all" && (
                <div
                  className={cn(
                    "flex items-center gap-2 border-b border-subtle bg-layer-1 px-3 py-1.5 light:bg-surface-2",
                    group.key === "overdue" && "border-l-danger-primary border-l-2",
                    group.key === "today" && "border-l-warning-primary border-l-2"
                  )}
                >
                  <SectionLabel
                    className={cn(
                      group.key === "overdue" && "text-danger-primary",
                      group.key === "today" && "text-warning-primary"
                    )}
                  >
                    {t(GROUP_LABEL_KEY[group.key])}
                  </SectionLabel>
                  <span className="text-11 text-geo-grey tabular-nums">{group.items.length}</span>
                </div>
              )}
              <ul className="flex flex-col">
                {group.items.map((item) => (
                  <TaskRow key={item.id} item={item} workspaceSlug={workspaceSlug} />
                ))}
              </ul>
            </div>
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setVisibleCount((value) => value + PAGE_STEP)}
              className="w-full border-t border-subtle px-3 py-2 text-left text-12 font-medium text-secondary transition-colors hover:bg-layer-transparent-hover hover:text-primary"
            >
              {t("home.my_tasks.show_more", { count: hiddenCount })}
            </button>
          )}
        </>
      )}
    </section>
  );
});
