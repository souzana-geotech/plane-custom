/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Footer of the "what's new" modal.
 *
 * Every element upstream puts here points at Plane Software: docs, changelog,
 * support mail, forum, and a "Powered by Plane Pages" button carrying the Plane
 * logo. None of it can serve Geotech3D staff -- they cannot raise a ticket with
 * Plane support -- and all of it leaks the upstream brand, so the footer renders
 * nothing.
 *
 * Kept as an exported component so the call site in modal.tsx is unchanged from
 * upstream and merges stay cheap.
 */
export function ProductUpdatesFooter() {
  return null;
}
