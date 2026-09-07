/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// components
import { Outlet } from "react-router";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { EmployeeGanttHeader } from "./header";

export default function EmployeeGanttLayout() {
  return (
    <>
      <AppHeader header={<EmployeeGanttHeader />} />
      {/* the chart owns its own scrolling, so the wrapper must not add a second scrollbar */}
      <ContentWrapper className="overflow-y-hidden">
        <Outlet />
      </ContentWrapper>
    </>
  );
}
