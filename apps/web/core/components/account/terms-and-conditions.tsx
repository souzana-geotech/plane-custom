/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { EAuthModes } from "@plane/constants";

interface TermsAndConditionsProps {
  authType?: EAuthModes;
}

const MESSAGES = {
  [EAuthModes.SIGN_UP]: "By creating an account",
  [EAuthModes.SIGN_IN]: "By signing in",
} as const;

/**
 * Legal notice on the auth screens.
 *
 * Upstream links "Terms of Service" and "Privacy Policy" to plane.so/legals/*.
 * Those are Plane Software's documents, not Geotech3D's, so sending staff there
 * under Geotech3D branding would point them at the wrong terms and leak the
 * upstream brand. Geotech3D has no published equivalents yet, so the notice
 * renders as plain text.
 *
 * NOTE: this means the reader cannot open the documents they are agreeing to.
 * When Geotech3D publishes its own terms and privacy pages, restore the links by
 * reinstating a LegalLink wrapper around the two phrases below and pointing it at
 * the new URLs.
 */
export function TermsAndConditions({ authType = EAuthModes.SIGN_IN }: TermsAndConditionsProps) {
  return (
    <div className="flex items-center justify-center">
      <p className="text-center text-13 whitespace-pre-line text-tertiary">
        {`${MESSAGES[authType]}, you agree to our 
 Terms of Service and Privacy Policy.`}
      </p>
    </div>
  );
}
