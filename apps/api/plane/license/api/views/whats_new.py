# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: god-mode endpoints where the instance admin writes What's new notes and sends them.
"""

# Django imports
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseAPIView
from plane.db.models import WHATS_NEW_ICONS, WhatsNew
from plane.license.api.permissions import InstanceAdminPermission

MAX_HEADLINE = 120
MAX_ITEMS = 8
MAX_ITEM_TITLE = 80
MAX_ITEM_TEXT = 240
DEFAULT_ICON = "sparkles"


def serialize_whats_new(note):
    return {
        "id": str(note.id),
        "headline": note.headline,
        "items": note.items,
        "sent_at": note.sent_at.isoformat() if note.sent_at else None,
        "created_at": note.created_at.isoformat() if note.created_at else None,
        "updated_at": note.updated_at.isoformat() if note.updated_at else None,
    }


def clean_whats_new(data):
    """Returns (headline, items, errors). Drafts may have no items; sending needs one."""
    errors = {}

    headline = data.get("headline")
    headline = headline.strip() if isinstance(headline, str) else ""
    if not headline:
        errors["headline"] = "Write a headline."
    elif len(headline) > MAX_HEADLINE:
        errors["headline"] = f"Keep the headline under {MAX_HEADLINE} characters."

    raw_items = data.get("items", [])
    if not isinstance(raw_items, list):
        raw_items = []
    items = []
    item_errors = {}
    for index, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            continue
        title = raw.get("title") if isinstance(raw.get("title"), str) else ""
        text = raw.get("text") if isinstance(raw.get("text"), str) else ""
        title, text = title.strip(), text.strip()
        # A row left completely empty is dropped instead of refused
        if not title and not text:
            continue
        if not title:
            item_errors[index] = "Give this item a title."
        elif len(title) > MAX_ITEM_TITLE:
            item_errors[index] = f"Keep the title under {MAX_ITEM_TITLE} characters."
        elif len(text) > MAX_ITEM_TEXT:
            item_errors[index] = f"Keep the text under {MAX_ITEM_TEXT} characters."
        icon = raw.get("icon") if raw.get("icon") in WHATS_NEW_ICONS else DEFAULT_ICON
        items.append({"title": title, "text": text, "icon": icon})

    if item_errors:
        errors["items"] = item_errors
    elif len(items) > MAX_ITEMS:
        errors["items"] = f"Keep it to {MAX_ITEMS} items or fewer."

    return headline, items, errors


class InstanceWhatsNewEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    def get(self, request):
        notes = WhatsNew.objects.order_by("-sent_at", "-created_at")
        return Response([serialize_whats_new(note) for note in notes], status=status.HTTP_200_OK)

    def post(self, request):
        headline, items, errors = clean_whats_new(request.data)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        note = WhatsNew.objects.create(headline=headline, items=items)
        return Response(serialize_whats_new(note), status=status.HTTP_201_CREATED)

    def patch(self, request, pk):
        note = WhatsNew.objects.filter(pk=pk).first()
        if note is None:
            return Response({"error": "This note no longer exists."}, status=status.HTTP_404_NOT_FOUND)
        headline, items, errors = clean_whats_new(
            {
                "headline": request.data.get("headline", note.headline),
                "items": request.data.get("items", note.items),
            }
        )
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        if note.sent_at and not items:
            return Response({"items": "A sent note needs at least one item."}, status=status.HTTP_400_BAD_REQUEST)
        note.headline = headline
        note.items = items
        note.save(update_fields=["headline", "items", "updated_at", "updated_by"])
        return Response(serialize_whats_new(note), status=status.HTTP_200_OK)

    def delete(self, request, pk):
        note = WhatsNew.objects.filter(pk=pk).first()
        if note is None:
            return Response({"error": "This note no longer exists."}, status=status.HTTP_404_NOT_FOUND)
        note.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class InstanceWhatsNewSendEndpoint(BaseAPIView):
    """Sends a draft: from now on, everyone who has not seen it gets it once."""

    permission_classes = [InstanceAdminPermission]

    def post(self, request, pk):
        note = WhatsNew.objects.filter(pk=pk).first()
        if note is None:
            return Response({"error": "This note no longer exists."}, status=status.HTTP_404_NOT_FOUND)
        if note.sent_at:
            return Response({"error": "This note was already sent."}, status=status.HTTP_400_BAD_REQUEST)
        if not note.items:
            return Response({"items": "Add at least one item before sending."}, status=status.HTTP_400_BAD_REQUEST)
        note.sent_at = timezone.now()
        note.save(update_fields=["sent_at", "updated_at", "updated_by"])
        return Response(serialize_whats_new(note), status=status.HTTP_200_OK)
