# Geotech3D operations dashboard

Route: `/:workspaceSlug/dashboard` (the Home page is untouched).

The dashboard reports on the Geotech3D operating model using Plane's existing entities only:

| Plane entity | Business meaning                                    |
| ------------ | --------------------------------------------------- |
| Project      | Operational container (e.g. _Geotech3D Operations_) |
| Module       | Client job                                          |
| Work item    | Actual work / task                                  |
| Label        | Department                                          |
| Assignee     | Employee                                            |

No backend, model, store or route outside this folder (plus `services/workspace-dashboard.service.ts`) was changed.

## Data sources (all pre-existing endpoints)

| Data                          | Endpoint / store                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modules with work item counts | `GET /api/workspaces/:slug/modules/` via `ModuleService.getWorkspaceModules`                                                                                     |
| Work items with relations     | `GET /api/workspaces/:slug/projects/:projectId/issues-detail/?expand=issue_relation` per joined project, paged (`WorkspaceDashboardService.getProjectWorkItems`) |
| States                        | state store (`fetchWorkspaceStates`, already loaded by the workspace wrapper)                                                                                    |
| Labels                        | label store (`fetchWorkspaceLabels`)                                                                                                                             |
| Members                       | member store (already loaded by the workspace wrapper)                                                                                                           |

The endpoints are admin/member only, so the page is gated to those roles.

## Metric definitions (`data/metrics.ts`)

- **Open work item**: state group is `backlog`, `unstarted` or `started`.
- **Overdue**: open and due date strictly before today.
- **Due this week / due soon**: open and due within today .. today + 7 days.
- **Blocked**: open and has a `blocked_by` relation to a work item that is still open (unknown state = treated as open).
- **No due date**: open and without a due date.
- **Active job**: module whose status is not `completed` or `cancelled` (archived modules are never returned).
- **Job progress**: `completed_issues / total_issues` from the module counts.
- **Job health**, first rule that matches wins:
  1. `delayed` – module due date has passed and the module is not marked completed.
  2. `blocked` – at least one open work item in the job is blocked.
  3. `at_risk` – at least one open work item is overdue, **or** the elapsed share of the module timeline exceeds the completed share by more than 20 percentage points.
  4. `on_track` – everything else (jobs without dates cannot be late).
- **Jobs needing attention (KPI)**: active jobs whose health is not `on_track`.
- **Employee workload**: counts of open work items per assignee (active, due soon, overdue, blocked). Capacity/estimates are not configured in the workspace, so no utilisation percentage is shown; the bar only compares active counts between employees.
- **Department workload**: counts per label (active, overdue, completed, blocked). Work without a label is listed as _No department_.
- **Work pipeline**: work items grouped by the workspace's real workflow states; states with the same name across projects are merged and ordered by state group, then sequence.
- **Management exceptions**: delayed jobs, overdue tasks, blocked jobs (critical); at-risk jobs, blocked tasks (warning); due this week, unassigned open tasks, open tasks without a due date, jobs without a due date (informational). Only non-zero exceptions are shown; clicking one scrolls to the widget that lists the underlying items.

Filters (project, job, department, employee) are applied client-side to the loaded dataset and never touch workspace or project filter state.

## Metrics deliberately not shown

- **Employee scheduling conflicts** – work items only carry dates, not times of day, so overlapping appointments cannot be detected. The KPI slot shows _No due date_ instead.
- **Deliverables, client reviews / revisions** – the workspace has no label, state, type or other marker that identifies a deliverable or a review; fabricating one would be misleading.
- **Equipment and sales pipeline** – no such functionality or data exists in the application.
- **Intake requests** – intake work items are excluded from the work item endpoints used here and have no workspace-level count endpoint.
