/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useParams, usePathname } from "next/navigation";
import { SIDEBAR_WIDTH } from "@plane/constants";
import { useIsMobileViewport, useLocalStorage } from "@plane/hooks";
// components
import { ResizableSidebar } from "@/components/sidebar/resizable-sidebar";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
// local imports
import { AppSidebar } from "./sidebar";

export const ProjectAppSidebar = observer(function ProjectAppSidebar() {
  // store hooks
  const { sidebarCollapsed, toggleSidebar, sidebarPeek, toggleSidebarPeek, isAnySidebarDropdownOpen } = useAppTheme();
  const { storedValue, setValue } = useLocalStorage("sidebarWidth", SIDEBAR_WIDTH);
  // hooks
  const isSmallScreen = useIsMobileViewport();
  // states
  const [sidebarWidth, setSidebarWidth] = useState<number>(storedValue ?? SIDEBAR_WIDTH);
  // routes
  const { workspaceSlug } = useParams();
  const pathname = usePathname();
  // derived values

  const isNotificationsPath = pathname.includes(`/${workspaceSlug}/notifications`);

  /**
   * Below `md` the sidebar renders as an overlay drawer, so it has to start closed or
   * it lands on top of the page. Collapse it when the viewport crosses into that range
   * and put it back the way the user had it on the way out - the pre-collapse value
   * lives in a ref so the persisted desktop preference survives the round trip.
   *
   * `sidebarCollapsed` is `undefined` until StoreWrapper restores it from local
   * storage; collapsing before that lands in the same commit as the restore and is
   * immediately overwritten by it, so wait for a real value first.
   */
  const wasSmallScreenRef = useRef<boolean | null>(null);
  const collapsedBeforeSmallScreenRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (sidebarCollapsed === undefined) return;
    if (isSmallScreen === wasSmallScreenRef.current) return;
    wasSmallScreenRef.current = isSmallScreen;
    if (isSmallScreen) {
      collapsedBeforeSmallScreenRef.current = sidebarCollapsed;
      if (!sidebarCollapsed) toggleSidebar(true);
    } else if (collapsedBeforeSmallScreenRef.current === false && sidebarCollapsed) {
      toggleSidebar(false);
    }
  }, [isSmallScreen, sidebarCollapsed, toggleSidebar]);

  /**
   * On small screens the sidebar is an overlay drawer, so following one of its links
   * would otherwise leave the drawer sitting on top of the page the user just opened.
   * Dismiss it on navigation - but only there, so the docked desktop sidebar stays put.
   */
  const previousPathnameRef = useRef(pathname);
  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    if (isSmallScreen && !sidebarCollapsed) toggleSidebar(true);
  }, [pathname, isSmallScreen, sidebarCollapsed, toggleSidebar]);

  // handlers
  const handleWidthChange = (width: number) => setValue(width);

  if (isNotificationsPath) return null;

  return (
    <>
      <ResizableSidebar
        showPeek={sidebarPeek}
        defaultWidth={storedValue ?? 250}
        width={sidebarWidth}
        setWidth={setSidebarWidth}
        defaultCollapsed={sidebarCollapsed}
        peekDuration={1500}
        onWidthChange={handleWidthChange}
        isCollapsed={sidebarCollapsed}
        toggleCollapsed={toggleSidebar}
        togglePeek={toggleSidebarPeek}
        isAnySidebarDropdownOpen={isAnySidebarDropdownOpen}
      >
        <AppSidebar />
      </ResizableSidebar>
    </>
  );
});
