/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { AddOutline } from "@makeplane/propel/icons";
import { Button } from "@plane/propel/button";
import { EUserWorkspaceRoles } from "@plane/types";
import type { IUser } from "@plane/types";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";

type THomeHeaderProps = {
  user: IUser;
};

/**
 * Page header: the page name, a one-line greeting, and the page's single primary action.
 * Search lives in the top bar and the project filter sits with the queue, so nothing competes here.
 */
export const HomeHeader = observer(function HomeHeader(props: THomeHeaderProps) {
  const { user } = props;
  const { t } = useTranslation();
  const { toggleCreateIssueModal } = useCommandPalette();
  const { canPerformAnyCreateAction } = useUser();
  const { allowPermissions } = useUserPermissions();
  const { workspaceSlug } = useParams();
  const router = useAppRouter();

  // Geotech3D: the create-task modal needs a container to put the task in and
  // silently renders nothing without one. Someone not yet in any container
  // adds their task to My Space instead.
  const handleNewTask = () => {
    const canHaveMySpace = allowPermissions(
      [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
      EUserPermissionsLevel.WORKSPACE,
      workspaceSlug?.toString()
    );
    if (!canPerformAnyCreateAction && canHaveMySpace) router.push(`/${workspaceSlug?.toString()}/my-space/`);
    else toggleCreateIssueModal(true);
  };

  const hour = new Intl.DateTimeFormat("en-US", {
    hour12: false,
    hour: "numeric",
    timeZone: user?.user_timezone,
  }).format(new Date());
  const greeting = parseInt(hour, 10) < 12 ? "morning" : parseInt(hour, 10) < 18 ? "afternoon" : "evening";

  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-20 leading-7 font-semibold text-primary">{t("home.title")}</h1>
        <p className="mt-0.5 truncate text-13 text-secondary">
          {t("good")} {t(greeting)}, {user?.first_name || user?.display_name} 👋{" "}
          <span className="text-geo-grey">{t("home.greeting.subtitle")}</span>
        </p>
      </div>
      <Button variant="primary" size="lg" onClick={handleNewTask} prependIcon={<AddOutline />}>
        {t("home.header.new_task")}
      </Button>
    </header>
  );
});
