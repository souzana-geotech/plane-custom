/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Geotech3D: a "what happened with us" note the instance admin writes in god-mode.

export const WHATS_NEW_ICONS = [
  "sparkles",
  "copy",
  "kanban",
  "tag",
  "calendar",
  "bell",
  "users",
  "file",
  "rocket",
  "check",
] as const;

export type TWhatsNewIcon = (typeof WHATS_NEW_ICONS)[number];

export type TWhatsNewItem = {
  title: string;
  text: string;
  icon: TWhatsNewIcon;
};

export type TWhatsNew = {
  id: string;
  headline: string;
  items: TWhatsNewItem[];
  // null while it is a draft
  sent_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TWhatsNewPayload = {
  headline: string;
  items: TWhatsNewItem[];
};
