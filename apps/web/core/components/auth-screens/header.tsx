/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useTranslation } from "@plane/i18n";
import { PageHead } from "@/components/core/page-title";
import { EAuthModes } from "@/helpers/authentication.helper";
import { useInstance } from "@/hooks/store/use-instance";
// assets
import WordmarkDark from "@plane/tailwind-config/brand/wordmark-dark.svg?url";
import WordmarkLight from "@plane/tailwind-config/brand/wordmark-light.svg?url";

const authContentMap = {
  [EAuthModes.SIGN_IN]: {
    pageTitle: "Sign in",
    text: "auth.common.new_to_plane",
    linkText: "Sign up",
    linkHref: "/sign-up",
  },
  [EAuthModes.SIGN_UP]: {
    pageTitle: "Sign up",
    text: "auth.common.already_have_an_account",
    linkText: "Sign in",
    linkHref: "/sign-in",
  },
};

type AuthHeaderProps = {
  type: EAuthModes;
};

export const AuthHeader = observer(function AuthHeader({ type }: AuthHeaderProps) {
  const { t } = useTranslation();
  // store
  const { config } = useInstance();
  // derived values
  const enableSignUpConfig = config?.enable_signup ?? false;

  return (
    <AuthHeaderBase
      pageTitle={t(authContentMap[type].pageTitle)}
      additionalAction={
        enableSignUpConfig && (
          <div className="flex flex-col items-end text-center text-13 font-medium text-tertiary sm:flex-row sm:items-center sm:gap-2">
            <span className="text-body-sm-regular text-tertiary">{t(authContentMap[type].text)}</span>
            <Link
              href={authContentMap[type].linkHref}
              className="text-body-sm-semibold text-accent-primary hover:underline"
            >
              {t(authContentMap[type].linkText)}
            </Link>
          </div>
        )
      }
    />
  );
});

type TAuthHeaderBase = {
  pageTitle: string;
  additionalAction?: React.ReactNode;
};

/**
 * Full Geotech3D wordmark for the auth screens.
 *
 * Uses the same artwork as the loading screen -- the version WITH the green
 * "GEOSPATIAL SERVICES" caption bar -- rather than the caption-free PlaneLockup
 * the in-app header uses. The auth screen has room to render it at 24-32px tall,
 * where the caption is legible; the 16-20px app header does not, which is why the
 * two surfaces deliberately use different marks.
 *
 * A light/dark asset pair is required because the artwork is multi-colour (the
 * caption reverses out of the green bar), so it cannot ride on currentColor.
 * `resolvedTheme` is only known on the client, so the light asset is held until
 * mount to keep the server and first client render identical and avoid a
 * hydration mismatch -- same approach as LogoSpinner.
 */
function BrandWordmark() {
  const { resolvedTheme } = useTheme();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const logoSrc = isMounted && resolvedTheme === "dark" ? WordmarkDark : WordmarkLight;

  return <img src={logoSrc} alt="Geotech3D" className="h-6 w-auto object-contain sm:h-8" />;
}

export function AuthHeaderBase(props: TAuthHeaderBase) {
  const { pageTitle, additionalAction } = props;
  return (
    <>
      <PageHead title={pageTitle + " - Geotech3D"} />
      <div className="sticky top-0 flex w-full flex-shrink-0 items-center justify-between gap-6">
        <Link href="/">
          <BrandWordmark />
        </Link>
        {additionalAction}
      </div>
    </>
  );
}
