/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import {
  ActivityOutline,
  AddOutline,
  InboxOutline,
  ModuleOutline,
  UserOutline,
  UserPlusOutline,
  WorkItemsOutline,
} from "@makeplane/propel/icons";
import { Button } from "@plane/propel/button";
import { EIssuesStoreType } from "@plane/types";
import { cn, calculateTimeAgo, generateWorkItemLink, renderFormattedDateWithoutYear } from "@plane/utils";
// components
import { ButtonAvatars } from "@/components/dropdowns/member/avatar";
import { RowSkeleton, SectionLabel } from "@/components/home/widgets/my-work/section";
import { StatusDot } from "@/components/home/widgets/my-work/status-chip";
import { DUE_TEXT_CLASSNAME } from "@/components/home/widgets/my-work/task-row";
import { getDueBucket, getVisualStatus, OPEN_STATE_GROUPS } from "@/components/home/widgets/my-work/use-my-work-items";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useMember } from "@/hooks/store/use-member";
import { useModule } from "@/hooks/store/use-module";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
// services
import { InboxIssueService } from "@/services/inbox";
import { WorkspaceService } from "@/services/workspace.service";

const workspaceService = new WorkspaceService();
const inboxIssueService = new InboxIssueService();

const MAX_ROWS = 6;

type TOverviewTask = {
  id: string;
  name: string;
  sequence_id: number;
  state_id: string | null;
  target_date: string | null;
  assignee_ids: string[];
  updated_at: string;
  updated_by: string | null;
  created_by: string;
};

const fetchTasks = async (workspaceSlug: string, params: Record<string, string | number>) => {
  const response = await workspaceService.getViewIssues(workspaceSlug, params);
  return {
    tasks: (response?.results ?? []) as unknown as TOverviewTask[],
    total: response?.total_count ?? 0,
  };
};

type Props = {
  workspaceSlug: string;
  projectId: string;
};

/**
 * Geotech3D: Container Overview - "what's the state of this container?" at a glance.
 *
 * Four boxes, each linking to its details: my tasks here (overdue first), what is
 * in progress and who is on it, how far each Job is, and what changed lately plus
 * new requests waiting to be triaged. An empty container offers its first steps.
 */
