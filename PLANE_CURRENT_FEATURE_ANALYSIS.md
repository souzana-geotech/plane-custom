# Plane — Current Feature Analysis

> **Scope note.** This document is an **analysis-only** deliverable. No production code, schema,
> route, or UI was modified while producing it. The only file created is this report, which the
> task brief explicitly requested as the deliverable.
>
> **Repository state analysed:** branch `custom-dashboard`, HEAD `6ab7ffcb8f` ("Add custom
> dashboard"), root `package.json` version `1.4.2`. This is the **Community Edition (CE) /
> open-source** repository. Several features referenced by the CE code are implemented only in the
> closed-source Enterprise Edition (EE); those are called out explicitly and are a major source of
> the "declared but not implemented" findings below.
>
> **Local customisation present.** Three paths are untracked local additions in this working copy
> and are **not** upstream Plane:
> `apps/web/app/(all)/[workspaceSlug]/(projects)/dashboard/`,
> `apps/web/core/components/workspace-dashboard/`,
> `apps/web/core/services/workspace-dashboard.service.ts`
> (plus the `:workspaceSlug/dashboard` route added to `apps/web/app/routes/core.ts`). They are
> analysed separately in §18 so they are not confused with stock behaviour.

---

## 1. Executive Summary

Plane CE is a mature, work-item-centric project management system built as a **pnpm/turbo
monorepo**: a Django 5 + DRF + PostgreSQL + Celery/Redis backend (`apps/api`), a React Router 7
(SPA, Vite) frontend with MobX stores (`apps/web`), a public "space" frontend (`apps/space`), an
admin app (`apps/admin`), and a Hocuspocus-based realtime collaboration server (`apps/live`) used
**only for Pages**, not for work items.

**What is genuinely, fully implemented (traced UI → store → service → DRF view → model):**

- Workspaces, workspace members, 3-tier roles (Admin/Member/Guest), invitations.
- Projects with identifiers, per-project feature toggles, per-project members and roles, project
  archiving, auto-archive/auto-close automations backed by a real Celery beat job.
- Work items ("issues") with state, priority, multiple assignees, multiple labels, start/target
  dates, estimate points, parent/child (sub-work-items), relations, links, attachments, comments,
  reactions, subscribers, mentions, activity history, per-project sequence IDs, archiving,
  soft-delete + hard-delete job, and draft work items.
- Five layouts (List, Kanban, Calendar, Spreadsheet, Gantt) with **server-side grouping,
  sub-grouping, ordering and cursor pagination**.
- Cycles and Modules with progress/analytics endpoints, archiving, and issue transfer.
- Intake (triage inbox), Pages (collaborative), Views (project + workspace), Favorites, Stickies,
  Recent visits.
- Notifications: in-app (durable `notifications` table) + batched email via a 5-minute Celery beat
  task. Webhooks for project/issue/module/cycle/issue_comment.
- A separate versioned public REST API (`/api/v1/`) with API-token auth and OpenAPI schema.

**The most consequential gaps found (each evidenced in §24):**

1. **No due-date reminders or deadline notifications of any kind.** Zero occurrences of
   "reminder" in `apps/api/plane`; no beat job touches `target_date`.
2. **No URL-encoded filter state.** Filters persist server-side per user, never in the URL, so a
   filtered view is not shareable. `routeFilters` is computed and threaded through the workspace
   layout tree but never consumed.
3. **Workspace-level views support only the Spreadsheet layout** and cannot group.
4. **Bulk property editing is frontend-only in CE** — the store calls
   `bulk-operation-issues/`, an endpoint that does not exist in this repository, and the UI is
   replaced by an upgrade banner (`useBulkOperationStatus = () => false`).
5. **Gantt dependency lines are dead prop plumbing** — `enableDependency` is threaded through six
   components and dropped unused; `getIsCurrentDependencyDragging` is a documented dummy.
6. **Search never touches descriptions or comments** — only `name`, `sequence_id`,
   `project__identifier`, all via `icontains` (no full-text index).
7. **Activity feed is unpaginated.**
8. **Notification preferences gate email only**; in-app notifications are always written, and the
   per-workspace / per-project preference columns are never used.
9. **Guests can PATCH project states** (`StateViewSet.partial_update` allows `ROLE.GUEST`) while
   create/delete are Admin-only.
10. **Two parallel design systems** (`@plane/ui` and `@makeplane/propel`) mid-migration, plus
    duplicated work-item list endpoints (`issues/list/`, `issues/`, `v2/issues/`,
    `issues-detail/`) and duplicated filter systems (legacy `issue_filters.py` +
    new `filters/filterset.py`; legacy `filters` + new `rich_filters` JSON columns).

---

## 2. Repository Architecture

```text
plane-source/
├── apps/
│   ├── api/      Django 5 + DRF + Celery      (the entire backend)
│   ├── web/      React Router 7 SPA + MobX    (the product UI)
│   ├── space/    React Router 7 SPA           (public/deploy boards)
│   ├── admin/    React Router 7 SPA           (instance administration)
│   ├── live/     Node + Hocuspocus + Yjs      (realtime Pages collaboration only)
│   └── proxy/    Caddy                        (edge routing)
└── packages/
    ├── types/ constants/ utils/ hooks/ i18n/ services/ shared-state/ logger/ decorators/
    ├── editor/          TipTap-based rich text + document editors
    ├── ui/              legacy design system  ── being replaced by ↓
    ├── propel/          @makeplane/propel — current design system
    └── tailwind-config/ typescript-config/ codemods/
```

### 2.1 Backend (`apps/api/plane`)

| Package                              | Responsibility                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `db/models/`                         | All ORM models (24 modules, ~4.3k LOC). Soft-delete base.                                                            |
| `app/`                               | The **internal** API consumed by `apps/web` — mounted at `/api/`. `views/`, `serializers/`, `urls/`, `permissions/`. |
| `api/`                               | The **public/versioned** REST API — mounted at `/api/v1/`. API-token auth, `rate_limit.py`.                          |
| `space/`                             | Public (unauthenticated / deploy-board) API — `/api/public/`.                                                        |
| `license/`                           | Instance registration, telemetry — `/api/instances/`.                                                                |
| `authentication/`                    | Session auth, email+password, magic code, OAuth (Google, GitHub, GitLab, Gitea) — `/auth/`.                          |
| `bgtasks/`                           | 33 Celery tasks (activities, notifications, email, exports, cleanup, versions, webhooks).                            |
| `utils/`                             | Filters, grouping, pagination, analytics plotting, exporters, HTML sanitisation.                                     |
| `celery.py`                          | Beat schedule (13 periodic jobs).                                                                                    |
| `middleware/`, `throttles/`, `logs/` | Cross-cutting.                                                                                                       |

URL roots (`apps/api/plane/urls.py`):
`/api/` → app API · `/api/public/` → space · `/api/instances/` → license ·
`/api/v1/` → public API · `/auth/` → authentication · `/api/schema/` → drf-spectacular
(gated by `settings.ENABLE_DRF_SPECTACULAR`).

### 2.2 Frontend (`apps/web`)

- **Routing:** React Router 7 file-config. `app/routes.ts` merges `app/routes/core.ts` with
  `app/routes/extended.ts` via `mergeRoutes()` — the seam where EE injects extra routes. All
  routes nest under `app/layout.tsx`.
- **State:** MobX. `core/store/root.store.ts` composes ~25 domain stores. Work items get their own
  sub-tree (`core/store/issue/`) with one _issues_ store and one _filter_ store per context
  (project, cycle, module, project-view, workspace/global, profile, archived, draft).
- **Data fetching:** SWR for orchestration + service classes (`core/services/**`,
  `packages/services/src/**`) extending `APIService` (axios).
- **Components:** `core/components/**` grouped by domain (~55 top-level folders).

### 2.3 Realtime

`apps/live` runs Hocuspocus over Yjs. Its controllers are `collaboration`, `document`, `health`,
`pdf-export`; its services are `page/` and `pdf-export/`. **There is no work-item document type** —
work-item descriptions are _not_ collaboratively edited.

---

## 3. Workspace Features

**Model:** `apps/api/plane/db/models/workspace.py`

| Entity                                                                    | Notes                                                                                                                 |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Workspace`                                                               | name, slug, owner, logo, organization_size, timezone.                                                                 |
| `WorkspaceMember`                                                         | `role` ∈ `{20 Admin, 15 Member, 5 Guest}` (`ROLE_CHOICES`, line 19), `is_active`, `company_role`, view/display props. |
| `WorkspaceMemberInvite`                                                   | email + role + token.                                                                                                 |
| `Team`                                                                    | **Model exists; no CE views/urls reference it** → dead/EE.                                                            |
| `WorkspaceTheme`                                                          | custom theme payloads.                                                                                                |
| `WorkspaceUserProperties`                                                 | per-user workspace-level filters/display filters/display properties.                                                  |
| `WorkspaceUserLink`, `WorkspaceHomePreference`, `WorkspaceUserPreference` | quick links, home-widget enable/order, sidebar prefs.                                                                 |

**Endpoints** (`apps/api/plane/app/urls/workspace.py`, 41 routes) include: `workspaces/`,
`workspaces/<slug>/`, `invitations/`, `members/`, `members/leave/`, `workspace-members/me/`,
`workspace-views/`, `workspace-themes/`, `user-stats/<user_id>/`, `user-activity/<user_id>/`,
`user-profile/<user_id>/`, `user-issues/<user_id>/`, `labels/`, `states/`, `estimates/`,
`modules/`, `cycles/`, `user-favorites/`, `draft-issues/`, `draft-to-issue/<draft_id>/`,
`quick-links/`, `home-preferences/`, `recent-visits/`, `stickies/`, `sidebar-preferences/`,
`users/notifications/…`.

**Permissions:** `apps/api/plane/app/permissions/workspace.py` +
`allow_permission(..., level="WORKSPACE")` in `permissions/base.py`.

**Frontend:** `apps/web/core/store/workspace/`, `core/components/workspace/`,
settings under `app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/`.

**Status:** Fully implemented. **Limitation:** roles are a fixed 3-value integer enum — no custom
roles, no per-entity ACLs.

---

## 4. Project Features

**Model:** `apps/api/plane/db/models/project.py`

`Project` fields: `name`, `description`/`description_html`/`description_text`, `network`
(0 Secret / 2 Public), `identifier` (≤12 chars, uppercased, unique per workspace, forbidden-char
regex), `default_assignee`, `project_lead`, `emoji`/`icon_prop`/`logo_props`, `cover_image(_asset)`,
`estimate` FK, `archive_in` / `close_in` (0–12 months), `default_state`, `archived_at`, `timezone`,
`external_source`/`external_id`, and **feature toggles**: `module_view`, `cycle_view`,
`issue_views_view`, `page_view`, `intake_view`, `is_time_tracking_enabled`,
`is_issue_type_enabled`, `guest_view_all_features`.

Related: `ProjectMember` (role, `view_props`, `sort_order`), `ProjectMemberInvite`,
`ProjectIdentifier`, `ProjectDeployBoard`, `ProjectPublicMember`, `ProjectUserProperty`
(per-user filters / display_filters / display_properties / **`rich_filters`**).

**Feature toggle UI:** `apps/web/core/components/project/settings/features-list.tsx` exposes only
`cycles`, `modules`, `views`, `pages`, `intake` (all `isPro: false`). `is_time_tracking_enabled`
and `is_issue_type_enabled` have **no CE toggle** → EE-only.

**Project templates:** _not implemented in CE._ There is no template model, no endpoint, and no UI.
`templateId?: string` is declared in `core/components/project/create-project-modal.tsx`,
`core/components/projects/create/root.tsx`, `core/components/issues/issue-modal/modal.tsx` and
`…/provider.tsx` and is **never consumed** — dead prop plumbing for the EE feature. A full
`packages/i18n/src/locales/*/template.json` string bundle ships with no consumer.

**Automations:** `apps/web/core/components/automation/auto-archive-automation.tsx` and
`auto-close-automation.tsx` write `archive_in` / `close_in`; enforced by
`apps/api/plane/bgtasks/issue_automation_task.py::archive_and_close_old_issues`, scheduled daily at
01:00 UTC. Auto-archive only touches items in `completed`/`cancelled` groups whose cycle/module has
ended and whose intake status is resolved.

**Status:** Fully implemented (minus templates/EE toggles).

---

## 5. Task / Work Item Features

**Core model:** `apps/api/plane/db/models/issue.py` (822 lines) — `db_table = "issues"`.

| Capability              | Implementation                                                                                                                                                                                                                                     | Status                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Create                  | `IssueViewSet.create` (`views/issue/base.py:405`, `@allow_permission([ADMIN, MEMBER])`)                                                                                                                                                            | Full                                                                                              |
| Read                    | `list`, `retrieve`, `IssueListEndpoint`, `IssuePaginatedViewSet` (v2), `IssueDetailEndpoint`, `IssueDetailIdentifierEndpoint`                                                                                                                      | Full (duplicated, see §24)                                                                        |
| Update                  | `partial_update` (`base.py:628`, ADMIN/MEMBER **or creator**)                                                                                                                                                                                      | Full                                                                                              |
| Delete                  | `destroy` (`base.py:717`, **ADMIN or creator only**) — soft delete                                                                                                                                                                                 | Full                                                                                              |
| Duplicate               | Client-side only: `duplicateIssuePayload = omit({...issue, name: "… (copy)", sourceIssueId}, ["id"])` in `quick-action-dropdowns/project-issue.tsx:71`; opens a prefilled create modal                                                             | Partial (no relations/comments/sub-items copied)                                                  |
| Assignees               | `IssueAssignee` M2M through-table — **multiple assignees**                                                                                                                                                                                         | Full                                                                                              |
| State                   | `state` FK → `State`                                                                                                                                                                                                                               | Full                                                                                              |
| Priority                | `priority` CharField, 5 fixed choices                                                                                                                                                                                                              | Full (not extensible)                                                                             |
| Labels                  | `IssueLabel` M2M → `Label` — **multiple labels**                                                                                                                                                                                                   | Full                                                                                              |
| Start / due date        | `start_date`, `target_date` (`DateField`)                                                                                                                                                                                                          | Full                                                                                              |
| Estimate                | `estimate_point` FK → `EstimatePoint`; legacy `point` IntegerField (0–12) still present                                                                                                                                                            | Full + legacy debt                                                                                |
| Cycle                   | `CycleIssue` (one cycle per item — see §14)                                                                                                                                                                                                        | Full                                                                                              |
| Modules                 | `ModuleIssue` (many modules per item)                                                                                                                                                                                                              | Full                                                                                              |
| Parent / sub-items      | `parent` self-FK; `SubIssuesEndpoint`                                                                                                                                                                                                              | Full                                                                                              |
| Relations               | `IssueRelation` (`relation_type`)                                                                                                                                                                                                                  | Partial (see §17)                                                                                 |
| Description             | `description_html` / `description_json` / `description_stripped` / `description_binary`                                                                                                                                                            | Full                                                                                              |
| Attachments             | `FileAsset` (`IssueAttachmentEndpoint` v1 + `IssueAttachmentV2Endpoint` presigned)                                                                                                                                                                 | Full (duplicated)                                                                                 |
| Links                   | `IssueLink` + `work_item_link_task.py` (OG metadata)                                                                                                                                                                                               | Full                                                                                              |
| Comments                | `IssueComment` (+ `parent` FK)                                                                                                                                                                                                                     | Full; replies backend-only                                                                        |
| Reactions               | `IssueReaction`, `CommentReaction`                                                                                                                                                                                                                 | Full                                                                                              |
| Mentions                | `IssueMention` + `notification_task.extract_mentions` (parses `<mention-component entity_name="user_mention">`)                                                                                                                                    | Full                                                                                              |
| Subscribers             | `IssueSubscriber`; assignees auto-subscribed (`issue_activities_task.py:396-408`)                                                                                                                                                                  | Full                                                                                              |
| Activity / history      | `IssueActivity` + `issue_activities_task.py` (`ISSUE_ACTIVITY_MAPPER`, ~20 trackers)                                                                                                                                                               | Full, unpaginated                                                                                 |
| Versions                | `IssueVersion` (property snapshot) + `IssueDescriptionVersion`                                                                                                                                                                                     | Description versions: full (with restore). `IssueVersion`: **backend-only, no frontend consumer** |
| Work item ID            | `IssueSequence` + `sequence_id`, allocated under `pg_advisory_xact_lock` per project                                                                                                                                                               | Full                                                                                              |
| Work item URL           | `/:workspaceSlug/browse/:workItem` + `IssueDetailIdentifierEndpoint` (`PROJ-123`)                                                                                                                                                                  | Full                                                                                              |
| Custom fields           | **Not implemented in CE** — no `IssueProperty` model exists                                                                                                                                                                                        | Missing                                                                                           |
| Work item types / Epics | `IssueType` + `ProjectIssueType` models exist; `type` FK on `Issue`; used only by `/api/v1/` serializer defaulting. **No CE CRUD endpoints, no epic routes.** `EIssueServiceType.EPICS` store + `core/components/epic-modal/` exist as scaffolding | Backend-only / EE                                                                                 |
| Bulk delete             | `BulkDeleteIssuesEndpoint` (ADMIN)                                                                                                                                                                                                                 | Full                                                                                              |
| Bulk archive            | `BulkArchiveIssuesEndpoint`                                                                                                                                                                                                                        | Full                                                                                              |
| Bulk property update    | Store calls `bulk-operation-issues/` — **endpoint absent from this repo**; UI renders `BulkOperationsUpgradeBanner`                                                                                                                                | **Disabled (EE)**                                                                                 |
| Bulk date update        | `IssueBulkUpdateDateEndpoint` (`issue-dates/`) — used by Gantt drag                                                                                                                                                                                | Full                                                                                              |
| Drag & drop             | `@atlaskit/pragmatic-drag-and-drop` across list, kanban, calendar, gantt                                                                                                                                                                           | Full                                                                                              |
| Ordering                | `sort_order` FloatField; manual order via `order_by: "sort_order"`                                                                                                                                                                                 | Full                                                                                              |
| Archive / restore       | `IssueArchiveViewSet` (`archive` / `unarchive`); UI restricts archiving to `ARCHIVABLE_STATE_GROUPS = [completed, cancelled]`                                                                                                                      | Full                                                                                              |
| Drafts                  | `DraftIssue` model (`db/models/draft.py`) + `draft-issues/` + `draft-to-issue/<id>/`                                                                                                                                                               | Full                                                                                              |
| Soft delete + purge     | `SoftDeletionManager`; `bgtasks/deletion_task.hard_delete` daily 00:00 UTC; `deleted-issues/` endpoint                                                                                                                                             | Full                                                                                              |

**Default manager semantics (important for anyone extending):**
`Issue.issue_objects` (`issue.py:92`) excludes triage-group items, archived items, items in
archived projects, and drafts. `Issue.objects` does not.

**`Issue.save()` side effects:** assigns a default state when none given (`_ensure_default_state`),
syncs `completed_at` on state-group transitions (`_sync_completed_at`), allocates `sequence_id`
under an advisory lock, sets `sort_order = max + 10000`, and strips HTML into
`description_stripped`.

---

## 6. Task Views

Layouts are enumerated in `packages/constants/src/issue/layout.ts`:
`list`, `kanban`, `calendar`, `spreadsheet`, `gantt`.

Roots: `apps/web/core/components/issues/issue-layouts/roots/`

| View                                                                                | Route                                                            | Root component                                                                | Store                             | Primary endpoint                             | Layouts              | Group by                                                                              | Order by                                                                 |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Project work items                                                                  | `:workspaceSlug/projects/:projectId/issues`                      | `project-layout-root.tsx`                                                     | `EIssuesStoreType.PROJECT`        | `.../projects/<id>/v2/issues/`               | all 5                | state, priority, cycle, module, labels, assignees, created_by (+ sub-group in kanban) | sort_order, -created_at, -updated_at, start_date, -priority, target_date |
| Cycle                                                                               | `.../cycles/:cycleId`                                            | `cycle-layout-root.tsx`                                                       | `CYCLE`                           | `.../cycles/<id>/cycle-issues/`              | all 5                | same                                                                                  | same                                                                     |
| Module                                                                              | `.../modules/:moduleId`                                          | `module-layout-root.tsx`                                                      | `MODULE`                          | `.../modules/<id>/issues/`                   | all 5                | same                                                                                  | same                                                                     |
| Project view                                                                        | `.../views/:viewId`                                              | `project-view-layout-root.tsx`                                                | `PROJECT_VIEW`                    | project issues + saved view filters          | all 5                | same                                                                                  | same                                                                     |
| Archived                                                                            | `.../archives/issues`                                            | `archived-issue-layout-root.tsx`                                              | `ARCHIVED`                        | `.../archived-issues/`                       | **list only**        | state, cycle, module, priority, labels, assignees, created_by                         | sort_order, -created_at, -updated_at, start_date, -priority              |
| Workspace / Global views (`all-issues`, `assigned`, `created`, `subscribed`, saved) | `:workspaceSlug/workspace-views/:globalViewId`                   | `all-issue-layout-root.tsx` → `views/helper.tsx` → `WorkspaceSpreadsheetRoot` | `GLOBAL`                          | `workspaces/<slug>/issues/`                  | **spreadsheet only** | **none** (`canGroup: false`)                                                          | limited                                                                  |
| My Work (profile)                                                                   | `:workspaceSlug/profile/:userId/(assigned\|created\|subscribed)` | profile roots                                                                 | `PROFILE`                         | `workspaces/<slug>/user-issues/<user_id>/`   | list, kanban         | state_group, priority, project, labels                                                | as above                                                                 |
| Drafts                                                                              | `:workspaceSlug/drafts`                                          | `workspace-draft` store/components                                            | `workspaces/<slug>/draft-issues/` | list                                         | —                    | —                                                                                     |
| Intake                                                                              | `.../projects/:projectId/intake`                                 | `core/components/inbox/`                                                      | `INTAKE`                          | `.../intakes/…`                              | dedicated split-pane | status tabs                                                                           | —                                                                        |
| Peek overview                                                                       | overlay on any layout                                            | `issues/peek-overview/`                                                       | `issueDetail`                     | `.../issues/<id>/`                           | —                    | —                                                                                     | —                                                                        |
| Full detail                                                                         | `.../issues/:issueId`, `:workspaceSlug/browse/:workItem`         | `issues/issue-detail/root.tsx`                                                | `issueDetail`                     | `.../issues/<id>/`, `work-items/<PROJ>-<n>/` | —                    | —                                                                                     | —                                                                        |

**Actions available in every layout** (`issue-layouts/quick-action-dropdowns/helper.tsx`): edit,
make a copy, open in new tab, copy link, remove from cycle, remove from module, archive, restore,
delete. Inline property editing via `issue-layouts/properties/all-properties.tsx` and
`core/components/dropdowns/**`.

**Spreadsheet columns** (`issue-layouts/spreadsheet/columns/`): assignee, attachment, created-on,
cycle, due-date, estimate, label, link, module, priority, start-date, state, sub-issue, updated-on.

**Limitations:** Calendar and Gantt expose only `key` + `issue_type` display properties. Calendar
has no ordering options. Global views cannot group and cannot use any layout but spreadsheet.

---

## 7. Search & Filters

### 7.1 Search

Two endpoints, both in `apps/api/plane/app/views/search/`:

- `GlobalSearchEndpoint` (`base.py:46`) — `MODELS_MAPPER` covers workspace, project, issue, cycle,
  module, page, view, intake. Work-item matching (`filter_issues`, `base.py:83`) uses exactly
  `["name", "sequence_id", "project__identifier"]` with `icontains`, plus a `\b\d+\b` regex to pull
  sequence numbers out of the query. Results capped at 100. Scope is workspace-wide unless
  `workspace_search=false` + `project_id`.
- `SearchEndpoint` (`base.py:305`) — entity-typed search used by pickers (parent, relations,
  mentions, "add existing work item").
- `apps/api/plane/utils/issue_search.py::search_issues` — same three fields, used by sub-endpoints.
- Public API: `/api/v1/workspaces/<slug>/work-items/search/`.

**Not searchable anywhere:** `description_stripped`, comments, attachments, activity. No
PostgreSQL full-text index, trigram index, or external search engine is configured.

### 7.2 Filters

Plane currently ships **two filter systems side by side**:

1. **Legacy query-param filters** — `apps/api/plane/utils/issue_filters.py` (29 filter functions:
   state, state_group, estimate_point, priority, parent, labels, assignees, mentions, created_by,
   name, created_at, updated_at, start_date, target_date, completed_at, issue_state_type, project,
   cycle, module, intake/inbox status, sub_issue toggle, subscriber, start_target_date, logged_by;
   plus relative-date parsing in `string_date_filter`).
2. **`django-filter` FilterSet** — `apps/api/plane/utils/filters/filterset.py::IssueFilterSet`,
   attached to `IssueListEndpoint`, `IssueViewSet`, `IssueDetailEndpoint`, `CycleIssueViewSet`.
   Supports `__in` variants, `__range`, `is_archived`, and date-vs-datetime coercion (see the long
   comment at `filterset.py:171-190`). `apps/api/plane/utils/filters/filter_migrations.py`
   converts stored legacy filters to the new expression format.

Correspondingly the DB has both `filters` (legacy) and **`rich_filters`** JSON columns on
`ProjectUserProperty`, `CycleUserProperties`, `ModuleUserProperties`, `IssueView`,
`WorkspaceUserProperties`, and `ExporterHistory`.

**Available filter properties per page** are declared in
`packages/constants/src/issue/filter.ts::ISSUE_DISPLAY_FILTERS_BY_PAGE`:

| Page type                            | Filters                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `issues` (project/cycle/module/view) | priority, state_group, state_id, cycle_id, module_id, assignee_id, mention_id, created_by_id, label_id, start_date, target_date |
| `my_issues` (global views)           | priority, state_group, label_id, assignee_id, created_by_id, subscriber_id, project_id, start_date, target_date                 |
| `profile_issues`                     | priority, state_group, label_id, start_date, target_date                                                                        |
| `archived_issues`                    | priority, state_group, state_id, cycle_id, module_id, assignee_id, created_by_id, label_id, start_date, target_date             |
| `sub_work_items`                     | priority, state_id, assignee_id, start_date, target_date                                                                        |

**Answers to the brief's specific questions:**

| Question                         | Answer                                                                                                                                                                                     | Evidence                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Frontend or backend?             | **Backend.** All filtering/grouping/ordering/pagination happens in SQL.                                                                                                                    | `utils/grouper.py`, `utils/paginator.py`, `IssueFilterSet` |
| Combinable?                      | Yes — AND across properties, OR (`__in`) within a property. `BaseFilterSet.build_combined_q` composes a single `Q`.                                                                        | `filterset.py:55`                                          |
| Saveable?                        | Yes, as `IssueView` (project or workspace scope) with `filters` + `rich_filters` + `display_filters` + `display_properties`, `access` (Private/Public), `is_locked`.                       | `db/models/view.py:58`                                     |
| Persistent?                      | Yes, **server-side per user** via `ProjectUserProperty` / `CycleUserProperties` / `ModuleUserProperties` / `WorkspaceUserProperties`. Kanban collapse state is per-user in `localStorage`. | `core/store/issue/project/filter.store.ts:137-166`         |
| In the URL?                      | **No.** `all-issue-layout-root.tsx:75` builds `routeFilters` from `useSearchParams()` and passes it to `views/helper.tsx` → `WorkspaceSpreadsheetRoot`, which **never destructures it**.   | `spreadsheet/roots/workspace-root.tsx:31-40`               |
| Global or project-scoped search? | Both: `GlobalSearchEndpoint` defaults to workspace scope, narrows with `workspace_search=false`.                                                                                           | `search/base.py:271`                                       |

---

## 8. Status (State) System

**Model:** `apps/api/plane/db/models/state.py`

- `StateGroup` (TextChoices): `backlog`, `unstarted`, `started`, `completed`, `cancelled`,
  `triage`. **Fixed — not extensible.**
- `State`: `name`, `description`, `color`, `slug`, `sequence` (float, `+15000` on create),
  `group`, `is_triage`, `default`, `external_source`/`external_id`. Unique on
  `(name, project)` while not deleted. `ordering = ("sequence",)`.
- Three managers: `objects` (excludes triage), `all_state_objects`, `triage_objects`.
- `DEFAULT_STATES` seeds each project with Backlog (default) → Todo → In Progress → Done →
  Cancelled → Triage, with colours and sequences 15000…65000.

**Lifecycle as actually implemented:** a work item moves between states **freely** — there are no
transition rules, no guards, no required fields, no approval steps. The only automatic behaviour is
in `Issue._sync_completed_at()`: entering a `completed`-group state stamps `completed_at`; leaving
it clears it. `blocked_by` relations do **not** block a state change.

**Endpoints:** `.../projects/<id>/states/` (list/create), `.../states/<pk>/` (retrieve/update/
delete), `.../states/<pk>/mark-default/`, plus `workspaces/<slug>/states/` (workspace-wide list)
and `IntakeStateEndpoint`.

**Permissions (`views/state/base.py`):** `create` **ADMIN**, `destroy` **ADMIN**,
`mark_as_default` **ADMIN**, `list` ADMIN/MEMBER/GUEST, **`partial_update` ADMIN/MEMBER/GUEST**
(line 61) — a Guest can rename, recolour, resequence or re-group any state. Flagged in §24.

**Workflows / transition rules:** not in CE. `apps/web/core/components/workflow/state-option.tsx`
accepts `filterAvailableStateIds`, `isForWorkItemCreation`, `alwaysAllowStateChange` and
**ignores all three** — it renders a plain `Combobox.Option`. A full
`packages/i18n/src/locales/*/workflow.json` bundle ships with no CE consumer.

---

## 9. Priority System

- **Model:** `Issue.priority` — `CharField(max_length=30, choices=PRIORITY_CHOICES,
default="none")` with `urgent | high | medium | low | none` (`issue.py:107-113`). Hard-coded.
- **Backend filter:** `IssueFilterSet.Meta.fields["priority"] = ["exact", "in"]`, and
  `issue_filters.filter_priority`.
- **Ordering:** `-priority` / `priority`. `apps/api/plane/utils/order_queryset.py` maps priority to
  a deterministic rank so `-priority` sorts urgent→none rather than alphabetically.
- **Grouping:** `group_by: "priority"` and `sub_group_by: "priority"` (kanban).
- **UI:** `packages/constants/src/issue/filter.ts::ISSUE_PRIORITY_FILTERS` (icons + colour classes),
  `apps/web/core/components/dropdowns/priority.tsx`,
  `issue-layouts/spreadsheet/columns/priority-column.tsx`.
- **Custom priorities:** not supported anywhere.

---

## 10. Assignment & Ownership

| Concept                  | Implementation                                                                                                              | Status    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------- |
| Multiple assignees       | `Issue.assignees` M2M through `IssueAssignee`                                                                               | Full      |
| Single assignee          | Not a separate concept                                                                                                      | n/a       |
| Team assignment          | `Team` model exists but has **no CE views/urls**                                                                            | Dead / EE |
| Creator                  | `created_by` on `BaseModel`; filter `created_by_id`; grouping `created_by`                                                  | Full      |
| Watchers / followers     | `IssueSubscriber` + `.../issues/<id>/subscribe/` (`subscription_status` / `subscribe` / `unsubscribe`)                      | Full      |
| Default assignee         | `Project.default_assignee`                                                                                                  | Full      |
| Project lead             | `Project.project_lead`                                                                                                      | Full      |
| Module lead & members    | `Module.lead`, `Module.members` (M2M via `ModuleMember`)                                                                    | Full      |
| Cycle owner              | `Cycle.owned_by`                                                                                                            | Full      |
| Auto-subscribe on assign | `issue_activities_task.py:396-408` bulk-creates `IssueSubscriber` rows for new assignees                                    | Full      |
| Assignment notification  | `sender = "in_app:issue_activities:assigned"` (`notification_task.py:314`)                                                  | Full      |
| Assignment history       | `track_assignees` (`issue_activities_task.py:357`) writes add/remove `IssueActivity` rows                                   | Full      |
| Ownership permissions    | `allow_permission(..., creator=True, model=Issue)` lets the creator edit/delete their own item even below the required role | Full      |

---

## 11. Dates & Deadlines

| Field                       | Model                      | Type                                                           |
| --------------------------- | -------------------------- | -------------------------------------------------------------- |
| `start_date`, `target_date` | `Issue`                    | `DateField`                                                    |
| `completed_at`              | `Issue`                    | `DateTimeField`, auto-managed by `_sync_completed_at`          |
| `created_at`, `updated_at`  | `BaseModel`                | `DateTimeField`                                                |
| `archived_at`               | `Issue`                    | `DateField`                                                    |
| `start_date`, `end_date`    | `Cycle`                    | **`DateTimeField`** (note the type mismatch with Issue/Module) |
| `start_date`, `target_date` | `Module`                   | `DateField`                                                    |
| `timezone`                  | `Project`, `Cycle`, `User` | `CharField`                                                    |

**Overdue detection.** There is no persisted "overdue" flag. It is recomputed per query:
`target_date__lt=<now>` combined with `~Q(state__group__in=["completed", "cancelled"])` — e.g.
`UserWorkspaceDashboardEndpoint` (`views/workspace/base.py:290`). The frontend re-derives it for
badge colouring in the date dropdowns / spreadsheet due-date column.

**Timezone handling.** `TimezoneMixin` activates the user's profile timezone; `IssueFilterSet`
compares `created_at__date` in the active timezone. The code comment at
`utils/filters/filterset.py:180-184` documents a known off-by-one-day mismatch when the user's
profile timezone differs from their browser's.

**Reminders / deadline notifications:** **none.** `grep -rni "reminder" apps/api/plane --include=*.py`
returns nothing; no Celery beat entry references `target_date`; no recurring-work-item model exists.

**Date validation:** `CycleDateCheckEndpoint` prevents overlapping cycles;
`IssueBulkUpdateDateEndpoint.validate_dates` enforces `start_date <= target_date` on Gantt drags.

---

## 12. Notifications

### 12.1 Data model (`apps/api/plane/db/models/notification.py`)

- `Notification` — workspace, project, `entity_identifier`, `entity_name` (always `"issue"` in the
  current code), `title`, `message*`, `sender` (e.g. `in_app:issue_activities:assigned`),
  `triggered_by`, `receiver`, `read_at`, `snoozed_till`, `archived_at`, `data` JSON. Nine indexes.
- `UserNotificationPreference` — `property_change`, `state_change`, `comment`, `mention`,
  `issue_completed`, plus **unused** `workspace` and `project` FKs.
- `EmailNotificationLog` — the batching queue: `processed_at`, `sent_at`.

### 12.2 Trigger path

```text
IssueViewSet / CycleIssueViewSet / IssueCommentViewSet / …
  └─ issue_activity.delay(type, requested_data, current_instance, …)        [bgtasks/issue_activities_task.py:1504]
       ├─ ISSUE_ACTIVITY_MAPPER → track_name/priority/state/assignees/…     → IssueActivity rows
       ├─ IssueSubscriber.bulk_create(assignees)                            → auto-subscribe
       ├─ webhook_activity.delay(...)                                       → bgtasks/webhook_task.py
       └─ notifications.delay(...)                                          [bgtasks/notification_task.py:191]
            ├─ extract_mentions / extract_comment_mentions (BeautifulSoup over <mention-component>)
            ├─ Notification.objects.bulk_create(...)        ← ALWAYS, ignores preferences
            └─ EmailNotificationLog.objects.bulk_create(...) ← ONLY if the preference allows

Celery beat "check-every-five-minutes-to-send-email-notifications"  [celery.py:47]
  └─ stack_email_notification()          [bgtasks/email_notification_task.py:47]
       └─ send_email_notification(...)   groups unprocessed logs per receiver+issue, renders
                                         templates/emails/notifications/issue-updates.html
```

`notifications()` short-circuits for cycle/module/reaction/vote/draft activity types
(`notification_task.py:203-218`), so **adding a work item to a cycle or module produces no
notification**. Description edits are explicitly skipped (`notification_task.py:325-327`).

### 12.3 Coverage

| Notification                  | In-app                    | Email                                                              | Push |
| ----------------------------- | ------------------------- | ------------------------------------------------------------------ | ---- |
| Assigned to you               | Yes (`sender=…:assigned`) | Yes (`property_change`)                                            | No   |
| Mentioned in description      | Yes                       | Yes (`mention`)                                                    | No   |
| Mentioned in comment          | Yes                       | Yes (`mention`)                                                    | No   |
| New comment                   | Yes                       | Yes (`comment`)                                                    | No   |
| State changed                 | Yes                       | Yes (`state_change` / `issue_completed`)                           | No   |
| Any other property change     | Yes                       | Yes (`property_change`)                                            | No   |
| Description changed           | **No**                    | No                                                                 | No   |
| Added to cycle / module       | **No**                    | No                                                                 | No   |
| Due date approaching / passed | **No**                    | **No**                                                             | No   |
| Cycle starting / ending       | **No**                    | No                                                                 | No   |
| Project events                | **No**                    | No                                                                 | No   |
| Workspace/project invitation  | n/a                       | Yes (`workspace_invitation_task.py`, `project_invitation_task.py`) | No   |

**No push notifications exist.** There is a `Device` model (`db/models/device.py`) but no
registration endpoint or dispatch path in CE.

### 12.4 Endpoints & UI

`workspaces/<slug>/users/notifications/` (list, with `snoozed`, `type`, `read`, `archived` params),
`…/<pk>/` (PATCH — only `snoozed_till` is honoured, `notification/base.py:159`),
`…/<pk>/read/` (mark read/unread), `…/<pk>/archive/` (archive/unarchive),
`…/unread/`, `…/mark-all-read/`, and `users/me/notification-preferences/` (GET/PATCH, **no slug** →
global only).

Frontend: `apps/web/core/components/workspace-notifications/`,
`core/store/notifications/`, route `:workspaceSlug/notifications`.
Tabs `all` / `mentions` and filters `assigned` / `created` / `subscribed`
(`packages/constants/src/notification.ts`).

---

## 13. Comments & Collaboration

| Feature                        | Path                                                                                                                                                             | Status                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Comments                       | `IssueComment` model; `IssueCommentViewSet` (`views/issue/comment.py`); UI `core/components/comments/` + `issues/issue-detail/issue-activity/`                   | Full                     |
| Threaded replies               | `IssueComment.parent` self-FK, exposed by `IssueCommentSerializer` (`fields = "__all__"`). **No reply UI anywhere in `apps/web`.**                               | Backend-only             |
| Internal vs external comments  | `IssueComment.access` (`INTERNAL` / `EXTERNAL`) — used by the public space app                                                                                   | Partial                  |
| Edit tracking                  | `edited_at`; `ChangeTrackerMixin` with `TRACKED_FIELDS`                                                                                                          | Full                     |
| Comment reactions              | `CommentReaction` + `comments/<id>/reactions/`                                                                                                                   | Full                     |
| Work-item reactions            | `IssueReaction` + `issues/<id>/reactions/`                                                                                                                       | Full                     |
| Mentions                       | `<mention-component entity_name="user_mention">` in HTML, parsed server-side; `IssueMention` rows; mention picker in `packages/editor`                           | Full                     |
| Attachments                    | `FileAsset` + v1 and v2 (presigned) endpoints; `file_asset_task` cleans unuploaded assets daily                                                                  | Full                     |
| Activity feed                  | `IssueActivityEndpoint` merges `IssueActivity` + `IssueComment` sorted by `created_at`; `activity_type=issue-property` / `issue-comment` narrows it              | Full but **unpaginated** |
| Change history (properties)    | `IssueVersion` snapshots via `bgtasks/issue_version_sync.py`                                                                                                     | Backend-only             |
| Change history (description)   | `IssueDescriptionVersion` + `WorkItemDescriptionVersionEndpoint`; UI `core/components/core/description-versions/` **with restore**                               | Full                     |
| User presence / live cursors   | **Pages only** (`apps/live`, Hocuspocus/Yjs)                                                                                                                     | Missing for work items   |
| Realtime work-item description | **No.** `core/components/editor/rich-text/description-input/root.tsx` uses a debounced autosave + an SWR `swrDescription` prop documented as _"pseudo realtime"_ | Partial                  |
| Comment permissions            | create: ADMIN/MEMBER/GUEST; update/delete: **ADMIN or creator** (`comment.py:109,144`)                                                                           | Full                     |

Comment HTML is sanitised server-side by `validate_html_content` (`utils/content_validator.py`)
in `IssueCommentSerializer.validate`.

---

## 14. Cycles

**Model:** `apps/api/plane/db/models/cycle.py` — `Cycle`, `CycleIssue`, `CycleUserProperties`.

- Fields: `name`, `description`, `start_date`/`end_date` (**DateTimeField**), `owned_by`,
  `view_props`, `sort_order`, `progress_snapshot` JSON, `archived_at`, `logo_props`, `timezone`,
  `version`, `external_source`/`external_id`.
- **Status is not stored** — it is annotated per query in `CycleViewSet.list`
  (`views/cycle/base.py:153-164`):
  `start_date <= now <= end_date` → `CURRENT`; `start_date > now` → `UPCOMING`;
  `end_date < now` → `COMPLETED`; otherwise `DRAFT`.
- `CycleIssue` is treated as one-cycle-per-item by the endpoints and store (adding to a new cycle
  replaces the existing membership), unlike `ModuleIssue`.

**Endpoints:** `cycles/`, `cycles/<pk>/`, `cycles/<id>/cycle-issues/`,
`cycles/<id>/cycle-issues/<issue_id>/`, `cycles/date-check/`, `user-favorite-cycles/`,
`cycles/<id>/transfer-issues/`, `cycles/<id>/user-properties/`, `cycles/<id>/archive/`,
`archived-cycles/`, `cycles/<id>/progress/`, `cycles/<id>/analytics/`, plus
`workspaces/<slug>/cycles/` (workspace-wide list, drives Active Cycles).

**Completion:** there is **no explicit "complete cycle" action**. Closure is implicit (end date
passes). `TransferCycleIssueEndpoint` (+ `utils/cycle_transfer_issues.py`) moves incomplete items
into another cycle. `progress_snapshot` is the persisted burndown snapshot.

**Frontend:** `core/store/cycle.store.ts`, `cycle_filter.store.ts`,
`core/components/cycles/`, `core/components/active-cycles/`, routes
`.../cycles` and `.../cycles/:cycleId`.

**Notifications:** none — cycle activity types are excluded in `notification_task.py:203-218`.
**Workspace-level Active Cycles** renders `workspace-active-cycles-upgrade.tsx` in CE → EE feature.

---

## 15. Modules

**Model:** `apps/api/plane/db/models/module.py` — `Module`, `ModuleMember`, `ModuleIssue`,
`ModuleLink`, `ModuleUserProperties`.

- **`status` is a real stored field** (`ModuleStatus` TextChoices), unlike Cycle's derived status.
- `lead` FK, `members` M2M, `start_date`/`target_date` (`DateField`), `description_html`,
  `view_props`, `sort_order`, `archived_at`, `logo_props`.
- A work item may belong to **multiple modules** (`ModuleIssue`), unlike cycles.

**Endpoints:** `modules/`, `modules/<pk>/`, `issues/<issue_id>/modules/` (set modules for an item),
`modules/<id>/issues/`, `modules/<id>/issues/<issue_id>/`, `modules/<id>/module-links/`,
`user-favorite-modules/`, `modules/<id>/user-properties/`, `modules/<id>/archive/`,
`archived-modules/`, plus `workspaces/<slug>/modules/`.

**Progress/statistics:** computed as annotations in `ModuleViewSet` (counts per state group);
there is **no dedicated `modules/<id>/progress/` or `/analytics/` endpoint** — an asymmetry with
Cycles.

**Frontend:** `core/store/module.store.ts`, `module_filter.store.ts`,
`core/components/modules/`, `core/store/timeline/modules-timeline.store.ts` (module Gantt).

**Notifications:** none (excluded alongside cycles).

---

## 16. Labels

**Model:** `apps/api/plane/db/models/label.py` — extends `WorkspaceBaseModel`, so `project` is
**nullable**: the schema already supports workspace-level labels via two partial unique constraints
(`unique_name_when_project_null_and_not_deleted` and `unique_project_name_when_not_deleted`).
Fields: `parent` self-FK (label hierarchy), `name`, `description`, `color`, `sort_order`
(`+10000` on create), `external_source`/`external_id`.

**Endpoints:** `.../projects/<id>/issue-labels/` (list/create), `.../issue-labels/<pk>/`,
`.../bulk-create-labels/`, and `workspaces/<slug>/labels/` (**read-only aggregation** across the
user's projects).

**Permissions:** create / update / delete are **ADMIN-only** (`views/issue/label.py:43,58,85,91`).
That means a Member cannot create a label while tagging a work item.

**Frontend:** `core/store/label.store.ts`, `core/components/labels/`,
`issues/issue-layouts/properties/label-dropdown.tsx`, `issues/issue-detail/label/`.

**Status:** project-scoped labels — full. **Workspace-level labels and label hierarchy are
schema-only**: no CE endpoint creates a `project=NULL` label, and no UI reads or sets `parent`.

---

## 17. Dependencies & Relationships

**Model:** `IssueRelation` (`issue.py:296`) with `IssueRelationChoices`:
`duplicate`, `relates_to`, `blocked_by`, `start_before`, `finish_before`, `implemented_by`,
plus a `_RELATION_PAIRS` table giving the inverse names
(`blocking`, `start_after`, `finish_after`, `implements`).
`apps/api/plane/utils/issue_relation_mapper.py` maps display direction ↔ stored direction.

`IssueRelationViewSet.list` (`views/issue/relation.py:44-100`) computes **eight** buckets:
blocking, blocked_by, duplicate (both directions), relates_to (both directions), start_after,
start_before, finish_after, finish_before.

**Frontend exposes only four.** `packages/types/src/issues/issue_relation.ts:17`:

```ts
export type TIssueRelationTypes = "blocking" | "blocked_by" | "duplicate" | "relates_to";
```

and `apps/web/core/components/relations/index.tsx::ISSUE_RELATION_OPTIONS` defines exactly those
four. So **`start_before`/`start_after`, `finish_before`/`finish_after`, and
`implemented_by`/`implements` are backend-only.**

| Feature                         | Status                                                                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Parent / child (sub-work-items) | Full                                                                                                                                                                                                                                                                                                                                                                                      | `Issue.parent`; `SubIssuesEndpoint`; `issue-detail-widgets/sub-issues/` |
| Relations CRUD                  | Full for 4 of 8 types                                                                                                                                                                                                                                                                                                                                                                     | `relation.py`, `issue-detail-widgets/relations/`                        |
| Blocking semantics enforced     | **No** — purely informational; nothing prevents completing a blocked item                                                                                                                                                                                                                                                                                                                 | no guard in `IssueViewSet.partial_update` or `Issue.save`               |
| Gantt dependency arrows         | **Dead code in CE** — `enableDependency` is passed through `root.tsx → chart/root.tsx → chart/main-content.tsx → blocks/blocks-list.tsx → blocks/block.tsx → helpers/draggable.tsx`, where `ChartDraggable` destructures every other prop and drops it. `base-timeline.store.ts:344` reads: _"Dummy method to return if the current Block's dependency is being dragged"_ → `() => false` | as cited                                                                |
| Scheduling / critical path      | Missing                                                                                                                                                                                                                                                                                                                                                                                   | no code                                                                 |
| `IssueBlocker` model            | **Dead** — declared in `issue.py:258` and exported from `db/models/__init__.py`; zero references outside migrations                                                                                                                                                                                                                                                                       | `grep IssueBlocker`                                                     |
| Cross-project relations         | Supported (relations query `Issue.issue_objects.filter(workspace__slug=slug)`)                                                                                                                                                                                                                                                                                                            | `relation.py:102`                                                       |
| Sub-item depth limit            | None enforced server-side                                                                                                                                                                                                                                                                                                                                                                 | no check in `SubIssuesEndpoint.post`                                    |
| Cycle rollup of sub-items       | Not implemented                                                                                                                                                                                                                                                                                                                                                                           | —                                                                       |

---

## 18. Dashboard & Analytics

### 18.1 Home ("dashboard") — `:workspaceSlug`

`apps/web/core/components/home/home-dashboard-widgets.tsx` defines `HOME_WIDGETS_LIST`:

| Widget key       | Component              | Status                                                                |
| ---------------- | ---------------------- | --------------------------------------------------------------------- |
| `quick_links`    | `DashboardQuickLinks`  | Implemented (`workspaces/<slug>/quick-links/`)                        |
| `recents`        | `RecentActivityWidget` | Implemented (`workspaces/<slug>/recent-visits/`, `RecentVisit` model) |
| `my_stickies`    | `StickiesWidget`       | Implemented (`Sticky` model)                                          |
| `new_at_plane`   | **`component: null`**  | **Declared, not implemented**                                         |
| `quick_tutorial` | **`component: null`**  | **Declared, not implemented**                                         |

Widget enable/order persists in `WorkspaceHomePreference` via `workspaces/<slug>/home-preferences/`.
None of these widgets show work-item metrics.

### 18.2 Orphaned legacy dashboard system

`apps/web/core/services/dashboard.service.ts` calls `/api/dashboard/<id>/widgets/<widgetId>/` and
`getWidgetStats`. **No such route exists in `apps/api`** (the only match for "dashboard" in
`plane/app/urls/` is `users/me/workspaces/<slug>/dashboard/`). `DashboardStore` is still
instantiated in `core/store/root.store.ts:30` and exposed via `core/hooks/store/use-dashboard.ts`,
but **nothing in `apps/web` calls `useDashboard`**. This is dead code from a removed feature.

`UserWorkspaceDashboardEndpoint` (`views/workspace/base.py:233`) still serves a rich payload
(activity heatmap, completed-per-week, assigned/pending/completed counts, due-this-week,
state distribution, overdue list, upcoming list) — currently with no first-class CE consumer.

### 18.3 Analytics — `:workspaceSlug/analytics/:tabId`

Endpoints (`apps/api/plane/app/urls/analytic.py`):

| Endpoint                                                | Purpose                                                                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `workspaces/<slug>/analytics/`                          | Legacy pivot: `x_axis`/`y_axis`/`segment` over work items (`utils/analytics_plot.py`)                             |
| `workspaces/<slug>/analytic-view/` `+ /<pk>/`           | Saved `AnalyticView` (`db/models/analytic.py`)                                                                    |
| `workspaces/<slug>/saved-analytic-view/<analytic_id>/`  | Run a saved view                                                                                                  |
| `workspaces/<slug>/export-analytics/`                   | CSV/XLSX export via `bgtasks/analytic_plot_export.py`                                                             |
| `workspaces/<slug>/default-analytics/`                  | Default workspace charts                                                                                          |
| `workspaces/<slug>/project-stats/`                      | Per-project stats                                                                                                 |
| `workspaces/<slug>/advance-analytics/`                  | Tabs `overview`, `work-items` — counts + period-over-period deltas (`get_filtered_counts` / `get_previous_count`) |
| `workspaces/<slug>/advance-analytics-stats/`            | Per-project work-item stats table                                                                                 |
| `workspaces/<slug>/advance-analytics-charts/`           | `projects`, `work-items`, `custom-work-items` chart series                                                        |
| `.../projects/<id>/advance-analytics{,-stats,-charts}/` | Project-scoped equivalents                                                                                        |

Frontend: `apps/web/core/components/analytics/` (`overview/`, `work-items/`, `insight-card.tsx`,
`total-insights.tsx`, `trend-piece.tsx`, `insight-table/`), store `core/store/analytics.store.ts`,
service `core/services/analytics.service.ts`, charts from `@makeplane/propel/charts`.

### 18.4 Cycle / module progress

- `CycleProgressEndpoint` (`cycles/<id>/progress/`) and `CycleAnalyticsEndpoint`
  (`cycles/<id>/analytics/`) — burndown and distribution data; `Cycle.progress_snapshot` persists
  the end-of-cycle state.
- Modules have **no** equivalent endpoints; progress is derived from annotations in the list/detail
  serializers.

### 18.5 Local custom dashboard (not upstream)

Untracked in this working copy:

```text
apps/web/app/(all)/[workspaceSlug]/(projects)/dashboard/{layout.tsx,page.tsx}
apps/web/core/components/workspace-dashboard/{root.tsx,widget-card.tsx,widget-registry.ts,widgets/}
apps/web/core/services/workspace-dashboard.service.ts
```

`WorkspaceDashboardService.getOverdueByAssignee()` reuses the stock
`workspaces/<slug>/analytics/` endpoint with a `target_date` upper bound and a
non-completed/non-cancelled state filter, returning `{total, distribution, extras.assignee_details}`.
A `widget-registry.ts` indirection allows adding widgets. No backend changes were made for it.

---

## 19. Permissions & Security

### 19.1 Role model

Three integer roles, defined identically in `db/models/workspace.py:19`, `db/models/project.py:21`,
`app/permissions/base.py:12` and `packages/types/src/enums.ts:7`:
**Admin = 20, Member = 15, Guest = 5.**

### 19.2 Enforcement mechanisms

1. **`allow_permission(allowed_roles, level="PROJECT"|"WORKSPACE", creator=False, model=None)`** —
   `app/permissions/base.py:19`. The dominant, per-action mechanism. Notable behaviour: a
   **workspace Admin who is a project member passes any project-level check** regardless of their
   project role (`base.py:63-79`). With `creator=True` the object's `created_by` short-circuits the
   role check.
2. **DRF permission classes** — `ProjectBasePermission`, `ProjectMemberPermission`,
   `ProjectEntityPermission`, `ProjectLitePermission` (`permissions/project.py`);
   `WorkSpaceBasePermission`, `WorkSpaceAdminPermission`, `WorkspaceEntityPermission`,
   `WorkspaceViewerPermission` (`permissions/workspace.py`); `permissions/page.py`.
3. **Queryset scoping** — every `get_queryset` filters on
   `project__project_projectmember__member=request.user, is_active=True`.
4. **Frontend gating** — `core/store/user/base-permissions.store.ts::allowPermissions(roles, level,
workspaceSlug?, projectId?, onPermissionAllowed?)`, consumed via `useUserPermissions()`.

### 19.3 Who can do what (from the decorators)

| Action                          | Roles                                                                                         | Source                       |
| ------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------- |
| Create work item                | Admin, Member                                                                                 | `views/issue/base.py:404`    |
| View work item                  | Admin, Member, Guest (Guest via `creator=True`, widened by `Project.guest_view_all_features`) | `base.py:492`                |
| Update work item                | Admin, Member, or creator                                                                     | `base.py:627`                |
| Delete work item                | **Admin or creator only**                                                                     | `base.py:716`                |
| Bulk delete                     | **Admin**                                                                                     | `base.py:774`                |
| Comment                         | Admin, Member, Guest                                                                          | `comment.py:63`              |
| Edit / delete comment           | Admin or creator                                                                              | `comment.py:109,144`         |
| Upload attachment               | Admin, Member, Guest                                                                          | `attachment.py:37,99`        |
| Delete attachment               | Admin or creator                                                                              | `attachment.py:62,149`       |
| Create label                    | **Admin**                                                                                     | `label.py:43`                |
| Update / delete label           | **Admin**                                                                                     | `label.py:58,85`             |
| Create state                    | **Admin**                                                                                     | `state/base.py:46`           |
| **Update state**                | **Admin, Member, Guest**                                                                      | `state/base.py:61` ← anomaly |
| Delete state / mark default     | **Admin**                                                                                     | `state/base.py:105,113`      |
| Create project                  | Workspace Admin or Member                                                                     | `permissions/project.py:26`  |
| Manage cycles / modules / views | `ProjectEntityPermission` → Admin, Member                                                     | `permissions/project.py:105` |
| Change display/user properties  | Admin, Member, Guest (self-scoped)                                                            | `base.py:744,766`            |

### 19.4 Other security surface

- Auth: session-based (`plane/authentication/`), email+password, magic code, OAuth
  (Google/GitHub/GitLab/Gitea). Admin app has its own auth path.
- Public API: `APIToken` model + `plane/api/middleware/` + `plane/api/rate_limit.py`.
- HTML sanitisation: `utils/content_validator.validate_html_content` on comment and description
  input.
- URL/SSRF guards: `utils/url_security.py`, `utils/path_validator.py`.
- Throttling: `plane/throttles/`.
- Upload validation: `sanitize_filename`, `file_size` validator against `settings.FILE_SIZE_LIMIT`.

---

## 20. APIs

### 20.1 Internal API (`/api/`, consumed by `apps/web`)

Selected work-item routes (`apps/api/plane/app/urls/issue.py`), all session-authenticated:

| Endpoint                                                        | Method               | Purpose                                                                     | Permission                |
| --------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------- | ------------------------- |
| `workspaces/<slug>/projects/<pid>/issues/`                      | GET, POST            | List (filterable) / create                                                  | list: A/M/G · create: A/M |
| `…/issues/list/`                                                | GET                  | Flat list (`IssueListEndpoint`)                                             | A/M/G                     |
| `…/v2/issues/`                                                  | GET                  | Grouped + cursor-paginated (`IssuePaginatedViewSet`) — the layout workhorse | A/M/G                     |
| `…/issues-detail/`                                              | GET                  | Hydrate a set of ids (`IssueDetailEndpoint`)                                | A/M/G                     |
| `…/issues/<pk>/`                                                | GET/PUT/PATCH/DELETE | CRUD                                                                        | see §19.3                 |
| `…/issues/<id>/sub-issues/`                                     | GET, POST            | List / attach children                                                      | ProjectEntity             |
| `…/issues/<id>/issue-relation/` · `…/remove-relation/`          | GET/POST             | Relations                                                                   | ProjectEntity             |
| `…/issues/<id>/comments/` `+ /<pk>/`                            | CRUD                 | Comments                                                                    | §19.3                     |
| `…/issues/<id>/reactions/` `+ /<code>/`                         | GET/POST/DELETE      | Reactions                                                                   | A/M/G                     |
| `…/comments/<cid>/reactions/`                                   | GET/POST/DELETE      | Comment reactions                                                           | A/M/G                     |
| `…/issues/<id>/issue-links/` `+ /<pk>/`                         | CRUD                 | External links                                                              | ProjectEntity             |
| `…/issues/<id>/issue-attachments/` · `assets/v2/…/attachments/` | GET/POST/DELETE      | Attachments (v2 = presigned)                                                | §19.3                     |
| `…/issues/<id>/history/`                                        | GET                  | Activity + comments merged, **unpaginated**                                 | ProjectEntity             |
| `…/issues/<id>/issue-subscribers/` · `…/subscribe/`             | GET/POST/DELETE      | Watchers                                                                    | ProjectEntity             |
| `…/issues/<pk>/archive/` · `…/archived-issues/`                 | GET/POST/DELETE      | Archive/restore                                                             | ProjectEntity             |
| `…/bulk-delete-issues/` · `…/bulk-archive-issues/`              | POST/DELETE          | Bulk                                                                        | Admin / ProjectEntity     |
| `…/issue-dates/`                                                | POST                 | Bulk start/target update (Gantt)                                            | A/M                       |
| `…/issues/<id>/versions/` `+ /<pk>/`                            | GET                  | Property snapshots — **no frontend consumer**                               | ProjectEntity             |
| `…/work-items/<id>/description-versions/` `+ /<pk>/`            | GET                  | Description history (UI restores from this)                                 | ProjectEntity             |
| `…/issues/<id>/meta/`                                           | GET                  | Lightweight metadata                                                        | A/M/G                     |
| `workspaces/<slug>/work-items/<PROJ>-<n>/`                      | GET                  | Resolve by human-readable key                                               | ProjectEntity             |
| `…/deleted-issues/`                                             | GET                  | Soft-deleted list                                                           | A/M/G                     |
| `…/user-properties/`                                            | GET/PATCH            | Per-user display properties + `rich_filters`                                | A/M/G                     |
| `workspaces/<slug>/issues/`                                     | GET                  | Workspace-wide list (global views)                                          | WorkspaceEntity           |
| `workspaces/<slug>/user-issues/<user_id>/`                      | GET                  | Profile / My Work                                                           | WorkspaceEntity           |

Other url modules: `analytic.py`, `api.py` (API tokens), `asset.py`, `cycle.py`, `estimate.py`,
`exporter.py`, `external.py` (Unsplash + GPT), `intake.py`, `module.py`, `notification.py`,
`page.py`, `project.py`, `search.py`, `state.py`, `timezone.py`, `user.py`, `views.py`,
`webhook.py`, `workspace.py`.

### 20.2 Public API (`/api/v1/`)

`apps/api/plane/api/urls/`: `work_item.py`, `project.py`, `cycle.py`, `module.py`, `state.py`,
`label.py`, `member.py`, `invite.py`, `intake.py`, `estimate.py`, `asset.py`, `sticky.py`,
`user.py`, `schema.py`. Both `issues/` and `work-items/` spellings are routed (aliases). Auth is
`APIToken`; rate-limited by `plane/api/rate_limit.py`; documented by drf-spectacular
(`utils/openapi/`).

### 20.3 Event mechanisms

- **Webhooks** (`db/models/webhook.py`, `bgtasks/webhook_task.py`): per-workspace URL + secret,
  event flags for `project`, `issue`, `module`, `cycle`, `issue_comment`. Payload includes
  `{event, action, data, activity{field, old_value, new_value, actor, …}}`; deliveries logged in
  `WebhookLog` and purged daily.
- **WebSockets:** only `apps/live` (Hocuspocus/Yjs) for **Pages**. No work-item socket channel.
- **GraphQL / RPC:** none.

---

## 21. Data Models

```text
Workspace ─┬─ WorkspaceMember ── User
           ├─ WorkspaceMemberInvite
           ├─ WorkspaceTheme · WorkspaceUserProperties · WorkspaceHomePreference
           │   WorkspaceUserPreference · WorkspaceUserLink
           ├─ Team                       (no CE endpoints)
           ├─ Label            (project nullable → workspace labels possible)
           ├─ IssueType ── ProjectIssueType   (no CE CRUD)
           ├─ Webhook ── WebhookLog · ProjectWebhook
           ├─ APIToken · APIActivityLog
           ├─ Notification · UserNotificationPreference · EmailNotificationLog
           ├─ ExporterHistory
           ├─ Page ── PageLog · PageVersion · PageLabel
           ├─ Sticky · RecentVisit · UserFavorite
           └─ Project ─┬─ ProjectMember · ProjectMemberInvite · ProjectIdentifier
                       ├─ ProjectUserProperty · ProjectDeployBoard · ProjectPublicMember
                       ├─ State                       (group ∈ 6 fixed values)
                       ├─ Estimate ── EstimatePoint
                       ├─ Cycle ─── CycleIssue · CycleUserProperties
                       ├─ Module ── ModuleIssue · ModuleMember · ModuleLink · ModuleUserProperties
                       ├─ IssueView                   (project or workspace scoped)
                       ├─ Intake ── IntakeIssue
                       ├─ DraftIssue (+ assignees/labels/modules through-tables)
                       └─ Issue ─┬─ IssueAssignee · IssueLabel · IssueSequence
                                 ├─ IssueRelation · IssueBlocker (dead)
                                 ├─ IssueMention · IssueSubscriber
                                 ├─ IssueLink · IssueAttachment · FileAsset
                                 ├─ IssueComment ─ CommentReaction · Description
                                 ├─ IssueReaction · IssueVote
                                 ├─ IssueActivity
                                 └─ IssueVersion · IssueDescriptionVersion
```

**Base classes** (`db/models/base.py`, `project.py`, `workspace.py`):
`BaseModel` (uuid pk, `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at` +
`SoftDeletionManager`) → `WorkspaceBaseModel` (adds `workspace`, nullable `project`) and
`ProjectBaseModel` (adds `workspace` + required `project`).

**Migrations:** `apps/api/plane/db/migrations/` (Django). No separate schema tool.

---

## 22. Frontend Architecture

### 22.1 Work-item detail component tree (actual names/paths)

```text
app/(all)/[workspaceSlug]/(projects)/projects/(detail)/[projectId]/issues/(detail)/page.tsx
└── core/components/issues/issue-detail/root.tsx                (IssueDetailRoot)
    ├── core/components/issues/issue-detail-quick-actions.tsx
    ├── core/components/issues/issue-detail/main-content.tsx    (IssueMainContent)
    │   ├── issues/issue-detail/parent/                         (IssueParentDetail)
    │   ├── issues/issue-type-switcher.tsx                      (IssueTypeSwitcher)
    │   ├── issues/title-input.tsx                              (IssueTitleInput)
    │   ├── issues/issue-update-status.tsx                      (NameDescriptionUpdateStatus)
    │   ├── core/components/editor/rich-text/description-input/root.tsx   (DescriptionInput)
    │   ├── core/components/core/description-versions/root.tsx  (DescriptionVersionsRoot)
    │   ├── issues/issue-detail/reactions/                      (IssueReaction)
    │   ├── issues/issue-detail-widgets/root.tsx                (IssueDetailWidgets)
    │   │   ├── action-buttons.tsx · widget-button.tsx
    │   │   ├── issue-detail-widget-collapsibles.tsx
    │   │   │   ├── sub-issues/        (SubIssuesCollapsible)
    │   │   │   ├── relations/         (RelationsCollapsible)
    │   │   │   ├── links/             (LinksCollapsible)
    │   │   │   └── attachments/       (AttachmentsCollapsible)
    │   │   └── issue-detail-widget-modals.tsx
    │   └── issues/issue-detail/issue-activity/                 (IssueActivity)
    │       ├── activity/  ·  comments/
    │       └── core/components/comments/{comments,comment-create,comment-block,comment-reaction,quick-actions}
    └── core/components/issues/issue-detail/sidebar.tsx         (IssueDetailsSidebar)
        ├── issues/peek-overview/properties.tsx                 (PeekOverviewProperties)
        │   ├── core/components/dropdowns/state/                (StateDropdown)
        │   ├── core/components/dropdowns/priority.tsx          (PriorityDropdown)
        │   ├── core/components/dropdowns/member/               (MemberDropdown)
        │   ├── issues/issue-layouts/properties/label-dropdown.tsx
        │   ├── core/components/dropdowns/date.tsx · date-range.tsx · merged-date.tsx
        │   ├── core/components/dropdowns/estimate.tsx
        │   ├── core/components/dropdowns/cycle/  · module/     (Cycle/Module selects)
        │   └── issues/issue-detail/parent-select.tsx · relation-select.tsx
        └── issues/issue-detail/subscription.tsx                (IssueSubscription)
```

### 22.2 Layout stack

```text
issue-layouts/roots/{project,cycle,module,project-view,archived,all-issue}-layout-root.tsx
└── issue-layouts/issue-layout-HOC.tsx           (loading / empty / error states)
    ├── list/          → base-list-root · default.tsx · list-group.tsx · block-root.tsx · block.tsx
    ├── kanban/        → base-kanban-root · default.tsx · kanban-group.tsx · swimlanes.tsx · block.tsx
    ├── calendar/      → base-calendar-root · calendar.tsx · week-days.tsx · day-tile.tsx · issue-block.tsx
    ├── spreadsheet/   → base-spreadsheet-root · spreadsheet-table · issue-row · columns/*
    └── gantt/         → base-gantt-root  →  core/components/gantt-chart/**
    plus: quick-add/ · filters/ · properties/ · empty-states/ · quick-action-dropdowns/
          bulk-operations/ (upgrade banner only in CE)
```

Shared primitives were recently extracted to `core/components/base-layouts/`
(`kanban/item.tsx`, `list/item.tsx`, `hooks/use-group-drop-target.ts`, `hooks/use-layout-state.ts`).

### 22.3 Store composition

`core/store/root.store.ts` → `IssueRootStore` (`core/store/issue/root.store.ts`) which owns, per
context, a `*Filter` store and an `*Issues` store, all extending
`core/store/issue/helpers/base-issues.store.ts` (1 979 lines — `createIssue`, `issueUpdate`,
`removeIssue`, `issueArchive`, `issueQuickAdd`, `removeBulkIssues`, `bulkArchiveIssues`,
`bulkUpdateProperties`, `updateIssueDates`, `groupedIssueIds`, `updateIssueList`, pagination).
`core/store/issue/issue-details/` holds the detail sub-stores (activity, attachment, comment,
comment_reaction, link, reaction, relation, sub_issues, sub_issues_filter, subscription).

---

## 23. Reusable Components & UX Patterns

| Pattern                 | Canonical implementation                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design system (current) | `@makeplane/propel` — `packages/propel/src/**` (button, dialog, menu, combobox, command, popover, toast, tabs, table, tooltip, charts, icons, empty-state, skeleton, …)                                                                                                   |
| Design system (legacy)  | `@plane/ui` — `packages/ui/src/**` (still used widely; active migration, cf. commits `9f73d08c23`, `6712389766`, `12eb6015de`)                                                                                                                                            |
| Modals                  | `packages/ui/src/modals/`; work-item modals in `core/components/issues/issue-modal/` (`base.tsx`, `form.tsx`, `modal.tsx`, `draft-issue-layout.tsx`, `provider.tsx`, context); registries in `core/components/modals/{project-level,work-item-level,workspace-level}.tsx` |
| Side panels / peek      | `core/components/issues/peek-overview/` + `useIssuePeekOverviewRedirection`                                                                                                                                                                                               |
| Dropdowns               | `core/components/dropdowns/**` + `useDropdown`, `useDropdownKeyDown`                                                                                                                                                                                                      |
| Command menu            | `core/components/power-k/**` (`actions/`, `config/`, `core/`, `menus/`, `ui/`, `global-shortcuts.tsx`), stores `base-power-k.store.ts` / `base-command-palette.store.ts`, i18n `power-k.json`                                                                             |
| Forms                   | `react-hook-form` + `packages/ui/src/form-fields/`                                                                                                                                                                                                                        |
| Tables                  | `propel/table` + `spreadsheet/spreadsheet-table.tsx` + `useTableKeyboardNavigation`                                                                                                                                                                                       |
| Boards                  | `core/components/base-layouts/kanban/` + `issue-layouts/kanban/`                                                                                                                                                                                                          |
| Filters                 | `core/components/rich-filters/**` (new expression UI) and `core/components/work-item-filters/**` (work-item HOC/row/toggle); legacy `issue-layouts/filters/`                                                                                                              |
| Toasts                  | `@plane/propel/toast` — `setToast`, `setPromiseToast`, `TOAST_TYPE`                                                                                                                                                                                                       |
| Loading                 | `IssueLayoutHOC`, `packages/ui/src/loader.tsx`, `propel/skeleton`, per-layout loaders                                                                                                                                                                                     |
| Empty states            | `core/components/empty-state/{simple,detailed,section}-empty-state-root.tsx` + `helper.tsx` (+ light/dark webp assets under `app/assets/empty-state/`)                                                                                                                    |
| Error states            | `app/error/`, `app/not-found.tsx`, per-view `error.tsx`                                                                                                                                                                                                                   |
| Multi-select            | `core/store/multiple_select.store.ts` + `useMultipleSelect` + `bulk-operations/`                                                                                                                                                                                          |
| Drag & drop             | `@atlaskit/pragmatic-drag-and-drop` (+ auto-scroll, hitbox); `useGroupDragndrop`, `useAutoScroller`                                                                                                                                                                       |
| Responsive              | `useWindowSize`, `usePlatformOS`; Tailwind via `packages/tailwind-config`                                                                                                                                                                                                 |
| i18n                    | `@plane/i18n` + `packages/i18n/src/locales/<lang>/*.json` (21 locales × 28 namespaces)                                                                                                                                                                                    |

**Guidance for future work:** extend these rather than creating parallel systems — in particular
use `@makeplane/propel` (not `@plane/ui`), the `rich_filters` expression system (not the legacy
`filters` JSON), and `base-issues.store.ts` (not a new fetch path).

---

## 24. Current Limitations (evidence-backed)

### Work items

1. **No custom fields.** No `IssueProperty`-style model exists in `apps/api/plane/db/models/`.
2. **Work item types / Epics are backend-only.** `IssueType` + `ProjectIssueType` models exist and
   `Issue.type` is a real FK, but no CE endpoint creates or lists them; `Project.is_issue_type_enabled`
   has no CE toggle in `project/settings/features-list.tsx`. `core/components/epic-modal/` and
   `EIssueServiceType.EPICS` exist with no routes.
3. **Bulk property editing is dead in CE.** `base-issues.store.ts:725` POSTs to
   `bulk-operation-issues/`, which does not exist in `apps/api`;
   `core/hooks/use-bulk-operation-status.ts` is literally `export const useBulkOperationStatus = () => false;`
   and `bulk-operations/root.tsx` returns `<BulkOperationsUpgradeBanner/>` unconditionally.
4. **Duplication is shallow.** `duplicateIssuePayload` copies scalar fields only
   (`quick-action-dropdowns/project-issue.tsx:71`); sub-items, relations, links, attachments and
   comments are lost.
5. **Legacy `Issue.point` field** (IntegerField 0–12) coexists with `estimate_point` FK.
6. **Archiving is state-gated in the UI only.** `ARCHIVABLE_STATE_GROUPS` is a frontend constant
   (`packages/constants/src/state.ts:54`); `IssueArchiveViewSet.archive` does not enforce it.

### Views

7. **Workspace/global views: spreadsheet only, no grouping.** `views/helper.tsx` switches on
   `activeLayout` and returns `<></>` for everything except `SPREADSHEET`;
   `all-issue-layout-root.tsx` fetches with `{ canGroup: false, perPageCount: 100 }`.
8. **Archived work items: list layout only** (`ISSUE_DISPLAY_FILTERS_BY_PAGE.archived_issues`).
9. **Calendar and Gantt expose only 2 display properties** (`key`, `issue_type`) and Calendar has
   no ordering options.
10. **Gantt dependency plumbing is dead** — see §17.

### Search & filters

11. **Search covers 3 fields with `icontains`** — no description, no comments, no full-text index.
12. **No URL filter state** — `routeFilters` computed and dropped (§7.2).
13. **Two filter systems and two persisted columns** (`filters` + `rich_filters`) with a migration
    shim (`utils/filters/filter_migrations.py`) — every new filter must be added in both
    `utils/issue_filters.py` and `utils/filters/filterset.py`.
14. **Known timezone off-by-one** documented in `utils/filters/filterset.py:180-184`.

### Notifications

15. **No due-date / deadline / reminder notifications at all** (§11).
16. **Preferences gate email only**; `Notification` rows are always created
    (`notification_task.py:361-401`).
17. **Preference scope is global** — `UserNotificationPreferenceEndpoint` takes no slug
    (`notification/base.py:301`), while the model has unused `workspace` and `project` FKs.
18. **No cycle/module notifications** — those activity types are excluded
    (`notification_task.py:203-218`).
19. **No push notifications** despite a `Device` model.
20. **Email batching floor is 5 minutes** (`celery.py:47`) and there is no digest/frequency setting.

### Collaboration

21. **Work-item descriptions are not collaborative.** `apps/live` has only page document types;
    `description-input/root.tsx` is debounce + "pseudo realtime" SWR. Concurrent editors overwrite
    each other.
22. **Comment replies are backend-only** — `IssueComment.parent` exists, no reply UI.
23. **Activity feed is unpaginated** (`views/issue/activity.py`) — long-lived items load their
    entire history in one response.
24. **`IssueVersion` snapshots have no consumer** — `IssueVersionEndpoint` is unreferenced from
    `apps/web/core/services/`.

### Cycles / modules

25. **Cycle status is derived, not stored**, and there is **no explicit "complete cycle" action** —
    only date-driven transitions plus `transfer-issues/`.
26. **Modules have no `progress`/`analytics` endpoints** although cycles do.
27. **Cycle uses `DateTimeField` while Issue and Module use `DateField`** — a recurring source of
    boundary bugs (cf. commit `da1a7ab850` "guard against no end_date when archiving cycle").

### Labels / states

28. **Workspace-level labels and label hierarchy are schema-only** — constraints and `Label.parent`
    exist; no endpoint or UI uses them.
29. **Label CRUD is Admin-only** — Members cannot create a label inline.
30. **Guests can PATCH states** (`state/base.py:61`) while create/delete are Admin-only.
31. **State groups are a closed enum** — no custom groups, no transition rules, no workflow
    (`core/components/workflow/state-option.tsx` ignores its own workflow props).

### Dashboard / analytics

32. **Two home widgets are `component: null`** (`new_at_plane`, `quick_tutorial`).
33. **`DashboardStore` + `dashboard.service.ts` are orphaned** — they call routes that do not exist
    and nothing calls `useDashboard`.
34. **`UserWorkspaceDashboardEndpoint` has no CE consumer.**
35. **No work-item KPI widgets on Home** — analytics live only under `/analytics/:tabId`.

### Platform / technical debt

36. **Two design systems in flight** (`@plane/ui` ↔ `@makeplane/propel`).
37. **Four overlapping work-item list endpoints** (`issues/`, `issues/list/`, `v2/issues/`,
    `issues-detail/`) and two attachment endpoint generations (v1 + `assets/v2/`).
38. **Dead models shipped:** `IssueBlocker`, `Team`, `Importer` (Jira/GitHub — no views),
    `integration/{github,slack}.py` (no views/urls in CE).
39. **`base-issues.store.ts` is 1 979 lines** and is the mandatory extension point for any new
    list behaviour.
40. **EE seams are prop-shaped, not interface-shaped** — `templateId`, `enableDependency`,
    `filterAvailableStateIds`, `routeFilters` are accepted and silently ignored, which makes it
    hard to tell declared surface from working surface.

---

## 25. Feature Status Matrix

Legend: **Y** = yes/full · **P** = partial · **N** = no · **UI** = UI only · **BE** = backend only ·
**?** = unknown

| Feature                                        | Exists | Implementation       | Frontend     | Backend        | API     | Database  | Permissions | Notifications | Notes                           |
| ---------------------------------------------- | ------ | -------------------- | ------------ | -------------- | ------- | --------- | ----------- | ------------- | ------------------------------- |
| Workspaces                                     | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | invites only  | 3 fixed roles                   |
| Workspace members/roles                        | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y (email)     | Admin/Member/Guest              |
| Teams                                          | N      | Model only           | N            | N              | N       | Y         | —           | N             | `Team` unused in CE             |
| Projects CRUD                                  | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | invites       | —                               |
| Project feature toggles                        | P      | Full for 5           | Y            | Y              | Y       | Y         | Y           | N             | time-tracking & issue-types EE  |
| Project templates                              | N      | Dead props + i18n    | N            | N              | N       | N         | —           | N             | `templateId` unused             |
| Project archive                                | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | N             | —                               |
| Work item CRUD                                 | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | delete = admin/creator          |
| Duplicate                                      | P      | Client prefill       | UI           | N              | N       | N         | Y           | N             | shallow copy                    |
| Multiple assignees                             | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | —                               |
| Status/state                                   | Y      | Full                 | Y            | Y              | Y       | Y         | P           | Y             | Guest can PATCH                 |
| Workflow rules                                 | N      | Ignored props        | N            | N              | N       | N         | —           | N             | EE                              |
| Priority                                       | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | fixed 5 values                  |
| Labels (project)                               | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | Admin-only CRUD                 |
| Labels (workspace / nested)                    | N      | Schema only          | N            | N              | N       | Y         | —           | N             | constraints + `parent` unused   |
| Start / due dates                              | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | **N**         | no reminders                    |
| Estimates                                      | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | legacy `point` remains          |
| Cycles                                         | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | **N**         | derived status                  |
| Modules                                        | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | **N**         | no progress endpoint            |
| Sub-work-items                                 | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | no depth limit                  |
| Relations (4 types)                            | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | —                               |
| Relations (start/finish/implements)            | P      | BE                   | N            | Y              | Y       | Y         | Y           | Y             | not in `TIssueRelationTypes`    |
| Blocking enforcement                           | N      | —                    | N            | N              | N       | N         | —           | N             | informational only              |
| Gantt dependencies                             | N      | Dead props           | N            | N              | N       | N         | —           | N             | EE                              |
| Description (rich text)                        | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | N (skipped)   | not collaborative               |
| Description versions                           | Y      | Full + restore       | Y            | Y              | Y       | Y         | Y           | N             | —                               |
| Property versions                              | P      | BE                   | N            | Y              | Y       | Y         | Y           | N             | no consumer                     |
| Attachments                                    | Y      | Full (v1+v2)         | Y            | Y              | Y       | Y         | Y           | Y             | duplicate endpoints             |
| Links                                          | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | OG metadata task                |
| Comments                                       | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | —                               |
| Comment replies                                | P      | BE                   | N            | Y              | Y       | Y         | Y           | N             | `parent` FK unused by UI        |
| Reactions                                      | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | N             | —                               |
| Mentions                                       | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | HTML-parsed                     |
| Activity/history                               | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | unpaginated                     |
| Work item ID / URL                             | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | —             | advisory-lock sequence          |
| Custom fields                                  | N      | —                    | N            | N              | N       | N         | —           | N             | EE                              |
| Work item types / Epics                        | P      | BE + scaffolding     | N            | Y              | v1 only | Y         | —           | N             | EE                              |
| Bulk delete / archive                          | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | —                               |
| Bulk property update                           | UI     | Banner only          | UI           | **N**          | **N**   | —         | —           | —             | endpoint absent                 |
| Bulk date update                               | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | Gantt                           |
| Drag & drop                                    | Y      | Full                 | Y            | Y (sort_order) | Y       | Y         | Y           | Y             | —                               |
| Archive / restore                              | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | —                               |
| Drafts                                         | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | N             | —                               |
| Intake / triage                                | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | P             | —                               |
| List / Kanban / Calendar / Spreadsheet / Gantt | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | —             | per-context availability varies |
| Global (workspace) views                       | P      | Spreadsheet only     | P            | Y              | Y       | Y         | Y           | —             | no grouping                     |
| Saved views                                    | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | —             | private/public, lockable        |
| My Work                                        | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | —             | list + kanban                   |
| Filters                                        | Y      | Backend              | Y            | Y              | Y       | Y         | Y           | —             | two systems                     |
| Filter persistence                             | Y      | Server-side per user | Y            | Y              | Y       | Y         | Y           | —             | not in URL                      |
| Search                                         | P      | 3 fields             | Y            | Y              | Y       | Y         | Y           | —             | no description/comment search   |
| In-app notifications                           | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y             | prefs not honoured              |
| Email notifications                            | Y      | Full                 | prefs UI     | Y              | Y       | Y         | Y           | Y             | 5-min batches                   |
| Push notifications                             | N      | `Device` model only  | N            | N              | N       | Y         | —           | N             | —                               |
| Due-date notifications                         | **N**  | —                    | N            | N              | N       | N         | —           | N             | biggest gap                     |
| Webhooks                                       | Y      | Full                 | Y (settings) | Y              | Y       | Y         | Y           | —             | 5 event types                   |
| Public REST API                                | Y      | Full                 | —            | Y              | Y       | Y         | token       | —             | OpenAPI                         |
| Analytics                                      | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | —             | workspace + project             |
| Home widgets                                   | P      | 3 of 5               | P            | Y              | Y       | Y         | Y           | —             | 2 are `null`                    |
| Legacy dashboard store                         | N      | Orphaned             | dead         | **N**          | **N**   | —         | —           | —             | routes removed                  |
| Pages (collaborative)                          | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | N             | Hocuspocus                      |
| Exports (CSV/XLSX/JSON)                        | Y      | Full                 | Y            | Y              | Y       | Y         | Y           | Y (email)     | —                               |
| Importers (Jira/GitHub)                        | N      | Model only           | N            | N              | N       | Y         | —           | N             | removed from CE                 |
| Github/Slack integrations                      | N      | Models only          | N            | N              | N       | Y         | —           | N             | no views/urls                   |
| Time tracking / worklogs                       | N      | Flag only            | N            | N              | N       | flag only | —           | N             | EE                              |

---

## 26. Enhancement Opportunity Matrix

| Area               | Current capability                                       | Missing / weak                                            | Enhancement opportunity                                                                                                                                                                           | Complexity               | Risk                                                                                |
| ------------------ | -------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------- |
| Deadlines          | `start_date`/`target_date`; overdue recomputed per query | No reminders, no digest, no escalation                    | Add a Celery beat job (mirroring `issue_automation_task`) that emits `Notification` + `EmailNotificationLog` for items due in N days / overdue, gated by new `UserNotificationPreference` columns | Medium                   | Low — additive; needs care with per-project timezones and notification volume       |
| Search             | 3-field `icontains`                                      | No description/comment search, no ranking, no index       | Add `SearchVectorField` + GIN index on `Issue` (name + `description_stripped`) and extend `filter_issues`                                                                                         | Medium                   | Medium — migration on a large table; must keep the vector in sync in `Issue.save()` |
| Filters / sharing  | Server-side per-user persistence                         | No URL state; `routeFilters` dead                         | Serialise the `rich_filters` expression into the query string and hydrate on mount; finish wiring `routeFilters`                                                                                  | Medium                   | Low — but touches every layout root                                                 |
| Global views       | Spreadsheet only, no grouping                            | 4 of 5 layouts unavailable workspace-wide                 | Extend `views/helper.tsx` to the other layouts and enable `canGroup` for the workspace issues endpoint                                                                                            | Medium                   | Medium — cross-project grouping needs project-scoped state/label resolution         |
| Bulk actions       | Delete + archive + dates                                 | Property updates absent server-side                       | Implement a `bulk-operation-issues/` endpoint in CE with per-item permission checks and activity/notification fan-out                                                                             | Medium                   | Medium — activity/notification volume; partial-failure semantics                    |
| Dependencies       | 4 relation types, informational                          | 4 types hidden; no enforcement; no Gantt arrows           | (a) expose the remaining `TIssueRelationTypes`; (b) optional soft warning when completing a blocked item; (c) render dependency edges in the Gantt                                                | (a) Low (b) Low (c) High | (a)(b) Low (c) High — the chart layer has no edge model                             |
| Activity feed      | Complete but unpaginated                                 | Long items load everything                                | Cursor-paginate `IssueActivityEndpoint` (reuse `BasePaginator`) and lazy-load older entries                                                                                                       | Low                      | Low                                                                                 |
| Notification prefs | Global, email-only                                       | No per-workspace/project scope; in-app always fires       | Honour the existing `workspace`/`project` FKs and add a per-channel toggle for in-app                                                                                                             | Medium                   | Medium — needs a backfill for existing rows                                         |
| Collaboration      | Pages realtime; work items debounced                     | Concurrent description edits clobber                      | Add a work-item document type to `apps/live` (the Hocuspocus infrastructure already exists)                                                                                                       | High                     | High — new persistence path for `description_binary`; conflict semantics            |
| Comments           | Flat                                                     | `parent` FK unused                                        | Build reply threading in `core/components/comments/` against the existing model + serializer                                                                                                      | Low                      | Low                                                                                 |
| Labels             | Project-scoped, Admin-only                               | Workspace labels & hierarchy schema-only; Members blocked | Add a workspace-label endpoint (constraints already exist) and relax create to Member                                                                                                             | Low                      | Low                                                                                 |
| States             | Free transitions                                         | Guest can PATCH; no workflow                              | Tighten `partial_update` to Admin; optionally add an opt-in allowed-transition table (the `StateOption` props already anticipate it)                                                              | Low / High               | Low / Medium                                                                        |
| Modules            | Annotated progress                                       | No progress/analytics endpoints                           | Mirror `CycleProgressEndpoint` / `CycleAnalyticsEndpoint` for modules                                                                                                                             | Low                      | Low                                                                                 |
| Cycles             | Date-derived status                                      | No explicit completion; snapshot only on transfer         | Add an explicit "complete cycle" action that freezes `progress_snapshot` and optionally notifies                                                                                                  | Medium                   | Medium — must not break the derived-status annotation contract                      |
| Dashboard          | Home widgets are links/recents/stickies                  | No work-item KPIs; two null widgets; orphaned store       | Add work-item widgets on top of the existing `advance-analytics*` endpoints; delete `DashboardStore`/`dashboard.service.ts`                                                                       | Low–Medium               | Low                                                                                 |
| Custom fields      | None                                                     | —                                                         | Only worth attempting if EE parity is a goal; it is a large, cross-cutting schema addition                                                                                                        | High                     | High                                                                                |
| Technical debt     | 2 design systems, 4 list endpoints, dead models          | —                                                         | Continue the propel migration; deprecate `issues/list/` and `issues-detail/`; drop `IssueBlocker`/`Team`/`Importer`/integration models                                                            | Medium                   | Medium — API deprecation needs a window                                             |

---

## 27. Important Code Paths

### Frontend

```text
apps/web/app/routes/core.ts                                    All CE routes (React Router config)
apps/web/app/routes.ts                                         Merges core + extended (EE seam)
apps/web/core/store/root.store.ts                              Root MobX store composition
apps/web/core/store/issue/root.store.ts                        Work-item store tree (per-context stores)
apps/web/core/store/issue/helpers/base-issues.store.ts         All work-item CRUD/grouping/pagination (1979 LOC)
apps/web/core/store/issue/helpers/issue-filter-helper.store.ts Filter/display-filter normalisation
apps/web/core/store/issue/project/filter.store.ts              Filter persistence (ProjectUserProperty)
apps/web/core/store/issue/issue-details/*.store.ts             Detail sub-stores
apps/web/core/store/user/base-permissions.store.ts             allowPermissions()
apps/web/core/store/timeline/base-timeline.store.ts            Gantt block geometry (dependency dummy at :344)
apps/web/core/components/issues/issue-detail/root.tsx          Work-item detail shell
apps/web/core/components/issues/issue-detail/main-content.tsx  Title + description + widgets + activity
apps/web/core/components/issues/issue-detail/sidebar.tsx       Property sidebar
apps/web/core/components/issues/issue-detail-widgets/**        Sub-items, relations, links, attachments
apps/web/core/components/issues/issue-layouts/**               All five layouts
apps/web/core/components/issues/issue-layouts/roots/*.tsx      Per-context layout entry points
apps/web/core/components/issues/issue-modal/**                 Create/update work-item modal
apps/web/core/components/issues/peek-overview/**               Peek overlay
apps/web/core/components/issues/bulk-operations/**             CE upgrade banner
apps/web/core/components/gantt-chart/**                        Timeline chart
apps/web/core/components/rich-filters/**                       New filter expression UI
apps/web/core/components/work-item-filters/**                  Work-item filter HOC/row/toggle
apps/web/core/components/dropdowns/**                          State/priority/member/date/cycle/module pickers
apps/web/core/components/relations/index.tsx                   ISSUE_RELATION_OPTIONS (4 types)
apps/web/core/components/editor/rich-text/description-input/root.tsx  Debounced description autosave
apps/web/core/components/power-k/**                            Command palette
apps/web/core/components/home/home-dashboard-widgets.tsx       HOME_WIDGETS_LIST
apps/web/core/services/issue/*.service.ts                      Work-item HTTP clients
apps/web/core/hooks/use-issues-actions.tsx                     Context-aware action dispatch
apps/web/core/hooks/use-bulk-operation-status.ts               CE feature flag (returns false)
packages/constants/src/issue/{common,filter,layout,modal}.ts   Priorities, filters-per-page, layouts
packages/constants/src/state.ts                                State groups, ARCHIVABLE_STATE_GROUPS
packages/types/src/issues/issue_relation.ts                    TIssueRelationTypes (4)
packages/types/src/workspace-views.ts                          STATIC_VIEW_TYPES
packages/propel/src/**                                         Current design system
packages/editor/src/**                                         TipTap editors
```

### Backend

```text
apps/api/plane/urls.py                                         URL roots
apps/api/plane/app/urls/issue.py                               All work-item routes
apps/api/plane/app/views/issue/base.py                         IssueViewSet, list endpoints, bulk, dates (1367 LOC)
apps/api/plane/app/views/issue/{relation,sub_issue,comment,attachment,link,reaction,subscriber,activity,archive,version,label}.py
apps/api/plane/app/views/cycle/{base,issue,archive}.py         Cycles + progress + analytics + transfer
apps/api/plane/app/views/module/**                             Modules
apps/api/plane/app/views/search/base.py                        Global + entity search
apps/api/plane/app/views/analytic/{base,advance,project_analytics}.py
apps/api/plane/app/views/notification/base.py                  Notifications + preferences
apps/api/plane/app/views/workspace/base.py                     Workspace + UserWorkspaceDashboardEndpoint
apps/api/plane/app/permissions/{base,project,workspace,page}.py Permission layer
apps/api/plane/api/{urls,views,serializers}/**                 Public /api/v1/
apps/api/plane/space/**                                        Public deploy-board API
apps/api/plane/authentication/**                               Auth + OAuth providers
apps/api/plane/utils/issue_filters.py                          Legacy query-param filters
apps/api/plane/utils/filters/filterset.py                      django-filter IssueFilterSet
apps/api/plane/utils/filters/filter_migrations.py              Legacy → rich_filters conversion
apps/api/plane/utils/grouper.py                                Server-side grouping annotations
apps/api/plane/utils/paginator.py                              Cursor / grouped / sub-grouped paginators
apps/api/plane/utils/order_queryset.py                         Priority-aware ordering
apps/api/plane/utils/issue_search.py                           search_issues()
apps/api/plane/utils/issue_relation_mapper.py                  Relation direction mapping
apps/api/plane/utils/analytics_plot.py, build_chart.py         Analytics
apps/api/plane/utils/content_validator.py, url_security.py     Sanitisation / SSRF
```

### Database

```text
apps/api/plane/db/models/issue.py         Issue + 15 related models (822 LOC)
apps/api/plane/db/models/project.py       Project, ProjectMember, ProjectUserProperty, ROLE
apps/api/plane/db/models/workspace.py     Workspace, WorkspaceMember, ROLE_CHOICES, preferences
apps/api/plane/db/models/state.py         State, StateGroup, DEFAULT_STATES
apps/api/plane/db/models/label.py         Label (project nullable, parent FK)
apps/api/plane/db/models/cycle.py         Cycle, CycleIssue, CycleUserProperties
apps/api/plane/db/models/module.py        Module, ModuleIssue, ModuleMember, ModuleLink
apps/api/plane/db/models/notification.py  Notification, UserNotificationPreference, EmailNotificationLog
apps/api/plane/db/models/view.py          IssueView (saved views)
apps/api/plane/db/models/intake.py        Intake, IntakeIssue
apps/api/plane/db/models/draft.py         DraftIssue
apps/api/plane/db/models/estimate.py      Estimate, EstimatePoint
apps/api/plane/db/models/issue_type.py    IssueType, ProjectIssueType
apps/api/plane/db/models/webhook.py       Webhook, WebhookLog, ProjectWebhook
apps/api/plane/db/models/base.py          BaseModel + soft delete
apps/api/plane/db/mixins.py               SoftDeletionManager, ChangeTrackerMixin
apps/api/plane/db/migrations/             Django migrations
```

### Notifications / background jobs

```text
apps/api/plane/celery.py                              Beat schedule (13 jobs)
apps/api/plane/bgtasks/issue_activities_task.py       Activity tracking + auto-subscribe (fan-out hub)
apps/api/plane/bgtasks/notification_task.py           In-app + email-log creation, mention extraction
apps/api/plane/bgtasks/email_notification_task.py     5-minute batching + rendering
apps/api/plane/bgtasks/issue_automation_task.py       Daily auto-archive / auto-close
apps/api/plane/bgtasks/webhook_task.py                Webhook fan-out + delivery
apps/api/plane/bgtasks/issue_version_sync.py          IssueVersion snapshots
apps/api/plane/bgtasks/issue_description_version_task.py
apps/api/plane/bgtasks/deletion_task.py               Daily hard delete
apps/api/plane/bgtasks/cleanup_task.py                Log/version retention
apps/api/plane/bgtasks/export_task.py                 CSV/XLSX/JSON export
apps/api/plane/bgtasks/work_item_link_task.py         Link OG metadata
apps/api/templates/emails/notifications/              Email templates
```

### Routing

```text
apps/web/app/routes.ts · app/routes/core.ts · app/routes/extended.ts · app/routes/helper.ts
apps/web/app/routes/redirects/core/*.tsx      Legacy-path redirects
apps/api/plane/urls.py
apps/api/plane/app/urls/__init__.py + 21 modules
apps/api/plane/api/urls/__init__.py + 14 modules
```

---

## 28. Architecture Diagram

```text
                                 ┌──────────────────────────────────────────┐
   User (browser)                │  apps/proxy (Caddy)                      │
        │                        └──────────────────────────────────────────┘
        ▼                              │                │                │
┌───────────────────────────┐          │                │                │
│ apps/web (React Router 7) │◀─────────┘                │                │
│  route  app/routes/core.ts│                           │                │
│    ▼                      │                    apps/space        apps/admin
│  page component           │                           │                │
│    ▼                      │                           ▼                ▼
│  core/components/**       │                    /api/public/     (instance admin)
│    ▼                      │
│  hooks (useIssues,        │
│   useIssueDetail,         │
│   useUserPermissions)     │      ┌───────────────────────────┐
│    ▼                      │      │ apps/live (Hocuspocus/Yjs)│  ← PAGES ONLY
│  MobX store               │◀────▶│  websocket collaboration  │    (not work items)
│   core/store/issue/**     │      └───────────────────────────┘
│    ▼                      │
│  service (APIService/axios)│
└───────────┬───────────────┘
            │  HTTPS  /api/…            (session cookie)          /api/v1/… (API token)
            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ apps/api — Django + DRF                                                      │
│                                                                              │
│  urls.py → plane/app/urls/issue.py → plane/app/views/issue/base.py           │
│                 │                                                            │
│                 ├─ permission layer                                          │
│                 │    allow_permission([...], level=..., creator=..., model=..)│
│                 │    ProjectEntityPermission / WorkspaceEntityPermission      │
│                 │                                                            │
│                 ├─ query layer                                               │
│                 │    IssueFilterSet (utils/filters/filterset.py)             │
│                 │    issue_filters()  (utils/issue_filters.py — legacy)      │
│                 │    issue_queryset_grouper() (utils/grouper.py)             │
│                 │    order_issue_queryset() (utils/order_queryset.py)        │
│                 │    GroupedOffsetPaginator / SubGroupedOffsetPaginator      │
│                 │                                                            │
│                 ├─ serializer layer  (app/serializers/issue.py)              │
│                 │    validate_html_content() sanitisation                    │
│                 │                                                            │
│                 └─ model layer  (db/models/issue.py)                         │
│                      Issue.save(): default state, completed_at sync,         │
│                      pg_advisory_xact_lock → sequence_id, sort_order,        │
│                      description_stripped                                    │
│                            │                                                 │
│                            ▼                                                 │
│                      PostgreSQL  (soft delete via deleted_at)                │
│                                                                              │
│  side effects (fire-and-forget, on every write):                             │
│    issue_activity.delay(...)  ── bgtasks/issue_activities_task.py            │
│         ├─ IssueActivity rows                                                │
│         ├─ IssueSubscriber bulk_create (assignees auto-subscribe)            │
│         ├─ webhook_activity.delay(...) ─→ bgtasks/webhook_task.py ─→ HTTP POST│
│         └─ notifications.delay(...)  ── bgtasks/notification_task.py         │
│                 ├─ Notification rows            (always)                     │
│                 └─ EmailNotificationLog rows    (if preference allows)       │
└──────────────────────────────────────────────────────────────────────────────┘
            │                                     │
            ▼                                     ▼
   Redis (broker + cache)              Celery worker / beat
                                          ├ every 5 min : stack_email_notification → SMTP
                                          ├ daily 00:00 : hard_delete
                                          ├ daily 01:00 : archive_and_close_old_issues
                                          └ daily 01:30–03:45 : exports & log/version cleanup
                                       (NO job reads target_date → no deadline reminders)
```

**Read path for a layout (the hot path):**

```text
project-layout-root.tsx
  → useIssues(EIssuesStoreType.PROJECT).fetchIssues()
    → ProjectIssues (base-issues.store.ts)
      → IssueService  GET /api/workspaces/<slug>/projects/<id>/v2/issues/
        → IssuePaginatedViewSet.list  (app/views/issue/base.py:865)
          → IssueFilterSet → issue_queryset_grouper → order_queryset → GroupedOffsetPaginator
            → PostgreSQL
      ← { grouped_by, sub_grouped_by, results, next_cursor, total_count }
  → store normalises into issues map + groupedIssueIds
  → layout renders from groupedIssueIds (list/kanban/calendar/spreadsheet/gantt)
```

---

## 29. Recommended Priorities

### A. What Plane already does well

1. **Server-side grouping, sub-grouping, ordering and cursor pagination** across five layouts —
   `utils/grouper.py` + `utils/paginator.py` + `base-issues.store.ts` is a genuinely strong
   foundation that scales past client-side approaches.
2. **A complete, uniform activity/audit trail.** Every mutation flows through
   `issue_activity.delay()`, which feeds history, notifications and webhooks from one place —
   an excellent extension point.
3. **Cohesive permission primitive.** `allow_permission(...)` with `creator=True` gives per-action,
   per-role, ownership-aware checks in one decorator, mirrored on the frontend by
   `allowPermissions()`.
4. **Rich relational work-item model.** Multi-assignee, multi-label, multi-module, parent/child,
   typed relations, subscribers, reactions, mentions, versions — all first-class tables, not JSON.
5. **Human-readable, collision-free work item IDs** via `IssueSequence` + a per-project Postgres
   advisory lock.
6. **Real soft-delete + retention discipline** — `SoftDeletionManager`, `hard_delete`, and five
   cleanup jobs.
7. **Two well-separated API surfaces** — internal `/api/` and a token-authed, OpenAPI-documented
   `/api/v1/`.
8. **Genuinely collaborative Pages** with versioning and restore (Hocuspocus/Yjs).
9. **Deep i18n** — 21 locales × 28 namespaces, with a dedicated translation skill in the repo.

### B. What exists but could be improved

1. **Search** — extend beyond three fields; add a proper index.
2. **Filters** — collapse the legacy/rich duality; add URL state so views are shareable.
3. **Global views** — unlock the other four layouts and grouping.
4. **Activity feed** — paginate.
5. **Notification preferences** — honour the workspace/project scoping the model already has, and
   let users mute in-app, not just email.
6. **Relations** — surface the four backend-only types; consider soft blocking semantics.
7. **Modules** — reach cycle parity (progress/analytics endpoints).
8. **Cycles** — an explicit completion action with a frozen snapshot.
9. **Labels** — workspace scope and hierarchy are already in the schema; let Members create labels.
10. **Home** — replace the two `null` widgets and delete the orphaned dashboard store/service.
11. **Duplication** — deep-copy option (sub-items, relations, links).

### C. What is genuinely missing

1. **Due-date reminders / deadline notifications** (and any scheduled, time-based notification).
2. **Custom fields on work items.**
3. **Recurring work items.**
4. **Workflow / state-transition rules and required-field gates.**
5. **Realtime collaborative editing of work-item descriptions** (and presence indicators).
6. **Push notifications** (the `Device` model is unwired).
7. **Enforced dependency semantics and Gantt dependency visualisation.**
8. **Bulk property editing** (CE).
9. **Comment threading in the UI.**
10. **Saved cross-project reports / scheduled analytics digests.**
11. **Time tracking / worklogs.**

### D. Ranked enhancement priorities

#### P0 — Critical

**P0.1 Due-date reminder + deadline notification pipeline.**
The single largest functional gap: dates are captured, rendered and filtered everywhere, yet
nothing ever tells a user an item is due. Every ingredient exists — the `Notification` model, the
`EmailNotificationLog` batching queue, a Celery beat schedule, per-project timezones. Implement a
daily (or hourly) beat task that scans `target_date` for non-completed items and fans out through
the existing notification/email path, plus new preference columns. _Complexity: Medium. Risk:
Low_ (additive; the main design questions are timezone anchoring and notification volume).

**P0.2 Paginate the work-item activity feed.**
`IssueActivityEndpoint` returns the full history of an item, unbounded, and merges it with all
comments in Python. On long-lived items this is the most likely production performance failure in
the work-item surface. `BasePaginator` already exists. _Complexity: Low. Risk: Low._

**P0.3 Tighten `StateViewSet.partial_update`.**
A Guest can currently rename, recolour, re-sequence or re-group any project state — including
moving a state out of the `completed` group, which silently changes `completed_at` behaviour for
every future transition. Create/delete are already Admin-only; the update decorator is
inconsistent with them. _Complexity: Trivial. Risk: Low_ (verify no CE UI depends on Member-level
state editing before changing).

#### P1 — High

**P1.1 Full-text search over descriptions (and optionally comments).**
Users cannot find work by its content. Add `SearchVectorField` + GIN index maintained in
`Issue.save()`, and widen `filter_issues` / `search_issues`. _Medium / Medium._

**P1.2 URL-encoded filter state.**
Filters are per-user and invisible in the URL, so no filtered view can be shared or linked in a
comment. The `routeFilters` scaffolding shows this was intended. _Medium / Low._

**P1.3 Unlock layouts and grouping for workspace-level views.**
"All Issues", "Assigned", "Created", "Subscribed" and every saved workspace view are
spreadsheet-only and ungrouped — the cross-project overview is the weakest surface in the product
relative to how central it is. _Medium / Medium._

**P1.4 Bulk property update endpoint (CE).**
The frontend already implements optimistic bulk updates against a missing endpoint. Implementing
`bulk-operation-issues/` closes a real workflow gap and removes a broken code path.
_Medium / Medium._

**P1.5 Surface the four backend-only relation types.**
`start_before/after`, `finish_before/after`, `implements/implemented_by` are fully implemented
server-side (model choices, inverse mapping, list buckets) and merely absent from
`TIssueRelationTypes` and `ISSUE_RELATION_OPTIONS`. Very high value per unit of work.
_Low / Low._

#### P2 — Medium

**P2.1 Per-workspace/project notification preferences + in-app muting.** The FKs already exist and
are unused; in-app notifications currently ignore preferences entirely. _Medium / Medium._

**P2.2 Module progress/analytics endpoints.** Cycles have them; modules do not. Straight mirror of
`CycleProgressEndpoint`/`CycleAnalyticsEndpoint`. _Low / Low._

**P2.3 Explicit cycle completion.** Replace purely date-derived closure with an action that freezes
`progress_snapshot` and optionally notifies members. _Medium / Medium._

**P2.4 Comment threading UI.** `IssueComment.parent` and the serializer already support it.
_Low / Low._

**P2.5 Workspace-level labels + Member-level label creation.** The unique constraints for
`project IS NULL` labels are already in the schema. _Low / Low._

**P2.6 Work-item KPI widgets on Home.** The `advance-analytics*` endpoints already return the data;
Home has a widget registry and two `null` slots. _Low–Medium / Low._

**P2.7 Debt retirement.** Delete `DashboardStore` + `dashboard.service.ts` (orphaned), the
`IssueBlocker` / `Team` / `Importer` / `integration.*` models, and deprecate `issues/list/` and
`issues-detail/` in favour of `v2/issues/`. Continue the `@plane/ui` → `@makeplane/propel`
migration. _Medium / Medium (API deprecation window needed)._

#### P3 — Nice to have

**P3.1 Deep duplication** (copy sub-items, relations, links, optionally attachments).
**P3.2 Soft blocking semantics** — warn (not block) when completing an item with open `blocked_by`
relations; a hard block would need a workflow model.
**P3.3 Realtime work-item descriptions** via a new `apps/live` document type — high value, but
high cost: `description_binary` persistence, permission checks in the Hocuspocus layer, and a
migration path off debounced autosave.
**P3.4 Gantt dependency rendering** — requires a real edge model in the chart layer; the current
`enableDependency` plumbing provides no head start beyond the prop names.
**P3.5 Push notifications** — wire the existing `Device` model to a provider.
**P3.6 Recurring work items and scheduled analytics digests** — both depend on the P0.1 scheduling
infrastructure and should follow it, not precede it.

> Deliberately **not** recommended: custom fields, work-item types/epics, workflows, templates and
> time tracking. Each is a large, cross-cutting schema addition, and each already exists as an EE
> feature whose CE seams (`templateId`, `is_issue_type_enabled`, `StateOption` workflow props) are
> stubbed. Re-implementing them in CE is a strategic decision, not an incremental enhancement.

---

## 30. Final Conclusions

Plane CE is a **complete, coherent, production-grade work-item system** whose backend is
noticeably stronger than the CE frontend exposes. The recurring pattern found throughout this
analysis is not missing infrastructure but **unexposed or half-exposed infrastructure**: eight
relation types with four in the UI, workspace-label constraints with no workspace-label endpoint,
threaded-comment FKs with no reply UI, notification-preference scoping columns that are never read,
property-version snapshots with no consumer, five layouts of which workspace views can use one.

That has a clear implication for planning: **the highest-leverage enhancements are exposure and
completion work, not greenfield building.** P0.3, P1.5, P2.2, P2.4 and P2.5 are all small changes
that light up machinery already present.

The one true structural gap is **time**. Plane models dates thoroughly and schedules background
work reliably, but nothing in the system ever acts on a date arriving. Due-date reminders
(P0.1) are both the most requested class of feature for a task manager and the prerequisite for
recurring items, escalation and digests. It should be built first.

Finally, two pieces of debt will tax every future change to this area and should be paid down
alongside feature work rather than after it: the **dual filter systems** (`filters` +
`rich_filters`, `issue_filters.py` + `filterset.py`), which force every new filter to be
implemented twice, and the **prop-shaped EE seams** (`templateId`, `enableDependency`,
`filterAvailableStateIds`, `routeFilters`), which make it genuinely difficult to distinguish
declared surface from working surface — the single biggest source of wasted effort encountered
while producing this report.

---

## Verification Notes

### Thoroughly inspected (traced end-to-end in code)

- Work-item data model and `Issue.save()` semantics — `apps/api/plane/db/models/issue.py` read in full for the model classes.
- Work-item URL map and view permissions — `app/urls/issue.py` read in full; `views/issue/base.py` symbol map plus all `@allow_permission` decorators.
- State, label, cycle, module, notification, project, workspace, view, intake, estimate, issue-type models — field-level.
- Permission layer — `permissions/base.py` and `permissions/project.py` read directly.
- Notification pipeline — `notification_task.py` (creation branch read line-by-line at 190-420), `email_notification_task.py`, `issue_activities_task.py` (auto-subscribe block), `celery.py` beat schedule in full.
- Filters — `utils/issue_filters.py` function inventory, `utils/filters/filterset.py` `IssueFilterSet` in full, `packages/constants/src/issue/filter.ts` in full.
- Search — `views/search/base.py::filter_issues`, `utils/issue_search.py` in full.
- Grouping/pagination — `utils/grouper.py::issue_queryset_grouper`, `utils/paginator.py` class inventory.
- Frontend routes — `app/routes/core.ts` route inventory.
- Store architecture — `store/root.store.ts`, `store/issue/root.store.ts`, `base-issues.store.ts` symbol map, `project/filter.store.ts` persistence path.
- Layout/component trees — directory-level inventory plus targeted reads of `main-content.tsx`, `all-issue-layout-root.tsx`, `views/helper.tsx`, `spreadsheet/roots/workspace-root.tsx`, `quick-action-dropdowns/helper.tsx` and `project-issue.tsx`.
- Every claim of "dead / declared-but-unused" was verified by grepping for all consumers: `bulk-operation-issues/`, `useBulkOperationStatus`, `enableDependency`, `routeFilters`, `templateId`, `IssueBlocker`, `Team`, `Importer`, `Integration*`, `useDashboard`, `/issues/<id>/versions/`.

### Not verified / out of scope

- **`apps/admin` and `apps/space`** were only inventoried at directory level; their feature sets are not documented here.
- **Pages** (`db/models/page.py`, `apps/live`) were inspected only to the depth needed to contrast them with work items. A full Pages analysis was not performed.
- **Intake/triage** was confirmed to exist (models, urls, views, `core/components/inbox/`) but its state machine (`IntakeIssueStatus`, snooze, duplicate-to) was not traced end to end.
- **`apps/api/tests/`** was not run or reviewed; no assertion here is backed by test execution.
- **Migrations** were not read; statements about schema come from current model definitions, so a column could in principle exist in the database without a model field (or vice versa for very recent migrations).
- **Runtime behaviour was not observed** — the stack was not started, no request was issued, no query plan was measured. Performance statements (e.g. unpaginated activity) are structural inferences from code, not measurements.
- **The EE repository** was not available. Every "EE-only" attribution is inferred from CE stubs (upgrade banners, `() => false` hooks, ignored props, i18n bundles without consumers) and is stated as such.
- **`packages/hooks`, `packages/shared-state`, `packages/decorators`, `packages/codemods`** were not examined.
- **Estimates** were confirmed at model + endpoint level; the estimate UI flow (`core/components/estimates/`) was not traced.
- **Exact LOC/route counts** quoted (e.g. "41 routes", "33 tasks", "~55 folders") come from directory and grep counts, not from a build-time inventory.

### Assumptions made

1. The task brief's "Do NOT create files" rule and its "Deliverable: a report named
   `PLANE_CURRENT_FEATURE_ANALYSIS.md`" requirement conflict. Interpretation: the prohibition
   targets production code; the report itself is the requested artefact. Nothing else was created
   or modified.
2. `apps/web/core/**` is treated as the CE implementation. In upstream Plane, a `plane-web/`
   overlay adds EE code on top of these paths; that overlay is absent here, so all "not
   implemented" findings are CE-scoped.
3. "Issue" and "work item" are the same entity — the product renamed it; the schema
   (`db_table = "issues"`) did not. Both names are used interchangeably.
4. Frontend feature availability is read from constants (`ISSUE_DISPLAY_FILTERS_BY_PAGE`,
   `ISSUE_RELATION_OPTIONS`, `HOME_WIDGETS_LIST`) and switch statements (`views/helper.tsx`), which
   is where CE actually gates these; additional runtime gating could exist that was not found.

### Requires deeper investigation before building

- **Intake state machine** — before touching statuses or notifications, trace `IntakeIssueStatus`,
  `snoozed_till` and `duplicate_to` end to end.
- **Description migration path** (`description_binary` / the `Description` model) — several models
  now carry a `Description` FK; whether work-item descriptions are mid-migration to that table
  (and what `isMigrationUpdate` in `DescriptionInput` implies) matters for any realtime-editing
  work.
- **`rich_filters` migration status** — how many stored `filters` payloads remain unconverted, and
  whether `filter_migrations.py` runs lazily or as a one-shot.
- **Grouped pagination edge cases** — `SubGroupedOffsetPaginator` (`paginator.py:390-635`) was not
  read in detail and would need review before changing grouping behaviour.
- **Notification volume** — before shipping due-date reminders, measure current `Notification` and
  `EmailNotificationLog` growth; the table already carries nine indexes.
- **`CycleIssue` cardinality** — the one-cycle-per-item behaviour was inferred from endpoint/store
  behaviour rather than from a database constraint; confirm before relying on it.
