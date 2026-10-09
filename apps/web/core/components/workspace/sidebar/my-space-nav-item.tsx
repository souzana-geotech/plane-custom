/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowNarrowLeftOutline, LockOutline } from "@makeplane/propel/icons";
// plane imports
import { EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EUserWorkspaceRoles } from "@plane/types";
// components
import { SidebarNavItem } from "@/components/sidebar/sidebar-navigation";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { useUserPermissions } from "@/hooks/store/user";
import { useMySpace } from "@/hooks/use-my-space";

/**
 * Geotech3D: the sidebar's way into and out of My Space.
 *
 * In a company workspace it opens the user's personal container (guests have
 * none). Inside the My Space workspace it becomes "Back to <workspace>",
 * returning to wherever My Space was opened from.
 */
export const MySpaceNavItem = observer(function MySpaceNavItem() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams();
  const { allowPermissions } = useUserPermissions();
  const { toggleSidebar, isExtendedSidebarOpened, toggleExtendedSidebar } = useAppTheme();
  const { isInMySpace, isOpening, openMySpace, returnWorkspace } = useMySpace();

  const closeSidebarOnMobile = () => {
    if (window.innerWidth < 768) toggleSidebar();
    if (isExtendedSidebarOpened) toggleExtendedSidebar(false);
  };

  if (isInMySpace) {
    if (!returnWorkspace) return null;
    return (
      <Link href={`/${returnWorkspace.slug}`} onClick={closeSidebarOnMobile}>
        <SidebarNavItem>
          <div className="flex min-w-0 items-center gap-1.5 py-[1px]">
            <ArrowNarrowLeftOutline className="size-4 flex-shrink-0" />
            <p className="truncate text-13 leading-5 font-medium">
              {t("my_space.back_to", { workspace: returnWorkspace.name })}
            </p>
          </div>
        </SidebarNavItem>
      </Link>
    );
  }

  const canHaveMySpace = allowPermissions(
    [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    EUserPermissionsLevel.WORKSPACE,
    workspaceSlug?.toString()
  );
  if (!canHaveMySpace) return null;

  return (
    <button
      type="button"
      className="w-full text-left disabled:cursor-wait"
      disabled={isOpening}
      onClick={() => {
        closeSidebarOnMobile();
        void openMySpace();
      }}
    >
      <SidebarNavItem>
        <div className="flex items-center gap-1.5 py-[1px]">
          <LockOutline className="size-4 flex-shrink-0" />
          <p className="text-13 leading-5 font-medium">{t("my_space.title")}</p>
        </div>
      </SidebarNavItem>
    </button>
  );
});