export const ProjectOverview = observer(function ProjectOverview(props: Props) {
  const { workspaceSlug, projectId } = props;
  const { t } = useTranslation();
  const { data: currentUser } = useUser();
  const { getProjectById } = useProject();
  const { allowPermissions } = useUserPermissions();
  const { toggleCreateIssueModal } = useCommandPalette();
  const router = useAppRouter();
  const project = getProjectById(projectId);
  const base = `/${workspaceSlug}/projects/${projectId}`;

  const canCreateTask = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );
  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  // Personal Space has one member: no "who", no team to add.
  const isPersonal = !!project?.is_personal;

  const swrOptions = { revalidateOnFocus: false };
  const { data: mine } = useSWR(
    currentUser ? `CONTAINER_OVERVIEW_MINE_${projectId}_${currentUser.id}` : null,
    () =>
      fetchTasks(workspaceSlug, {
        project: projectId,
        assignees: currentUser!.id,
        state_group: OPEN_STATE_GROUPS,
        order_by: "target_date",
        per_page: 50,
        cursor: "50:0:0",
      }),
    swrOptions
  );
  const { data: inProgress } = useSWR(
    `CONTAINER_OVERVIEW_STARTED_${projectId}`,
    () =>
      fetchTasks(workspaceSlug, {
        project: projectId,
        state_group: "started",
        order_by: "-updated_at",
        per_page: 50,
        cursor: "50:0:0",
      }),
    swrOptions
  );
  const { data: recent } = useSWR(
    `CONTAINER_OVERVIEW_RECENT_${projectId}`,
    () =>
      fetchTasks(workspaceSlug, {
        project: projectId,
        order_by: "-updated_at",
        per_page: MAX_ROWS,
        cursor: `${MAX_ROWS}:0:0`,
      }),
    swrOptions
  );
  const { data: requests } = useSWR(
    project?.inbox_view ? `CONTAINER_OVERVIEW_REQUESTS_${projectId}` : null,
    () => inboxIssueService.list(workspaceSlug, projectId, { per_page: 5, cursor: "5:0:0" }),
    swrOptions
  );

  // An empty container: nothing to report yet, so offer the first steps instead.
  if (recent && recent.total === 0 && !(requests?.total_results ?? 0)) {
    return (
      <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center justify-center gap-3 px-page-x py-20 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-geo-grey-subtle text-geo-grey">
          <WorkItemsOutline className="size-5" />
        </span>
        <p className="text-16 font-semibold text-primary">{t("container_overview.empty.title")}</p>
        <p className="max-w-[44ch] text-13 text-tertiary">{t("container_overview.empty.description")}</p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {canCreateTask && (
            <Button
              variant="primary"
              size="lg"
              prependIcon={<AddOutline />}
              onClick={() => toggleCreateIssueModal(true, EIssuesStoreType.PROJECT)}
            >
              {t("container_overview.empty.add_task")}
            </Button>
          )}
          {isAdmin && !isPersonal && (
            <Button
              variant="secondary"
              size="lg"
              prependIcon={<UserPlusOutline />}
              onClick={() => router.push(`/${workspaceSlug}/settings/projects/${projectId}/members`)}
            >
              {t("container_overview.empty.add_team")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 px-page-x py-6 lg:grid-cols-2">
      <OverviewCard
        icon={<UserOutline className="size-3.5" />}
        title={t("container_overview.my_tasks.title")}
        count={mine?.total}
        viewAllHref={`${base}/issues/`}
      >
        <TaskRows
          tasks={mine ? sortOverdueFirst(mine.tasks) : undefined}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          identifier={project?.identifier}
          emptyText={t("container_overview.my_tasks.empty")}
          trailing="due"
        />
      </OverviewCard>

      <OverviewCard
        icon={<ActivityOutline className="size-3.5" />}
        title={t("container_overview.in_progress.title")}
        count={inProgress?.total}
        viewAllHref={`${base}/issues/`}
      >
        <TaskRows
          tasks={inProgress?.tasks}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          identifier={project?.identifier}
          emptyText={t("container_overview.in_progress.empty")}
          trailing={isPersonal ? "due" : "assignees"}
        />
      </OverviewCard>

      {project?.module_view && (
        <OverviewCard
          icon={<ModuleOutline className="size-3.5" />}
          title={t("container_overview.jobs.title")}
          viewAllHref={`${base}/modules/`}
        >
          <JobsProgress projectId={projectId} base={base} emptyText={t("container_overview.jobs.empty")} />
        </OverviewCard>
      )}

      <OverviewCard
        icon={<InboxOutline className="size-3.5" />}
        title={t("container_overview.whats_new.title")}
        viewAllHref={`${base}/issues/`}
      >
        {project?.inbox_view && !!requests?.total_results && (
          <Link
            href={`${base}/intake/`}
            className="flex items-center justify-between gap-3 border-b border-subtle bg-layer-transparent-hover px-3 py-2.5 hover:bg-layer-transparent-active"
          >
            <span className="text-13 font-medium text-primary">{t("container_overview.whats_new.new_requests")}</span>
            <span className="rounded-full bg-accent-primary px-2 py-0.5 text-11 font-semibold text-on-color tabular-nums">
              {requests.total_results}
            </span>
          </Link>
        )}
        <TaskRows
          tasks={recent?.tasks}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          identifier={project?.identifier}
          emptyText={t("container_overview.whats_new.empty")}
          trailing="updated"
        />
      </OverviewCard>
    </div>
  );
});

/** Overdue first, then by due date; tasks without a date last (the API already orders by date). */
const sortOverdueFirst = (tasks: TOverviewTask[]) => {
  const overdue = tasks.filter((task) => getDueBucket(task.target_date) === "overdue");
  return [...overdue, ...tasks.filter((task) => getDueBucket(task.target_date) !== "overdue")];
};

type TOverviewCardProps = {
  icon: React.ReactNode;
  title: string;
  count?: number;
  viewAllHref: string;
  children: React.ReactNode;
};

function OverviewCard(props: TOverviewCardProps) {
  const { icon, title, count, viewAllHref, children } = props;
  const { t } = useTranslation();
  return (
    <section
      aria-label={title}
      className="flex flex-col overflow-hidden rounded-lg border border-subtle bg-surface-1 light:border-subtle-1 light:shadow-raised-100"
    >
      <div className="flex items-center gap-2 border-b border-subtle bg-layer-1 px-3 py-2 light:bg-surface-2">
        <span className="text-geo-grey">{icon}</span>
        <SectionLabel>{title}</SectionLabel>
        {count !== undefined && <span className="text-11 text-geo-grey tabular-nums">{count}</span>}
        <Link
          href={viewAllHref}
          className="ml-auto text-12 font-medium text-secondary hover:text-primary hover:underline"
        >
          {t("container_overview.view_all")}
        </Link>
      </div>
      <div className="flex flex-1 flex-col">{children}</div>
    </section>
  );
}

type TTaskRowsProps = {
  tasks: TOverviewTask[] | undefined;
  workspaceSlug: string;
  projectId: string;
  identifier: string | undefined;
  emptyText: string;
  /** What the right side of a row shows. */
  trailing: "due" | "assignees" | "updated";
};

const TaskRows = observer(function TaskRows(props: TTaskRowsProps) {
  const { tasks, workspaceSlug, projectId, identifier, emptyText, trailing } = props;
  const { getStateById } = useProjectState();
  const { getUserDetails } = useMember();

  if (!tasks) return <RowSkeleton count={3} />;
  if (tasks.length === 0) return <p className="px-3 py-6 text-center text-12 text-tertiary">{emptyText}</p>;

  return (
    <ul className="flex flex-col">
      {tasks.slice(0, MAX_ROWS).map((task) => {
        const state = task.state_id ? getStateById(task.state_id) : undefined;
        const dueBucket = getDueBucket(task.target_date);
        const editor = getUserDetails(task.updated_by ?? task.created_by);
        const href = generateWorkItemLink({
          workspaceSlug,
          projectId,
          issueId: task.id,
          projectIdentifier: identifier,
          sequenceId: task.sequence_id,
        });
        return (
          <li key={task.id} className="border-b border-subtle last:border-b-0">
            <Link href={href} className="flex min-h-11 items-center gap-3 px-3 py-2 hover:bg-layer-transparent-hover">
              <StatusDot status={getVisualStatus(state?.group, task.target_date)} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-13 font-medium text-primary">{task.name}</span>
                <span className="truncate text-12 text-geo-grey tabular-nums">
                  {identifier}-{task.sequence_id}
                  {state && ` · ${state.name}`}
                </span>
              </div>
              {trailing === "due" && task.target_date && (
                <span className={cn("flex-shrink-0 text-12", DUE_TEXT_CLASSNAME[dueBucket])}>
                  {renderFormattedDateWithoutYear(task.target_date)}
                </span>
              )}
              {trailing === "assignees" && task.assignee_ids?.length > 0 && (
                <span className="flex-shrink-0">
                  <ButtonAvatars showTooltip userIds={task.assignee_ids} />
                </span>
              )}
              {trailing === "updated" && (
                <span className="flex-shrink-0 text-right text-12 text-tertiary">
                  {editor?.display_name && <span className="block text-secondary">{editor.display_name}</span>}
                  {calculateTimeAgo(task.updated_at)}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
});

type TJobsProgressProps = {
  projectId: string;
  base: string;
  emptyText: string;
};

const JobsProgress = observer(function JobsProgress(props: TJobsProgressProps) {
  const { projectId, base, emptyText } = props;
  const { getProjectModuleIds, getModuleById } = useModule();
  const moduleIds = getProjectModuleIds(projectId);

  // Jobs under way first, then the rest; cancelled and archived ones are left out.
  const jobs = useMemo(() => {
    const order = ["in-progress", "planned", "backlog", "paused", "completed"];
    return (
      (moduleIds ?? [])
        .map((id) => getModuleById(id))
        .filter((job): job is NonNullable<typeof job> => !!job && !job.archived_at && job.status !== "cancelled")
        // oxlint-disable-next-line unicorn/no-array-sort -- sorts the fresh array built above
        .sort((a, b) => order.indexOf(a.status ?? "backlog") - order.indexOf(b.status ?? "backlog"))
    );
  }, [moduleIds, getModuleById]);

  if (!moduleIds) return <RowSkeleton count={3} />;
  if (jobs.length === 0) return <p className="px-3 py-6 text-center text-12 text-tertiary">{emptyText}</p>;

  return (
    <ul className="flex flex-col">
      {jobs.slice(0, MAX_ROWS).map((job) => {
        const total = job.total_issues ?? 0;
        const done = job.completed_issues ?? 0;
        const percent = total > 0 ? Math.round((done / total) * 100) : 0;
        return (
          <li key={job.id} className="border-b border-subtle last:border-b-0">
            <Link
              href={`${base}/modules/${job.id}/`}
              className="flex flex-col gap-1.5 px-3 py-2.5 hover:bg-layer-transparent-hover"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-13 font-medium text-primary">{job.name}</span>
                <span className="flex-shrink-0 text-12 text-secondary tabular-nums">
                  {done}/{total}
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-layer-3"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={job.name}
              >
                <div className="h-full rounded-full bg-success-primary" style={{ width: `${percent}%` }} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
});
