/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Popover } from "@headlessui/react";
import { WHATS_NEW_ICONS } from "@plane/types";
import type { TWhatsNewIcon } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { WHATS_NEW_ICON_COMPONENTS } from "@/components/whats-new/whats-new-card";

type Props = {
  value: TWhatsNewIcon;
  onChange: (icon: TWhatsNewIcon) => void;
};

// Geotech3D: pick the icon a What's new item shows
export function WhatsNewIconPicker(props: Props) {
  const { value, onChange } = props;
  const Current = WHATS_NEW_ICON_COMPONENTS[value];

  return (
    <Popover className="relative">
      <Popover.Button
        aria-label="Choose an icon"
        className="flex size-9 items-center justify-center rounded-md border border-subtle bg-layer-1 text-secondary transition-colors hover:bg-layer-1-hover"
      >
        <Current className="size-4" aria-hidden />
      </Popover.Button>
      <Popover.Panel className="absolute top-10 left-0 z-20 grid w-max grid-cols-5 gap-1 rounded-md border border-subtle bg-surface-1 p-2 shadow-raised-200">
        {({ close }) => (
          <>
            {WHATS_NEW_ICONS.map((icon) => {
              const Icon = WHATS_NEW_ICON_COMPONENTS[icon];
              return (
                <button
                  key={icon}
                  type="button"
                  aria-label={icon}
                  onClick={() => {
                    onChange(icon);
                    close();
                  }}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md text-secondary transition-colors hover:bg-layer-1-hover",
                    { "bg-accent-subtle text-accent-primary": icon === value }
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </button>
              );
            })}
          </>
        )}
      </Popover.Panel>
    </Popover>
  );
}
