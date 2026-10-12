/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { LockOutline } from "@makeplane/propel/icons";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Header } from "@plane/ui";

/** Geotech3D: the header shown for the moment Personal Space is being opened. */
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
