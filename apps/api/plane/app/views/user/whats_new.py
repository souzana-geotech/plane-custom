# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Geotech3D: the What's new notes a user has not seen yet, and marking them seen.
"""

# Python imports
from datetime import timezone as dt_timezone

# Django imports
from django.utils import timezone
from django.utils.dateparse import parse_datetime

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseAPIView
from plane.db.models import Profile, WhatsNew

# Someone away for a long time gets the latest few, not a pile
MAX_UNSEEN = 5


def _seen_since(user, profile):
    """Notes sent before this moment are already seen (or older than the account)."""
    seen_at = profile.whats_new_seen_at
    if seen_at is None or (user.date_joined and user.date_joined > seen_at):
        return user.date_joined
    return seen_at


class UserWhatsNewEndpoint(BaseAPIView):
    def get(self, request):
        profile, _ = Profile.objects.get_or_create(user=request.user)
        since = _seen_since(request.user, profile)
        notes = WhatsNew.objects.filter(sent_at__isnull=False, sent_at__lte=timezone.now())
        if since:
            notes = notes.filter(sent_at__gt=since)
        notes = notes.order_by("-sent_at")[:MAX_UNSEEN]
        return Response(
            [
                {
                    "id": str(note.id),
                    "headline": note.headline,
                    "items": note.items,
                    "sent_at": note.sent_at.isoformat(),
                }
                for note in notes
            ],
            status=status.HTTP_200_OK,
        )


class UserWhatsNewSeenEndpoint(BaseAPIView):
    def post(self, request):
        """
        Marks everything up to `seen_up_to` (the newest note the popup showed) as seen.
        Using the shown note's time, not "now", means a note sent while the popup was
        open still shows next time.
        """
        now = timezone.now()
        seen_up_to = request.data.get("seen_up_to")
        moment = parse_datetime(seen_up_to) if isinstance(seen_up_to, str) else None
        if moment is None:
            moment = now
        if timezone.is_naive(moment):
            moment = timezone.make_aware(moment, dt_timezone.utc)
        moment = min(moment, now)

        profile, _ = Profile.objects.get_or_create(user=request.user)
        if profile.whats_new_seen_at is None or moment > profile.whats_new_seen_at:
            profile.whats_new_seen_at = moment
            profile.save(update_fields=["whats_new_seen_at", "updated_at"])
        return Response({"whats_new_seen_at": profile.whats_new_seen_at.isoformat()}, status=status.HTTP_200_OK)
