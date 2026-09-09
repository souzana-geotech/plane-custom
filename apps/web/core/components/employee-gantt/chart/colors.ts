/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { STATE_GROUPS } from "@plane/constants";
import type { IState, TStateGroups } from "@plane/types";

/**
 * Bars are coloured by **work item state**, using the exact same source of truth as the project
 * gantt: the state's own colour, as configured per project, falling back to the colour of its
 * state group. Nothing here invents a palette - a task that is amber on the project timeline is
 * amber here too.
 *
 * The one difference is strength. The project gantt paints the raw state colour and lays a 50%
 * surface wash over it; this view stacks many more, much shorter bars per screen, so the same
 * wash is taken further to a pastel tint. Mixing against the surface token rather than plain
 * white keeps the tint correct in both themes, the same way the project gantt's overlay does.
 */

/** Used when a task has no state at all, which the workspace endpoint does allow. */
const DEFAULT_STATE_COLOR = STATE_GROUPS.backlog.color;

/**
 * The raw, full-strength status colour of an assignment: the state's own colour when its project's
 * states are loaded, otherwise the colour of the state group the server resolved for it.
 */
export const getStatusColor = (state: IState | undefined, stateGroup: TStateGroups | null): string => {
  if (state?.color) return state.color;
  if (stateGroup) return STATE_GROUPS[stateGroup]?.color ?? DEFAULT_STATE_COLOR;
  return DEFAULT_STATE_COLOR;
};

/** How much of the raw status colour survives in the bar fill. */
const FILL_STRENGTH = 30;

/**
 * Pastel fill for a bar body: the status colour mixed toward the current theme's surface, the same
 * move the project gantt makes with its surface wash, taken further.
 */
export const getStatusFill = (color: string): string =>
  `color-mix(in srgb, ${color} ${FILL_STRENGTH}%, var(--background-color-surface-1))`;

/**
 * Borders keep the status colour at full strength.
 *
 * A pastel of an already pale status - backlog grey most of all - lands within a few percent of
 * the white chart behind it, so a softened border would leave those bars effectively invisible.
 * One hairline of the real colour is enough to define the bar without undoing the soft fill.
 */
export const getStatusEdge = (color: string): string => color;
