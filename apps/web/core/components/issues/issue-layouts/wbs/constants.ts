/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** left padding added per hierarchy level, matching the sub-work-item widget's step */
export const WBS_INDENT_PER_DEPTH = 22;

/**
 * Indentation stops growing past this depth so deeply nested rows do not push
 * the title off screen. The hierarchy itself stays unlimited — the WBS code and
 * the ancestor tooltip keep deep rows unambiguous.
 */
export const WBS_MAX_VISUAL_INDENT_DEPTH = 12;

/** reserved width for the derived WBS code column */
export const WBS_CODE_MIN_WIDTH = 64;

/** rows rendered eagerly before virtualization kicks in */
export const WBS_VIRTUALIZATION_THRESHOLD = 60;

/** depth up to which the tree is expanded on first load */
export const WBS_DEFAULT_EXPANDED_DEPTH = 1;
