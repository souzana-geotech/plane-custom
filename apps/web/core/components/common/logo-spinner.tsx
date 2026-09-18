/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
// assets
import WordmarkDark from "@plane/tailwind-config/brand/wordmark-dark.svg?url";
import WordmarkLight from "@plane/tailwind-config/brand/wordmark-light.svg?url";

/**
 * Full-screen loading indicator.
 *
 * Replaces a pair of 65-frame animated GIFs of the Plane logo (~2 MB per app)
 * with the vector brand logo and a pulse.
 *
 * This uses the FULL logo including the "GEOSPATIAL SERVICES" caption bar, unlike
 * PlaneLockup, which drops it. The split is deliberate and size-driven: this
 * renders 24-44px tall and centred, where the caption is legible and the green
 * bar is the only brand colour on an otherwise empty screen. PlaneLockup renders
 * ~16px tall in headers, where the same caption becomes an unreadable smear.
 *
 * A light/dark asset pair is needed here because the full artwork is multi-colour
 * (the caption reverses out of the green bar), so it cannot ride on currentColor
 * the way the caption-free lockup does.
 */
export function LogoSpinner() {
  const { resolvedTheme } = useTheme();
  // `resolvedTheme` comes from localStorage, so it is already set on the client's first render but
  // never on the server. Holding the light asset until mount keeps the two renders identical — the
  // dark one swaps in a frame later — instead of mismatching the `src` and failing hydration.
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const logoSrc = isMounted && resolvedTheme === "dark" ? WordmarkDark : WordmarkLight;

  return (
    <div className="flex items-center justify-center">
      <img src={logoSrc} alt="Geotech3D" className="h-6 w-auto animate-pulse object-contain sm:h-11" />
    </div>
  );
}
