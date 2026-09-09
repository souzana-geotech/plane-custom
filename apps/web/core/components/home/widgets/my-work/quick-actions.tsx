/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useRouter } from "next/navigation";
// plane imports
import { AddOutline, SearchOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { usePowerK } from "@/hooks/store/use-power-k";

type TQuickActionsProps = {
  workspaceSlug: string;
};

/** The three things a non-technical employee needs fast, always in the same place — no
 * project pickers or menus to learn first. */
export const QuickActions = observer(function QuickActions(props: TQuickActionsProps) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();
  const router = useRouter();
  const { toggleCreateIssueModal } = useCommandPalette();
  const { togglePowerKModal } = usePowerK();

  return (
    <section className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => toggleCreateIssueModal(true)}
        className="text-on-accent hover:bg-accent-strong flex items-center gap-1.5 rounded-md bg-accent-primary px-3 py-2 text-13 font-medium"
      >
        <AddOutline className="size-4" />
        {t("home.quick_actions.add_task")}
      </button>
      <button
        type="button"
        onClick={() => router.push(`/${workspaceSlug}/stickies`)}
        className="flex items-center gap-1.5 rounded-md border border-subtle px-3 py-2 text-13 font-medium text-primary hover:bg-layer-transparent-hover"
      >
        <AddOutline className="size-4" />
        {t("home.quick_actions.add_note")}
      </button>
      <button
        type="button"
        onClick={() => togglePowerKModal(true)}
        className="flex items-center gap-1.5 rounded-md border border-subtle px-3 py-2 text-13 font-medium text-tertiary hover:bg-layer-transparent-hover"
      >
        <SearchOutline className="size-4" />
        {t("home.quick_actions.search_placeholder")}
      </button>
    </section>
  );
});
