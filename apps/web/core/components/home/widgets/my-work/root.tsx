/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// hooks
import { useUser } from "@/hooks/store/user";
// local imports
import { MyTasksSection } from "./my-tasks";
import { QuickActions } from "./quick-actions";
import { TodaySection } from "./today";
import { UpcomingSection } from "./upcoming";
import { useMyWorkItems } from "./use-my-work-items";

export type TMyWorkSectionsProps = {
  workspaceSlug: string;
};

/**
 * The heart of My Work: Today, Coming Up, My Tasks, and Quick Actions, in the priority order
 * spec'd for the page (what needs attention now → what's in progress → what's next →
 * everything else). Today and Coming Up share one fetch of the user's open work items.
 */
export const MyWorkSections = observer(function MyWorkSections(props: TMyWorkSectionsProps) {
  const { workspaceSlug } = props;
  const { data: currentUser } = useUser();
  const { workItems, isLoading } = useMyWorkItems(workspaceSlug, currentUser?.id);

  if (!currentUser) return null;

  return (
    <div className="flex flex-col gap-8">
      <TodaySection workspaceSlug={workspaceSlug} workItems={workItems} isLoading={isLoading} />
      <UpcomingSection workspaceSlug={workspaceSlug} workItems={workItems} isLoading={isLoading} />
      <MyTasksSection workspaceSlug={workspaceSlug} />
      <QuickActions workspaceSlug={workspaceSlug} />
    </div>
  );
});
