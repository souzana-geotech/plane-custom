/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Auth screen footer.
 *
 * Upstream renders "Join 10,000+ teams building with Plane" above the logos of
 * Zerodha, Sony, Dolby and Accenture. Both are Plane's marketing: the claim is
 * not ours to make, and those are third-party trademarks shown as Plane's
 * customers, so presenting them under Geotech3D branding would misrepresent
 * them. There is no Geotech3D equivalent to swap in -- this is an internal tool
 * with no social proof to display -- so the footer renders nothing.
 *
 * Kept as an exported component rather than deleted, so the call site in
 * auth-base.tsx stays identical to upstream and merges stay cheap. The parent is
 * a flex column with no `gap`, so rendering null leaves no spacing artifact.
 */
export function AuthFooter() {
  return null;
}
