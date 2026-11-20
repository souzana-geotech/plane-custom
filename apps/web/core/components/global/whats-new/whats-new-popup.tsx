/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { useTranslation } from "@plane/i18n";
import { WhatsNewService } from "@plane/services";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// hooks
import { useUser } from "@/hooks/store/user";
// local
import { WhatsNewCard } from "./whats-new-card";

const whatsNewService = new WhatsNewService();

// Let the page settle before the popup appears
const OPEN_DELAY_MS = 800;
const CLOSE_ANIMATION_MS = 300;

/**
 * Geotech3D: shows each person, once, the What's new notes the instance admin sent
 * since they last saw one. Several unseen notes show together, newest first.
 */
export const WhatsNewPopup = observer(function WhatsNewPopup() {
  const { t } = useTranslation();
  const { data: currentUser } = useUser();
  const [isOpen, setIsOpen] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const { data: notes, mutate } = useSWR(
    currentUser?.id ? ["WHATS_NEW_UNSEEN", currentUser.id] : null,
    () => whatsNewService.unseen().catch(() => []),
    { revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false }
  );

  const hasNotes = !!notes && notes.length > 0;

  useEffect(() => {
    if (!hasNotes || isDismissed) return;
    const timer = setTimeout(() => setIsOpen(true), OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasNotes, isDismissed]);

  const items = useMemo(() => (notes ?? []).flatMap((note) => note.items), [notes]);

  if (!hasNotes || isDismissed) return null;

  const newest = notes[0];
  const name = currentUser?.first_name || currentUser?.display_name || "";

  const handleDismiss = () => {
    setIsOpen(false);
    // Mark up to the newest note shown, so one sent while this was open still shows next time
    if (newest.sent_at) whatsNewService.markSeen(newest.sent_at).catch(() => undefined);
    // Unmount only after the close animation. The layout remounts when switching
    // workspace, so the cached list is emptied too.
    setTimeout(() => {
      setIsDismissed(true);
      void mutate([], { revalidate: false });
    }, CLOSE_ANIMATION_MS);
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={handleDismiss} position={EModalPosition.CENTER} width={EModalWidth.MD}>
      <WhatsNewCard
        hello={name ? t("updates.whats_new_popup.hello", { name }) : ""}
        headline={newest.headline}
        items={items}
        buttonLabel={t("updates.whats_new_popup.got_it")}
        onDismiss={handleDismiss}
      />
    </ModalCore>
  );
});
