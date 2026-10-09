/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
import { Checkbox } from "@makeplane/propel/components/checkbox";
import { ChevronRightOutline, LockOutline } from "@makeplane/propel/icons";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssue } from "@plane/types";
import { cn, generateWorkItemLink, renderFormattedPayloadDate } from "@plane/utils";
// components
import { DateDropdown } from "@/components/dropdowns/date";
import { DUE_TEXT_CLASSNAME } from "@/components/home/widgets/my-work/task-row";
import { getDueBucket, type TDueBucket } from "@/components/home/widgets/my-work/use-my-work-items";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
// services
import { IssueService } from "@/services/issue/issue.service";
import { WorkspaceService } from "@/services/workspace.service";

const issueService = new IssueService();
const workspaceService = new WorkspaceService();

type TPersonalTask = Pick<TIssue, "id" | "name" | "sequence_id" | "state_id" | "target_date">;

/** Open tasks are grouped by when they are due, most urgent first. */
const GROUP_ORDER: TDueBucket[] = ["overdue", "today", "upcoming", "later", "none"];
const GROUP_LABEL_KEY: Record<TDueBucket, string> = {
  overdue: "home.queue.groups.overdue",
  today: "home.queue.groups.today",
  upcoming: "home.queue.groups.this_week",
  later: "home.queue.groups.later",
  none: "home.queue.groups.no_date",
};

type Props = {
  workspaceSlug: string;
  projectId: string;
};

/**
 * Geotech3D: My Space as a plain to-do list.
 *
 * Replaces the container task layouts for a personal container: type a task and
 * press Enter, tick it off when it's done, give it a due date if it has one.
 * Everything else about a task is one click away on its own page.
 */
