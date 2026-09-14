/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Dispatch, ReactElement, SetStateAction } from "react";
import React, { useCallback, useEffect, useState, useRef } from "react";
// helpers
import { useIsMobileViewport, usePlatformOS } from "@plane/hooks";
import { cn } from "@plane/utils";

interface ResizableSidebarProps {
  showPeek?: boolean;
  togglePeek: (value?: boolean) => void;
  isCollapsed?: boolean;
  width: number;
  setWidth: Dispatch<SetStateAction<number>>;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  defaultCollapsed?: boolean;
  peekDuration?: number;
  toggleCollapsed: (value?: boolean) => void;
  onWidthChange?: (width: number) => void;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
  children?: ReactElement;
  extendedSidebar?: ReactElement;
  isAnyExtendedSidebarExpanded?: boolean;
  isAnySidebarDropdownOpen?: boolean;
}

export function ResizableSidebar({
  showPeek = false,
  togglePeek,
  peekDuration = 500,
  isCollapsed = false,
  toggleCollapsed: toggleCollapsedProp,
  onCollapsedChange,
  width,
  setWidth,
  onWidthChange,
  minWidth = 236,
  maxWidth = 350,
  className = "",
  children,
  extendedSidebar,
  isAnyExtendedSidebarExpanded = false,
  isAnySidebarDropdownOpen = false,
}: ResizableSidebarProps) {
  // states
  const [isResizing, setIsResizing] = useState(false);
  const [isHoveringTrigger, setIsHoveringTrigger] = useState(false);
  // refs
  const peekTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialWidthRef = useRef<number>(0);
  const initialMouseXRef = useRef<number>(0);
  // hooks
  const { isMobile } = usePlatformOS();
  const isSmallScreen = useIsMobileViewport();
  /**
   * Below `md` the sidebar can no longer sit next to the content without eating the
   * whole viewport, so it turns into an overlay drawer. Touch devices get the same
   * treatment at any width, hence the union with the user-agent check.
   */
  const isOverlayMode = isMobile || isSmallScreen;
  // handlers
  const setShowPeek = useCallback(
    (value: boolean) => {
      togglePeek(value);
    },
    [togglePeek]
  );

  const handleResize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const deltaX = e.clientX - initialMouseXRef.current;
      const newWidth = Math.min(Math.max(initialWidthRef.current + deltaX, minWidth), maxWidth);
      setWidth(newWidth);
    },
    [isResizing, minWidth, maxWidth, setWidth]
  );

  const startResizing = useCallback(
    (e: React.MouseEvent) => {
      setIsResizing(true);
      initialWidthRef.current = width;
      initialMouseXRef.current = e.clientX;
    },
    [width]
  );

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const toggleCollapsed = useCallback(() => {
    toggleCollapsedProp();
    setShowPeek(false);
    setIsHoveringTrigger(false);
    if (peekTimeoutRef.current) {
      clearTimeout(peekTimeoutRef.current);
    }
  }, [toggleCollapsedProp, setShowPeek]);

  const handlePeekEnter = useCallback(() => {
    if (isCollapsed && showPeek) {
      if (peekTimeoutRef.current) {
        clearTimeout(peekTimeoutRef.current);
      }
    }
  }, [isCollapsed, showPeek]);

  const handlePeekLeave = useCallback(() => {
    if (isCollapsed && !isAnyExtendedSidebarExpanded && !isAnySidebarDropdownOpen) {
      peekTimeoutRef.current = setTimeout(() => {
        setShowPeek(false);
      }, peekDuration);
    }
  }, [isCollapsed, peekDuration, setShowPeek, isAnyExtendedSidebarExpanded, isAnySidebarDropdownOpen]);

  // Set up event listeners for resizing
  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleResize);
      document.addEventListener("mouseup", stopResizing);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleResize);
      document.removeEventListener("mouseup", stopResizing);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, handleResize, stopResizing]);

  // Clean up timeout on unmount
  useEffect(
    () => () => {
      if (peekTimeoutRef.current) {
        clearTimeout(peekTimeoutRef.current);
      }
    },
    []
  );

  /**
   * Both of these react to one flag *closing*, not to any of the other values they
   * read - hence the previously trimmed dependency arrays. Comparing against the
   * previous value in a ref keeps that single trigger while letting the arrays list
   * everything the effects actually use.
   */
  const wasAnySidebarDropdownOpenRef = useRef(isAnySidebarDropdownOpen);
  useEffect(() => {
    const wasOpen = wasAnySidebarDropdownOpenRef.current;
    wasAnySidebarDropdownOpenRef.current = isAnySidebarDropdownOpen;
    if (wasOpen === isAnySidebarDropdownOpen) return;
    if (!isAnySidebarDropdownOpen && isCollapsed && isHoveringTrigger) {
      handlePeekLeave();
    }
  }, [isAnySidebarDropdownOpen, isCollapsed, isHoveringTrigger, handlePeekLeave]);

  const wasAnyExtendedSidebarExpandedRef = useRef(isAnyExtendedSidebarExpanded);
  useEffect(() => {
    const wasExpanded = wasAnyExtendedSidebarExpandedRef.current;
    wasAnyExtendedSidebarExpandedRef.current = isAnyExtendedSidebarExpanded;
    if (wasExpanded === isAnyExtendedSidebarExpanded) return;
    if (!isAnyExtendedSidebarExpanded && isCollapsed && isHoveringTrigger) {
      handlePeekLeave();
    }
  }, [isAnyExtendedSidebarExpanded, isCollapsed, isHoveringTrigger, handlePeekLeave]);

  // Reset peek when sidebar is expanded
  useEffect(() => {
    if (!isCollapsed) {
      setShowPeek(false);
      setIsHoveringTrigger(false);
      if (peekTimeoutRef.current) {
        clearTimeout(peekTimeoutRef.current);
      }
    }
  }, [isCollapsed, setShowPeek]);

  // Call external handlers when state changes
  useEffect(() => {
    onWidthChange?.(width);
  }, [width, onWidthChange]);

  /**
   * Notify on *changes* only. Firing this on mount - or again when React reconnects
   * the subtree - echoes a possibly stale value straight back into the owning store,
   * which can undo a collapse decided elsewhere in the same commit.
   */
  const lastReportedCollapsedRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const lastReported = lastReportedCollapsedRef.current;
    lastReportedCollapsedRef.current = isCollapsed;
    if (lastReported === undefined || lastReported === isCollapsed) return;
    onCollapsedChange?.(isCollapsed);
  }, [isCollapsed, onCollapsedChange]);

  /**
   * As an overlay the drawer must never grow past the viewport it is floating over,
   * so the stored (desktop) width is capped rather than replaced - narrow phones get
   * a drawer that leaves a strip of content visible to tap back onto.
   */
  const openWidth = isOverlayMode ? `min(${width}px, 85vw)` : `${width}px`;
  const resolvedWidth = isCollapsed ? "0px" : openWidth;

  return (
    <>
      {/* Backdrop - only in overlay mode, where the drawer floats above the content */}
      {isOverlayMode && !isCollapsed && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-[19] bg-backdrop"
          onClick={() => toggleCollapsedProp(true)}
        />
      )}
      {/* Main Sidebar */}
      <div
        id="main-sidebar"
        className={cn(
          "z-20 h-full border-r border-subtle bg-surface-1",
          !isResizing && "transition-all duration-300 ease-in-out",
          isCollapsed ? "w-0 translate-x-[-100%] opacity-0" : "translate-x-0 opacity-100",
          isOverlayMode && "absolute inset-y-0 left-0 z-20 shadow-raised-200",
          className
        )}
        style={{
          width: resolvedWidth,
          minWidth: resolvedWidth,
          maxWidth: resolvedWidth,
        }}
        role="complementary"
        aria-label="Main sidebar"
        data-prevent-outside-click={isOverlayMode}
      >
        <aside
          className={cn(
            "group/sidebar relative flex h-full w-full flex-col overflow-hidden bg-surface-1 pt-3",
            isAnyExtendedSidebarExpanded && "rounded-none"
          )}
        >
          {children}

          {/* Resize Handle */}
          <div
            className={cn(
              "absolute z-[20] h-full w-1 cursor-ew-resize transition-all duration-200",
              isOverlayMode && "hidden",
              !isResizing && "hover:bg-surface-2",
              isResizing && "w-1.5 bg-layer-1",
              "top-0 right-0"
            )}
            // onDoubleClick toggle sidebar
            onDoubleClick={() => toggleCollapsed()}
            onMouseDown={(e) => startResizing(e)}
            role="separator"
            aria-label="Resize sidebar"
          />
        </aside>
      </div>
      {/* Peek View */}
      <div
        className={cn(
          "shadow-sm absolute left-0 z-20 h-full bg-surface-1",
          !isResizing && "transition-all duration-300 ease-in-out",
          isCollapsed && showPeek ? "translate-x-0 opacity-100" : "translate-x-[-100%] opacity-0",
          "pointer-events-none",
          isCollapsed && showPeek && "pointer-events-auto",
          !showPeek ? "w-0" : "w-full"
        )}
        style={{
          width: openWidth,
        }}
        onMouseEnter={handlePeekEnter}
        onMouseLeave={handlePeekLeave}
        role="complementary"
        aria-label="Sidebar peek view"
      >
        <aside
          className={cn(
            "group/sidebar relative z-20 flex h-full w-full flex-col overflow-hidden bg-surface-1 pt-4",
            "self-center rounded-md rounded-tl-none rounded-bl-none border-r border-subtle",
            isAnyExtendedSidebarExpanded && "rounded-none"
          )}
        >
          {children}
          {/* Resize Handle */}
          <div
            className={cn(
              "absolute z-[20] h-full w-1 cursor-ew-resize transition-all duration-200",
              isOverlayMode && "hidden",
              !isResizing && "hover:bg-surface-2",
              isResizing && "bg-layer-1",
              "top-0 right-0"
            )}
            // onDoubleClick toggle sidebar
            onDoubleClick={() => toggleCollapsed()}
            onMouseDown={(e) => startResizing(e)}
            role="separator"
            aria-label="Resize sidebar"
          />
        </aside>
      </div>

      {/* Extended Sidebar */}
      {extendedSidebar}
    </>
  );
}
