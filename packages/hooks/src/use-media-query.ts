/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useSyncExternalStore } from "react";

/**
 * Tailwind's default breakpoints, as the raw pixel values behind `sm:`, `md:` and
 * friends. Keep these in sync with the Tailwind config so a media query written in
 * JS and a `md:` utility written in JSX always flip at the same width.
 */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

export type TBreakpoint = keyof typeof BREAKPOINTS;

const getServerSnapshot = () => false;

/**
 * Subscribes to a CSS media query and re-renders when it starts or stops matching.
 *
 * Unlike `usePlatformOS().isMobile` — which sniffs the user agent and therefore
 * never changes for the life of the tab — this tracks the *viewport*, so layout
 * decisions made with it stay correct when a desktop window is simply narrow.
 * Use `usePlatformOS` for touch/OS affordances (tooltips, autofocus) and this for
 * anything that changes the layout.
 *
 * Server-safe: renders as `false` on the server and during hydration.
 */
export const useMediaQuery = (query: string): boolean => {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mediaQueryList = window.matchMedia(query);
      mediaQueryList.addEventListener("change", onStoreChange);
      // `resize` is a belt-and-braces second source: some embedded/emulated browser
      // environments resize the viewport without ever dispatching the MQL `change`
      // event, which would otherwise leave the layout stuck on the old breakpoint.
      // `getSnapshot` re-reads `matches`, so the duplicate notifications are free.
      window.addEventListener("resize", onStoreChange);
      return () => {
        mediaQueryList.removeEventListener("change", onStoreChange);
        window.removeEventListener("resize", onStoreChange);
      };
    },
    [query]
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};

/** True while the viewport is narrower than the given breakpoint (defaults to `md`, i.e. < 768px). */
export const useIsSmallerThan = (breakpoint: TBreakpoint = "md"): boolean =>
  useMediaQuery(`(max-width: ${BREAKPOINTS[breakpoint] - 0.02}px)`);

/**
 * True on phone-sized viewports — everything below Tailwind's `md` breakpoint.
 * This is the app-wide switch between the stacked/overlay mobile layout and the
 * side-by-side desktop layout.
 */
export const useIsMobileViewport = (): boolean => useIsSmallerThan("md");

/** True on tablet-and-below viewports — everything below Tailwind's `lg` breakpoint. */
export const useIsCompactViewport = (): boolean => useIsSmallerThan("lg");
