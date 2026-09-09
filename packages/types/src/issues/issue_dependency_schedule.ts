/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** the upstream (blocking) task responsible for an inherited delay */
export type TIssueDependencyDelayedBy = {
  id: string;
  name: string;
  sequence_id: number;
  project_id: string;
  project_identifier: string;
};

/**
 * Dependency-aware schedule projection for a task, served by
 * `GET .../issues/:issueId/dependency-schedule/`.
 *
 * A task is "dependency delayed" when a `blocked_by` dependency finishes
 * (actually or projectedly) too late for it to start as planned. The adjusted
 * dates preserve the planned duration in working days (Sundays excluded) and
 * never modify the task's own start/target dates.
 */
/**
 * One row of `GET .../workspaces/:slug/dependency-schedules/` — every
 * dependency-delay projection visible to the user in the workspace. Used by
 * cross-project surfaces (e.g. the employee resource gantt).
 */
export type TWorkspaceDependencySchedule = {
  issue_id: string;
  dependency_finish_date: string;
  adjusted_start_date: string | null;
  adjusted_target_date: string | null;
  delayed_by: TIssueDependencyDelayedBy;
};

export type TIssueDependencySchedule =
  | {
      is_dependency_delayed: true;
      /** latest projected finish date across all blocking dependencies */
      dependency_finish_date: string;
      adjusted_start_date: string | null;
      adjusted_target_date: string | null;
      delayed_by: TIssueDependencyDelayedBy;
      updated_at: string;
    }
  | {
      is_dependency_delayed: false;
    };
