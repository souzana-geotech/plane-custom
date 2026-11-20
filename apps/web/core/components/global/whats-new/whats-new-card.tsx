/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Calendar,
  CircleCheck,
  Copy,
  FileText,
  Kanban,
  PartyPopper,
  Rocket,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";
import type { TWhatsNewIcon, TWhatsNewItem } from "@plane/types";
import { cn } from "@plane/utils";

/*
 * Geotech3D: the look of the What's new popup. god-mode's preview uses a copy of this
 * file (apps/admin/components/whats-new/whats-new-card.tsx), so keep the two the same.
 */

export const WHATS_NEW_ICON_COMPONENTS: Record<TWhatsNewIcon, LucideIcon> = {
  sparkles: Sparkles,
  copy: Copy,
  kanban: Kanban,
  tag: Tag,
  calendar: Calendar,
  bell: Bell,
  users: Users,
  file: FileText,
  rocket: Rocket,
  check: CircleCheck,
};

// Each item takes the next tint, so a list never looks flat
const ITEM_TINTS = [
  "bg-accent-subtle text-accent-primary",
  "bg-success-subtle text-success-primary",
  "bg-warning-subtle text-warning-primary",
  "bg-geo-grey-subtle text-geo-grey",
];

// The little dots behind the header: [position, size, color]
const CONFETTI: [string, string, string][] = [
  ["top-4 left-8", "size-2.5", "bg-warning-primary"],
  ["top-11 left-16", "size-1.5", "bg-accent-primary"],
  ["top-5 right-11", "size-2", "bg-success-primary"],
  ["top-14 right-20", "size-1.5", "bg-accent-primary"],
  ["top-[4.5rem] right-7", "size-2", "bg-warning-primary"],
  ["top-16 left-6", "size-1.5", "bg-success-primary"],
];

type Props = {
  // "Hey Rami", above the headline
  hello: string;
  headline: string;
  items: TWhatsNewItem[];
  buttonLabel: string;
  onDismiss?: () => void;
  className?: string;
};

export function WhatsNewCard(props: Props) {
  const { hello, headline, items, buttonLabel, onDismiss, className } = props;

  return (
    <div className={cn("w-full overflow-hidden rounded-xl bg-surface-1", className)}>
      <div className="relative bg-accent-subtle px-6 pt-7 pb-5 text-center">
        {CONFETTI.map(([position, size, color]) => (
          <span key={position} aria-hidden className={cn("absolute rounded-full", position, size, color)} />
        ))}
        <div className="relative mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-surface-1">
          <PartyPopper className="size-7 text-accent-primary" aria-hidden />
        </div>
        {hello && <p className="relative mb-1 text-body-sm-regular text-secondary">{hello}</p>}
        <h2 className="relative text-h5-medium break-words text-primary">{headline}</h2>
      </div>
      <ul className="px-6 py-2">
        {items.map((item, index) => {
          const Icon = WHATS_NEW_ICON_COMPONENTS[item.icon] ?? Sparkles;
          return (
            <li
              // oxlint-disable-next-line react/no-array-index-key -- items have no ids and the list never reorders while shown
              key={`${index}-${item.title}`}
              className={cn("flex items-start gap-3 py-3", index > 0 && "border-t border-subtle")}
            >
              <span
                className={cn(
                  "flex size-9 flex-shrink-0 items-center justify-center rounded-lg",
                  ITEM_TINTS[index % ITEM_TINTS.length]
                )}
              >
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-body-sm-medium break-words text-primary">{item.title}</p>
                {item.text && <p className="mt-0.5 text-body-xs-regular break-words text-secondary">{item.text}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="px-6 pt-2 pb-6">
        <button
          type="button"
          onClick={onDismiss}
          className="h-10 w-full rounded-lg bg-accent-primary text-body-sm-medium text-on-color transition-colors hover:bg-accent-primary-hover"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
