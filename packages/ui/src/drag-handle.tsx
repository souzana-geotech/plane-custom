/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { MoreVerticalOutline } from "@makeplane/propel/icons";
import React, { forwardRef } from "react";
// helpers
import { cn } from "./utils";

interface IDragHandle {
  className?: string;
  disabled?: boolean;
  /**
   * Pass `div` when the handle already sits inside an interactive element — a tooltip trigger
   * button, a `Disclosure.Button`. A nested `<button>` is invalid HTML, so the server and client
   * markup disagree and React bails out of hydrating the whole tree.
   */
  as?: "button" | "div";
}

const handleContextMenu = (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

export const DragHandle = forwardRef(function DragHandle(
  props: IDragHandle,
  ref: React.ForwardedRef<HTMLButtonElement | null>
) {
  const { className, disabled = false, as = "button" } = props;

  if (disabled) {
    return <div className="h-[18px] w-[14px]" />;
  }

  const handleClassName = cn("flex flex-shrink-0 cursor-grab rounded-sm bg-surface-2 p-0.5 text-secondary", className);

  const dots = (
    <>
      <MoreVerticalOutline className="h-3.5 w-3.5 text-placeholder" />
      <MoreVerticalOutline className="-ml-5 h-3.5 w-3.5 text-placeholder" />
    </>
  );

  if (as === "div") {
    return (
      <div
        className={handleClassName}
        onContextMenu={handleContextMenu}
        ref={ref as React.ForwardedRef<HTMLDivElement>}
      >
        {dots}
      </div>
    );
  }

  return (
    <button type="button" className={handleClassName} onContextMenu={handleContextMenu} ref={ref}>
      {dots}
    </button>
  );
});

DragHandle.displayName = "DragHandle";
