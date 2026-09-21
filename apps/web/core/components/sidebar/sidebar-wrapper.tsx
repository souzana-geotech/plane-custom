/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
// plane helpers
import { useIsMobileViewport, useOutsideClickDetector } from "@plane/hooks";
import { PreferencesOutline } from "@makeplane/propel/icons";
import { ScrollArea } from "@plane/propel/scrollarea";
// components
import { CustomizeNavigationDialog } from "@/components/navigation/customize-navigation-dialog";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
// plane web components
import { AppSidebarToggleButton } from "./sidebar-toggle-button";
import { IconButton } from "@plane/propel/icon-button";

type TSidebarWrapperProps = {
  children: React.ReactNode;
  quickActions?: React.ReactNode;
};

export const SidebarWrapper = observer(function SidebarWrapper(props: TSidebarWrapperProps) {
  const { children, quickActions } = props;
  // state
  const [isCustomizeNavDialogOpen, setIsCustomizeNavDialogOpen] = useState(false);
  // store hooks
  const { toggleSidebar, sidebarCollapsed } = useAppTheme();
  // hooks
  const isSmallScreen = useIsMobileViewport();
  // refs
  const ref = useRef<HTMLDivElement>(null);

  // Tapping outside the overlay drawer dismisses it, the same as tapping the backdrop.
  useOutsideClickDetector(ref, () => {
    if (isSmallScreen && sidebarCollapsed === false) toggleSidebar(true);
  });

  return (
    <>
      <CustomizeNavigationDialog isOpen={isCustomizeNavDialogOpen} onClose={() => setIsCustomizeNavDialogOpen(false)} />
      <div ref={ref} className="flex h-full w-full animate-fade-in flex-col">
        <div className="flex flex-col gap-3 px-3">
          {/* Workspace switcher and settings */}

          <div className="flex items-center justify-end gap-2 px-2">
            <div className="flex flex-shrink-0 items-center gap-2">
              <IconButton
                size="base"
                variant="ghost"
                icon={PreferencesOutline}
                onClick={() => setIsCustomizeNavDialogOpen(true)}
              />
              <AppSidebarToggleButton />
            </div>
          </div>
          {/* Quick actions */}
          {quickActions}
        </div>

        <ScrollArea
          orientation="vertical"
          scrollType="hover"
          size="sm"
          rootClassName="size-full overflow-x-hidden overflow-y-auto"
          viewportClassName="flex flex-col gap-3 overflow-x-hidden h-full w-full overflow-y-auto px-3 pt-3 pb-0.5"
        >
          {children}
        </ScrollArea>
        {/* Geotech3D: the footer bar held only WorkspaceEditionBadge - the "Community"
            edition label, which opens Plane's upgrade-to-paid modal. Both are Plane
            branding, so the bar goes with it rather than leaving an empty 48px strip.
            The upstream HelpMenu / AppSidebarToggleButton it also carried were already
            commented out. */}
      </div>
    </>
  );
});
