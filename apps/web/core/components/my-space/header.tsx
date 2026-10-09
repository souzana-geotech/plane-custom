/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { LockOutline } from "@makeplane/propel/icons";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Header } from "@plane/ui";

/**
 * Geotech3D: the My Space task list header - just the name. The team tools of a
 * container header (layouts, display, filters, analytics, publish) don't apply to
 * a personal to-do list; new tasks are added inline on the list itself.
 */
export function MySpaceTasksHeader() {
  const { t } = useTranslation();
  return (
    <Header>
      <Header.LeftItem>
        <div className="flex items-center gap-2 text-primary">
          <LockOutline className="size-4 text-tertiary" />
          <span className="text-14 font-medium">{t("my_space.title")}</span>
        </div>
      </Header.LeftItem>
    </Header>
  );
}
