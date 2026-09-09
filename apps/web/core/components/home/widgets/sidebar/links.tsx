/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { useTranslation } from "@plane/i18n";
import { AddOutline } from "@makeplane/propel/icons";
// hooks
import { useHome } from "@/hooks/store/use-home";
// local imports
import { LinkCreateUpdateModal } from "../links/create-update-link-modal";
import { ProjectLinkList } from "../links/links";
import { useLinks } from "../links/use-links";
import { SectionLabel } from "../my-work/section";

/** The user's saved quick links as a flat side section, with the same create/edit flow as before. */
export const LinksPanel = observer(function LinksPanel({ workspaceSlug }: { workspaceSlug: string }) {
  const { t } = useTranslation();
  const { linkOperations } = useLinks(workspaceSlug);
  const {
    quickLinks: { isLinkModalOpen, toggleLinkModal, linkData, setLinkData, fetchLinks },
  } = useHome();

  const handleCreateLinkModal = useCallback(() => {
    toggleLinkModal(true);
    setLinkData(undefined);
  }, [toggleLinkModal, setLinkData]);

  useSWR(workspaceSlug ? `HOME_LINKS_${workspaceSlug}` : null, workspaceSlug ? () => fetchLinks(workspaceSlug) : null, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  return (
    <>
      <LinkCreateUpdateModal
        isModalOpen={isLinkModalOpen}
        handleOnClose={() => toggleLinkModal(false)}
        linkOperations={linkOperations}
        preloadedData={linkData}
      />
      <section aria-labelledby="my-work-links" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SectionLabel>
            <span id="my-work-links">{t("home.quick_links.title_plural")}</span>
          </SectionLabel>
          <button
            type="button"
            onClick={handleCreateLinkModal}
            aria-label={t("home.quick_links.add")}
            className="grid size-6 place-items-center rounded-md text-geo-grey hover:bg-geo-grey-subtle hover:text-primary"
          >
            <AddOutline className="size-3.5" />
          </button>
        </div>
        <ProjectLinkList workspaceSlug={workspaceSlug} linkOperations={linkOperations} />
      </section>
    </>
  );
});
