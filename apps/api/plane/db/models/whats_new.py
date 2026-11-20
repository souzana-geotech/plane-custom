# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models

# Module imports
from .base import BaseModel

# Icons a What's new item can show. The web app and god-mode map each key to the same icon.
WHATS_NEW_ICONS = (
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
)


class WhatsNew(BaseModel):
    """
    Geotech3D: a "what happened with us" note the instance admin writes in god-mode.

    It stays a draft until it is sent. Once sent, every user sees it once, in a popup,
    the next time they open the app (see Profile.whats_new_seen_at).
    """

    headline = models.CharField(max_length=255)
    # [{"title": str, "text": str, "icon": one of WHATS_NEW_ICONS}]
    items = models.JSONField(default=list)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "What's New"
        verbose_name_plural = "What's New"
        db_table = "whats_new"
        ordering = ("-sent_at", "-created_at")

    def __str__(self):
        return self.headline