export const MySpaceTaskList = observer(function MySpaceTaskList(props: Props) {
  const { workspaceSlug, projectId } = props;
  const { t } = useTranslation();
  const { getProjectById } = useProject();
  const { getProjectStates, fetchProjectStates } = useProjectState();
  const [newTaskName, setNewTaskName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const project = getProjectById(projectId);
  useSWR(`MY_SPACE_STATES_${projectId}`, () => fetchProjectStates(workspaceSlug, projectId));
  const projectStates = getProjectStates(projectId);
  const states = useMemo(() => projectStates ?? [], [projectStates]);

  const tasksKey = `MY_SPACE_TASKS_${projectId}`;
  const {
    data: tasks,
    isLoading,
    mutate,
  } = useSWR(tasksKey, async () => {
    const response = await workspaceService.getViewIssues(workspaceSlug, {
      project: projectId,
      order_by: "target_date",
      per_page: 500,
      cursor: "500:0:0",
    });
    return (response?.results ?? []) as unknown as TPersonalTask[];
  });

  const stateById = useMemo(() => new Map(states.map((state) => [state.id, state])), [states]);
  const todoStateId = useMemo(
    () => (states.find((state) => state.default) ?? states.find((state) => state.group === "unstarted"))?.id,
    [states]
  );
  const doneStateId = useMemo(() => states.find((state) => state.group === "completed")?.id, [states]);

  const isDone = (task: TPersonalTask) => {
    const group = task.state_id ? stateById.get(task.state_id)?.group : undefined;
    return group === "completed" || group === "cancelled";
  };

  const { groups, doneTasks } = useMemo(() => {
    const open = (tasks ?? []).filter((task) => !isDone(task));
    const byBucket = new Map<TDueBucket, TPersonalTask[]>();
    for (const task of open) {
      const bucket = getDueBucket(task.target_date);
      byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), task]);
    }
    return {
      groups: GROUP_ORDER.filter((key) => byBucket.has(key)).map((key) => ({ key, tasks: byBucket.get(key) ?? [] })),
      doneTasks: (tasks ?? []).filter(isDone),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, stateById]);

  const showError = () =>
    setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error"), message: t("my_space.list.error") });

  const updateTask = async (task: TPersonalTask, data: Partial<TIssue>) => {
    // optimistic: the list reflects the change at once, then re-syncs
    await mutate((current) => current?.map((item) => (item.id === task.id ? { ...item, ...data } : item)), {
      revalidate: false,
    });
    try {
      await issueService.patchIssue(workspaceSlug, projectId, task.id, data);
    } catch {
      showError();
    } finally {
      void mutate();
    }
  };

  const createTask = async () => {
    const name = newTaskName.trim();
    if (!name || isCreating) return;
    setIsCreating(true);
    try {
      await issueService.createIssue(workspaceSlug, projectId, { name });
      setNewTaskName("");
      await mutate();
    } catch {
      showError();
    } finally {
      setIsCreating(false);
      inputRef.current?.focus();
    }
  };

  const renderTask = (task: TPersonalTask) => {
    const done = isDone(task);
    const state = task.state_id ? stateById.get(task.state_id) : undefined;
    const dueBucket = getDueBucket(task.target_date);
    const link = generateWorkItemLink({
      workspaceSlug,
      projectId,
      issueId: task.id,
      projectIdentifier: project?.identifier,
      sequenceId: task.sequence_id,
    });
    return (
      <li
        key={task.id}
        className="group/row flex min-h-11 items-center gap-3 border-b border-subtle px-3 py-2 last:border-b-0 hover:bg-layer-transparent-hover"
      >
        <Checkbox
          checked={done}
          aria-label={done ? t("my_space.list.mark_open") : t("home.card.mark_done")}
          onClick={() => {
            const stateId = done ? todoStateId : doneStateId;
            if (stateId) void updateTask(task, { state_id: stateId });
          }}
        />
        <Link
          href={link}
          className={cn(
            "min-w-0 flex-1 truncate text-13 text-primary hover:underline",
            done && "text-tertiary line-through decoration-geo-grey"
          )}
        >
          {task.name}
        </Link>
        {!done && state?.group === "started" && (
          <span className="flex-shrink-0 rounded-full bg-warning-subtle px-2 py-0.5 text-11 font-medium text-warning-primary">
            {t("home.status.in_progress")}
          </span>
        )}
        {!done && (
          <div className={cn("flex-shrink-0", !task.target_date && "opacity-0 group-hover/row:opacity-100")}>
            <DateDropdown
              value={task.target_date ?? null}
              onChange={(date) => void updateTask(task, { target_date: renderFormattedPayloadDate(date) ?? null })}
              placeholder={t("home.card.set_due_date")}
              buttonVariant="transparent-with-text"
              buttonClassName={cn("h-7 px-1.5 text-12", DUE_TEXT_CLASSNAME[dueBucket])}
              formatToken="MMM dd"
              hideIcon={!!task.target_date}
              isClearable
              placement="bottom-end"
            />
          </div>
        )}
      </li>
    );
  };

  const hasOpenTasks = groups.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-18 font-semibold text-primary">
          <LockOutline className="size-4 text-tertiary" />
          {t("my_space.title")}
        </h1>
        <p className="text-13 text-tertiary">{t("my_space.list.subtitle")}</p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void createTask();
        }}
      >
        <input
          ref={inputRef}
          value={newTaskName}
          onChange={(event) => setNewTaskName(event.target.value)}
          disabled={isCreating}
          placeholder={t("my_space.list.add_placeholder")}
          aria-label={t("my_space.list.add_placeholder")}
          className="w-full rounded-lg border border-subtle bg-surface-1 px-3 py-2.5 text-13 text-primary placeholder:text-placeholder focus:border-accent-strong focus:outline-none"
        />
      </form>

      {isLoading ? null : !hasOpenTasks ? (
        <div className="rounded-lg border border-dashed border-subtle px-4 py-10 text-center">
          <p className="text-13 font-medium text-primary">{t("my_space.list.empty.title")}</p>
          <p className="mt-1 text-12 text-tertiary">{t("my_space.list.empty.description")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-1.5">
              <h2
                className={cn(
                  "px-1 text-11 font-semibold tracking-wide text-geo-grey uppercase",
                  group.key === "overdue" && "text-danger-primary",
                  group.key === "today" && "text-warning-primary"
                )}
              >
                {t(GROUP_LABEL_KEY[group.key])} · {group.tasks.length}
              </h2>
              <ul className="overflow-hidden rounded-lg border border-subtle bg-surface-1">
                {group.tasks.map(renderTask)}
              </ul>
            </section>
          ))}
        </div>
      )}

      {doneTasks.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setShowDone((value) => !value)}
            className="flex items-center gap-1 px-1 text-11 font-semibold tracking-wide text-geo-grey uppercase hover:text-secondary"
            aria-expanded={showDone}
          >
            <ChevronRightOutline className={cn("size-3 transition-transform", showDone && "rotate-90")} />
            {t("home.status.done")} · {doneTasks.length}
          </button>
          {showDone && (
            <ul className="overflow-hidden rounded-lg border border-subtle bg-surface-1">
              {doneTasks.map(renderTask)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
});
