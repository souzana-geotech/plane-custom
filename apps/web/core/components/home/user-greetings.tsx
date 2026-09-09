/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane types
import { useTranslation } from "@plane/i18n";
import type { IUser } from "@plane/types";

export interface IUserGreetingsView {
  user: IUser;
}

/** Friendly, non-technical header: a greeting and one line telling the user what the page is
 * for. No clock, no stats — those live in the sections below. */
export function UserGreetingsView(props: IUserGreetingsView) {
  const { user } = props;
  const { t } = useTranslation();

  const hour = new Intl.DateTimeFormat("en-US", {
    hour12: false,
    hour: "numeric",
    timeZone: user?.user_timezone,
  }).format(new Date());

  const greeting = parseInt(hour, 10) < 12 ? "morning" : parseInt(hour, 10) < 18 ? "afternoon" : "evening";

  return (
    <div className="my-6 flex flex-col items-center text-center">
      <h1 className="text-20 font-semibold text-primary">
        {t("good")} {t(greeting)}, {user?.first_name} 👋
      </h1>
      <p className="mt-1 text-14 text-tertiary">{t("home.greeting.subtitle")}</p>
    </div>
  );
}
