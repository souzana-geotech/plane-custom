/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// hooks
import { useHome } from "@/hooks/store/use-home";
// local imports
import { ActivityPanel } from "./activity";
import { LinksPanel } from "./links";

/**
 * Secondary context beside the queue: the user's recent activity, then quick links. Both follow the
 * "Manage widgets" toggles (Recent → activity, Quick Links → links) and the order chosen there.
 */
export const MyWorkSidebar = observer(function MyWorkSidebar({ workspaceSlug }: { workspaceSlug: string }) {
  const { widgetsMap, orderedWidgets } = useHome();

  const panels: Partial<Record<string, React.ReactNode>> = {
    recents: <ActivityPanel key="recents" workspaceSlug={workspaceSlug} />,
    quick_links: <LinksPanel key="quick_links" workspaceSlug={workspaceSlug} />,
  };

  const visible = orderedWidgets.filter((key) => widgetsMap[key]?.is_enabled && panels[key]);
  if (visible.length === 0) return null;

  return (
    <aside className="flex flex-col gap-8 border-t border-subtle pt-6 lg:border-t-0 lg:border-l lg:pt-1 lg:pl-8">
      {visible.map((key) => panels[key])}
    </aside>
  );
});
