/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { ContentWrapper } from "@plane/ui";
// hooks
import { useHome } from "@/hooks/store/use-home";
import { useUserProfile, useUser } from "@/hooks/store/user";
// plane web imports
import { TourRoot } from "@/components/onboarding/tour/root";
// local imports
import { HomeHeader } from "./header";
import { NoProjectsEmptyState } from "./widgets/empty-states";
import { ManageWidgetsModal } from "./widgets/manage";
import { FilterBar } from "./widgets/my-work/filter-bar";
import { MyWorkProvider } from "./widgets/my-work/my-work-context";
import { WorkQueue } from "./widgets/my-work/work-queue";
import { MyWorkSidebar } from "./widgets/sidebar/root";
import { HomePeekOverviewsRoot } from "../issues/peek-overview/peek-overviews";

/**
 * My Work: header → summary/filters → one work queue, with recent activity as secondary context.
 * The queue is the page; everything else supports it.
 */
export const WorkspaceHomeView = observer(function WorkspaceHomeView() {
  // store hooks
  const { workspaceSlug } = useParams();
  const { data: currentUser } = useUser();
  const { data: currentUserProfile, updateTourCompleted } = useUserProfile();
  const { fetchWidgets, showWidgetSettings, toggleWidgetSettings } = useHome();

  useSWR(
    workspaceSlug ? `HOME_DASHBOARD_WIDGETS_${workspaceSlug}` : null,
    workspaceSlug ? () => fetchWidgets(workspaceSlug?.toString()) : null,
    {
      revalidateIfStale: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  );

  const handleTourCompleted = async () => {
    try {
      await updateTourCompleted();
    } catch (error) {
      console.error("Error updating tour completed", error);
    }
  };

  if (!workspaceSlug || !currentUser) return null;
  const slug = workspaceSlug.toString();

  return (
    <>
      {currentUserProfile && !currentUserProfile.is_tour_completed && (
        <div className="fixed top-0 left-0 z-20 grid h-full w-full place-items-center overflow-y-auto bg-backdrop transition-opacity">
          <TourRoot onComplete={handleTourCompleted} />
        </div>
      )}
      <HomePeekOverviewsRoot />
      <ManageWidgetsModal
        workspaceSlug={slug}
        isModalOpen={showWidgetSettings}
        handleOnClose={() => toggleWidgetSettings(false)}
      />
      <ContentWrapper className="scrollbar-hide bg-surface-1 px-page-x light:bg-canvas">
        <MyWorkProvider workspaceSlug={slug}>
          <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 pt-1 pb-12">
            <HomeHeader user={currentUser} />
            <NoProjectsEmptyState />
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
              <main className="flex min-w-0 flex-col gap-4">
                <FilterBar />
                <WorkQueue />
              </main>
              <MyWorkSidebar workspaceSlug={slug} />
            </div>
          </div>
        </MyWorkProvider>
      </ContentWrapper>
    </>
  );
});
