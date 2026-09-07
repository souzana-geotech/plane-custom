/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { cn } from "@plane/utils";
// local imports
import type { TTimelineScale } from "../data/timeline";
import { HEADER_HEIGHT } from "./constants";

type Props = {
  scale: TTimelineScale;
  /** measured width of the sticky employee column, so the pinned label clears it */
  columnWidth: number;
};

/**
 * Two-line timeline header. Every tick is sized from the same `dayWidth` the bars use, so the
 * header and the chart body can never fall out of step.
 */
export function EmployeeGanttTimelineHeader(props: Props) {
  const { scale, columnWidth } = props;

  return (
    <div className="flex flex-col" style={{ width: scale.width, height: HEADER_HEIGHT }}>
      <div className="flex h-1/2 items-stretch">
        {scale.majorSegments.map((segment) => (
          <div
            key={segment.key}
            className="flex shrink-0 items-center border-r border-b border-subtle px-2"
            style={{ width: segment.days * scale.dayWidth }}
          >
            {/*
              Pinned just right of the sticky employee column so a wide segment keeps its label on
              screen while it is scrolled through, instead of leaving the row looking empty.
            */}
            <span className="sticky truncate text-11 font-semibold text-secondary" style={{ left: columnWidth + 8 }}>
              {segment.label}
            </span>
          </div>
        ))}
      </div>
      <div className="flex h-1/2 items-stretch">
        {scale.minorSegments.map((segment) => (
          <div
            key={segment.key}
            className={cn(
              "flex shrink-0 flex-col items-center justify-center border-r border-b border-subtle",
              segment.isWeekend && "bg-layer-1",
              segment.isToday && "bg-accent-primary/10"
            )}
            style={{ width: segment.days * scale.dayWidth }}
          >
            <span
              className={cn(
                "truncate text-10 leading-tight",
                segment.isToday ? "font-semibold text-accent-primary" : "text-tertiary"
              )}
            >
              {segment.label}
            </span>
            {segment.sublabel && scale.zoom === "day" && (
              <span className="text-9 leading-tight text-placeholder">{segment.sublabel}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
