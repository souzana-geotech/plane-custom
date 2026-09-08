/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import type { ISvgIcons } from "../type";

/**
 * Geotech3D lockup.
 *
 * Deliberately still exported as `PlaneLockup`: this is the one brand mark in the
 * product, referenced from eight call sites across web, space and admin. Keeping
 * the name makes the rebrand a one-file change rather than a rename rippling
 * through those call sites and the icons barrel, which keeps merging upstream
 * Plane changes cheap. Only the artwork inside is ours.
 *
 * The lettering uses `color` (currentColor by default), so callers keep working
 * unchanged -- `className="text-primary"` gives dark letters on light themes and
 * light letters on dark ones, with no light/dark asset pair to maintain.
 *
 * The "GEOSPATIAL SERVICES" caption bar of the full logo is deliberately omitted.
 * Every call site renders this between 16px and 44px tall, and at those sizes the
 * caption is roughly 4px of text -- it rendered as an unreadable smear on a green
 * band. The full captioned artwork lives in
 * packages/tailwind-config/brand/wordmark-{light,dark}.svg for print and any
 * larger placement. The metallic gradient on the "3D" is flattened for the same
 * reason, and because a gradient cannot follow currentColor across themes.
 */
export function PlaneLockup({ width = "253", height = "53", className, color = "currentColor" }: ISvgIcons) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 410.2 33.2"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Geotech3D"
    >
      {/* GEOTECH */}
      <path
        d="M16.6,33.2c-3.1-.2-5.7-.9-7.9-2.1C3.4,28.4.8,23.6.8,16.6S3.4,4.9,8.7,2.1C10.9,1,13.5.3,16.6,0h25.3v4.2h-25.3c-4.2.6-6.3,4.8-6.3,12.5s2.1,11.8,6.3,12.5h15.8c1-.1,1.8-.4,2.6-1,1.8-1.4,3-3.8,3.5-7.3h-9.2v-4.2h19c0,6.9-2.6,11.8-7.9,14.5-2.2,1.2-4.8,1.9-7.9,2.1h-15.8Z"
        fill={color}
      />
      <path
        d="M60.6,14.6h28.5v4.2h-28.5c.4,6.4,2.5,9.8,6.3,10.3h22.2v4.2h-22.2c-3.1-.2-5.7-.9-7.9-2.1-5.3-2.8-7.9-7.6-7.9-14.5s2.6-11.8,7.9-14.5c2.2-1.2,4.8-1.9,7.9-2.1h22.2v4.2h-22.2c-1.1.2-2.1.6-2.9,1.3-2,1.7-3.1,4.8-3.4,9.1Z"
        fill={color}
      />
      <path
        d="M124.2,33.2h-15.8c-3.1-.2-5.7-.9-7.9-2.1-5.3-2.8-7.9-7.6-7.9-14.5s2.6-11.8,7.9-14.5c2.2-1.2,4.8-1.9,7.9-2.1h15.8c3.1.2,5.7.9,7.9,2.1,5.3,2.8,7.9,7.6,7.9,14.5s-2.6,11.8-7.9,14.5c-2.2,1.2-4.8,1.9-7.9,2.1ZM124.2,4.2h-15.8c-4.2.6-6.3,4.8-6.3,12.5s2.1,11.8,6.3,12.5h15.8c4.2-.6,6.3-4.8,6.3-12.5s-2.1-11.8-6.3-12.5Z"
        fill={color}
      />
      <path d="M141.6,0h41.2v4.2h-15.8v29.1h-9.5V4.2h-15.8V0Z" fill={color} />
      <path
        d="M194,14.6h28.5v4.2h-28.5c.4,6.4,2.5,9.8,6.3,10.3h22.2v4.2h-22.2c-3.1-.2-5.7-.9-7.9-2.1-5.3-2.8-7.9-7.6-7.9-14.5s2.6-11.8,7.9-14.5c2.2-1.2,4.8-1.9,7.9-2.1h22.2v4.2h-22.2c-1.1.2-2.1.6-2.9,1.3-2,1.7-3.1,4.8-3.4,9.1Z"
        fill={color}
      />
      <path
        d="M241.7,0h22.2v4.2h-22.2c-4.2.6-6.3,4.8-6.3,12.5s2.1,11.8,6.3,12.5h22.2v4.2h-22.2c-3.1-.2-5.7-.9-7.9-2.1-5.3-2.8-7.9-7.6-7.9-14.5s2.6-11.8,7.9-14.5c2.2-1.2,4.8-1.9,7.9-2.1Z"
        fill={color}
      />
      <path d="M298.9,0h9.5v33.2h-9.5v-14.4h-22.2v14.4h-9.5V0h9.5v14.7h22.2V0Z" fill={color} />
      {/* the stylised 3D */}
      <path
        d="M346.1,15c-.3-6.7-2.4-10.3-6.3-10.8h-28.6V0h28.5c3.1.2,5.7.9,7.9,2.1,5.3,2.8,7.9,7.6,7.9,14.5s-2.6,11.8-7.9,14.5c-2.2,1.2-4.8,1.9-7.9,2.1h-28.5v-4.2h28.6c1.1-.2,2-.6,2.9-1.2,1.9-1.7,3.1-4.6,3.4-8.7h-27.9v-4.2h27.9Z"
        fill={color}
      />
      <path
        d="M401.5,2.1c-2.2-1.2-4.8-1.9-7.9-2.1h-31.7v33.2h31.7c3.1-.2,5.7-.9,7.9-2.1,5.3-2.8,7.9-7.6,7.9-14.5s-2.6-11.8-7.9-14.5ZM393.6,29.1h-22.2V4.2h22.2c4.2.6,6.3,4.8,6.3,12.5s-2.1,11.8-6.3,12.5Z"
        fill={color}
      />
    </svg>
  );
}
