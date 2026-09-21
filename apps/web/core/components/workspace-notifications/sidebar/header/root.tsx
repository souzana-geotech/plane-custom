/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { ChevronLeftOutline, InboxOutline } from "@makeplane/propel/icons";
import { Breadcrumbs, Header } from "@plane/ui";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
// local imports
import { NotificationSidebarHeaderOptions } from "./options";

type TNotificationSidebarHeader = {
  workspaceSlug: string;
};

export const NotificationSidebarHeader = observer(function NotificationSidebarHeader(
  props: TNotificationSidebarHeader
) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();
  const router = useAppRouter();

  // Notifications is a full page rather than a panel, so without this there is
  // nothing to click to get out of it. `Breadcrumbs`' own `onBack` is not an
  // option here: it only renders below 640px and only with more than one crumb.
  const handleBack = () => {
    // a direct link or a refresh leaves no in-app history to return to
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(`/${workspaceSlug}/`);
  };

  if (!workspaceSlug) return <></>;
  return (
    <Header className="my-auto bg-surface-1">
      <Header.LeftItem>
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("common.back")}
          className="grid size-6 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-layer-1 hover:text-primary"
        >
          <ChevronLeftOutline className="size-4" />
        </button>
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label={t("notification.label")}
                icon={<InboxOutline className="h-4 w-4 text-primary" />}
                disableTooltip
              />
            }
          />
        </Breadcrumbs>
      </Header.LeftItem>
      <Header.RightItem>
        <NotificationSidebarHeaderOptions workspaceSlug={workspaceSlug} />
      </Header.RightItem>
    </Header>
  );
});
