# Employee resource gantt

Route: `/:workspaceSlug/employee-gantt`.

A standalone, **read-only** management view of who is working on what across every project, organised
as **Employee → Work item / client job → Time**.

## Relationship to the existing gantt

This feature is completely independent of the project gantt in `core/components/gantt-chart`. It was
built separately rather than reusing that engine for two concrete reasons:

1. The timeline stores (`core/store/timeline`) are **singletons on the root store**, keyed by
   timeline type. `blocksMap` / `blockIds` are shared per type, so mounting a second chart of an
   existing type would fight with the project gantt over `setBlockIds`.
2. Introducing a new timeline type would require editing `getTimelineStore`
   (`core/hooks/use-timeline-chart.ts`) and `TimeLineStore` — i.e. modifying existing gantt code.

So nothing here imports from `components/gantt-chart`, `store/timeline`, or `hooks/use-timeline-chart`,
and no existing gantt file, route or API was changed. The timeline maths in `data/timeline.ts` is a
small, self-contained set of pure functions over whole day numbers.

Unlike the project gantt, there is **no drag, resize, reorder or dependency editing** here. Nothing on
this page can write back to a work item; bars are links to the work item.

## Data sources (all pre-existing endpoints)

| Data       | Endpoint / store                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Work items | `GET /api/workspaces/:slug/issues/` via `EmployeeGanttService.getWorkspaceWorkItems`, paged     |
| Employees  | member store (`workspaceMemberIds` + `getUserDetails`), already loaded by the workspace wrapper |
| Projects   | project store (`joinedProjectIds`, `getProjectById`, `getProjectIdentifierById`)                |

`EmployeeGanttService` composes the existing `WorkspaceService.getViewIssues`; without an `expand`
param that resolves to the cross-project work item list that already powers workspace views. The
backend permission-filters it per project and already excludes archived, draft and triage work items,
so the page makes exactly **one** kind of request and adds no backend code.

The serializer returns `state__group` directly, so state groups need no extra lookup.

The endpoint is admin/member only in practice, so the page is gated to those workspace roles.

## Model

- A work item becomes **one assignment per assignee**, which is what places a shared job on two lanes.
- Only work items with at least one date can be placed. Items with neither are counted per employee as
  _undated_ rather than invented onto the timeline.
- `full` = start + due date. `target_only` / `start_only` render as a single dashed day, because one
  date is a point in time, not a span.
- **Open** = state group is not `completed` and not `cancelled`. Cancelled work is never shown;
  completed work is off by default and can be toggled on.

## Reading the chart

The visual language is deliberately small, and the legend under the chart spells out only the marks
actually on screen.

- **Bars carry no text, at any zoom.** Bars are frequently only a few pixels wide, so a label always
  ends up truncated, floated beside the bar, or squeezed between neighbours - each of which costs
  more clarity than it buys. The bar encodes **position** (when), **length** (how long) and
  **colour** (which project). Everything else is one hover away, and the legend says so.
- **The tooltip is the whole story**: work item identifier and name, project, start → due, duration,
  and any note worth flagging (only one date set, completed, overlapping, overdue).
- **Colour = project** (`chart/colors.ts`), not state group. This view is cross-project, so "which
  project is this person on?" is the question colour should answer at a glance. A project uses its
  own icon colour when it has one, otherwise a stable colour derived from its id.
- **A dashed outline** means only one of the two dates is set, so the item is a point in time rather
  than a span. **Reduced opacity** means completed.
- **An amber band plus a ring** marks overlapping work; **a left accent on the row** marks someone
  overloaded today. An **overdue** item keeps its warning icon on the bar - it is the one thing that
  should be findable without hovering.
- **Hover** raises an accent ring on the bar; that ring is the only affordance the bar needs, since
  there is nothing on it to read.
- The **summary strip is interactive**: "With overlaps" is a filter toggle, not a static number.

## The employee column is responsive

The sticky employee column is subtracted from the visible timeline, so a fixed width starves the
chart on a narrow viewport. It is sized from the chart container's own measured width (a
`ResizeObserver` in `chart/root.tsx`, read in a layout effect so the first paint is already correct)
rather than a media query, because what matters is the room left for the timeline, not the browser
width - the app sidebar and page padding both eat into it.

| Container width | Column | Notes                         |
| --------------- | ------ | ----------------------------- |
| `>= 860`        | 288    | full detail                   |
| `600 - 859`     | 232    | full detail                   |
| `< 600`         | 180    | the "next up" line is dropped |

At 368px of container this takes the timeline from 80px to 188px of usable width. The same measured
width feeds `todayScrollLeft`, whose inset is a fraction of the _timeline_ width: a fixed inset
parks today underneath (or past) the sticky column on a narrow viewport, which made the "Today"
button look broken because today was still off screen after it scrolled.

## Overlap and capacity rules (`data/schedule.ts`)

- **Lane packing** — greedy first-fit by start day. Ranges are inclusive, so two assignments touching
  on the same day already count as overlapping. The number of lanes equals peak concurrency, so
  overlapping bars are never drawn on top of each other.
- **Overlap windows** — a sweep over start / end+1 events returns every day range where more than one
  _open_ assignment is active, with the peak count inside it. Rendered as an amber band behind the
  bars, an amber border and icon on each bar, and a badge in the employee column.
- **Capacity** is judged on **today** by the number of open assignments whose range contains today:
  `0 → available`, `1 → assigned`, `2 → busy`, `>= 3 → overloaded` (`BUSY_THRESHOLD`,
  `OVERLOADED_THRESHOLD`). Rows sort worst-first, so overloaded people are at the top.
- **Next up** is the earliest open assignment starting after today.

## Timeline (`data/timeline.ts`)

`dayWidth` is the single knob per zoom; every position is `(day - startDay) * dayWidth`, so bars,
header ticks and the today marker cannot drift apart. Dates are converted to whole day numbers via
`Date.UTC`, so comparisons ignore time zones.

| Zoom  | dayWidth | Minor ticks | Major ticks |
| ----- | -------- | ----------- | ----------- |
| day   | 32       | days        | months      |
| week  | 15       | weeks       | months      |
| month | 5.5      | months      | years       |

The window is padded around the data range, always widened to include today, and snapped to whole
weeks (day/week) or months (month zoom) so header ticks are complete. It is sized from **all** lanes,
not just the visible ones, so changing a filter does not make the timeline jump.

## Filters

Project, employee and employee-name search live in the toolbar, alongside three display toggles:

- **Today only** — keeps just the assignments scheduled to be in progress today, i.e. whose
  inclusive range contains today. Work that ended earlier or starts later drops out, as does
  undated work, since none of it is scheduled for today. The timeline window narrows to the
  remaining work and re-centres on today, and the employee cell hides its "next up" line, which
  would otherwise report "nothing scheduled next" for someone whose future work the filter just
  removed. Employees with nothing today stay on screen as `Available`, which is the point: the
  filter answers both "who is busy right now" and "who is free".
- **Hide unassigned employees** and **include completed**. The third filter, **only overlaps**, is the summary strip's
  "With overlaps" chip rather than a separate control, so the number and the action are the same thing.

All filtering is client-side over the loaded dataset and never touches workspace or project filter
state. The timeline window size deliberately ignores filters, so toggling one does not make the chart
jump.

## Deliberately not shown

- **Hour-level capacity / utilisation** — work items carry dates, not times of day or effort
  estimates, so a true utilisation percentage cannot be derived. Capacity is reported as a count of
  concurrent assignments, which is what the data actually supports.
- **Unassigned work** — this view is employee-centric; unassigned work items have no lane. The
  operations dashboard already reports them.
