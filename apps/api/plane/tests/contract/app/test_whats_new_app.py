# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for Geotech3D's "What's new".

The instance admin writes a short "what happened with us" note in god-mode and
sends it. Everyone then sees it once, in a popup, the next time they open the
app. A draft is never shown, and a new account doesn't get old notes.
"""

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Profile, User, WhatsNew
from plane.license.models import Instance, InstanceAdmin

ADMIN_URL = "/api/instances/whats-new/"
USER_URL = "/api/users/me/whats-new/"
SEEN_URL = "/api/users/me/whats-new/seen/"


@pytest.fixture
def instance(db):
    instance, _ = Instance.objects.update_or_create(
        id=uuid.uuid4(),
        defaults={
            "instance_name": "Test Instance",
            "instance_id": str(uuid.uuid4()),
            "current_version": "1.0.0",
            "domain": "http://localhost:8000",
            "last_checked_at": timezone.now(),
            "is_setup_done": True,
        },
    )
    return instance


@pytest.fixture
def admin_client(instance, create_user):
    InstanceAdmin.objects.create(instance=instance, user=create_user, role=20, is_verified=True)
    client = APIClient()
    client.force_authenticate(user=create_user)
    return client


@pytest.fixture
def teammate(db):
    user = User.objects.create(email="teammate@plane.so", first_name="Rami")
    # The account existed before any note in these tests was sent
    User.objects.filter(pk=user.pk).update(date_joined=timezone.now() - timedelta(days=30))
    user.refresh_from_db()
    Profile.objects.get_or_create(user=user)
    return user


@pytest.fixture
def teammate_client(teammate):
    client = APIClient()
    client.force_authenticate(user=teammate)
    return client


def _sent(headline, minutes_ago, items=None):
    return WhatsNew.objects.create(
        headline=headline,
        items=items or [{"title": "Duplicate a Job", "text": "Same tasks, fresh start.", "icon": "copy"}],
        sent_at=timezone.now() - timedelta(minutes=minutes_ago),
    )


@pytest.mark.contract
class TestWhatsNewAdmin:
    @pytest.mark.django_db
    def test_admin_writes_a_draft_then_sends_it(self, admin_client):
        response = admin_client.post(
            ADMIN_URL,
            {
                "headline": "  Guess what's new  ",
                "items": [
                    {"title": "Duplicate a Job", "text": "Same tasks, fresh start.", "icon": "copy"},
                    {"title": "", "text": ""},
                    {"title": "Kanban for Jobs", "text": "", "icon": "not-an-icon"},
                ],
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        note = WhatsNew.objects.get(pk=response.data["id"])
        assert note.headline == "Guess what's new"
        assert note.sent_at is None
        # The empty row is dropped and an unknown icon falls back to the default
        assert note.items == [
            {"title": "Duplicate a Job", "text": "Same tasks, fresh start.", "icon": "copy"},
            {"title": "Kanban for Jobs", "text": "", "icon": "sparkles"},
        ]

        response = admin_client.post(f"{ADMIN_URL}{note.id}/send/")
        assert response.status_code == status.HTTP_200_OK
        note.refresh_from_db()
        assert note.sent_at is not None

        # Sending twice is refused
        response = admin_client.post(f"{ADMIN_URL}{note.id}/send/")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_bad_input_is_refused(self, admin_client):
        response = admin_client.post(ADMIN_URL, {"headline": " ", "items": []}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "headline" in response.data

        response = admin_client.post(
            ADMIN_URL, {"headline": "News", "items": [{"title": "", "text": "No title here"}]}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["items"] == {0: "Give this item a title."}
        assert not WhatsNew.objects.exists()

    @pytest.mark.django_db
    def test_a_draft_with_no_items_cannot_be_sent(self, admin_client):
        note = WhatsNew.objects.create(headline="Draft", items=[])
        response = admin_client.post(f"{ADMIN_URL}{note.id}/send/")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        note.refresh_from_db()
        assert note.sent_at is None

    @pytest.mark.django_db
    def test_admin_edits_and_deletes(self, admin_client):
        note = WhatsNew.objects.create(headline="Draft", items=[])
        response = admin_client.patch(
            f"{ADMIN_URL}{note.id}/", {"items": [{"title": "Labels on Jobs", "icon": "tag"}]}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK
        note.refresh_from_db()
        assert note.headline == "Draft"
        assert note.items == [{"title": "Labels on Jobs", "text": "", "icon": "tag"}]

        listing = admin_client.get(ADMIN_URL)
        assert [row["id"] for row in listing.data] == [str(note.id)]

        response = admin_client.delete(f"{ADMIN_URL}{note.id}/")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert admin_client.get(ADMIN_URL).data == []

    @pytest.mark.django_db
    def test_only_the_instance_admin_can_write(self, instance, teammate_client):
        response = teammate_client.post(ADMIN_URL, {"headline": "News", "items": []}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        response = teammate_client.get(ADMIN_URL)
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not WhatsNew.objects.exists()


@pytest.mark.contract
class TestWhatsNewForTheTeam:
    @pytest.mark.django_db
    def test_a_sent_note_shows_once(self, teammate_client):
        note = _sent("Guess what's new", minutes_ago=5)

        response = teammate_client.get(USER_URL)
        assert response.status_code == status.HTTP_200_OK
        assert [row["id"] for row in response.data] == [str(note.id)]
        assert response.data[0]["items"][0]["title"] == "Duplicate a Job"

        response = teammate_client.post(SEEN_URL, {"seen_up_to": response.data[0]["sent_at"]}, format="json")
        assert response.status_code == status.HTTP_200_OK
        assert teammate_client.get(USER_URL).data == []

    @pytest.mark.django_db
    def test_drafts_are_never_shown(self, teammate_client):
        WhatsNew.objects.create(headline="Not ready", items=[{"title": "Secret", "text": "", "icon": "sparkles"}])
        assert teammate_client.get(USER_URL).data == []

    @pytest.mark.django_db
    def test_several_unseen_notes_come_newest_first(self, teammate_client):
        older = _sent("Last week", minutes_ago=60)
        newer = _sent("This week", minutes_ago=5)
        response = teammate_client.get(USER_URL)
        assert [row["id"] for row in response.data] == [str(newer.id), str(older.id)]

    @pytest.mark.django_db
    def test_a_note_sent_while_the_popup_was_open_still_shows(self, teammate_client):
        shown = _sent("Shown", minutes_ago=10)
        teammate_client.get(USER_URL)
        later = _sent("Sent while the popup was open", minutes_ago=1)

        teammate_client.post(SEEN_URL, {"seen_up_to": shown.sent_at.isoformat()}, format="json")

        assert [row["id"] for row in teammate_client.get(USER_URL).data] == [str(later.id)]

    @pytest.mark.django_db
    def test_seen_never_moves_back_or_into_the_future(self, teammate, teammate_client):
        _sent("Old", minutes_ago=10)
        teammate_client.post(SEEN_URL, {}, format="json")
        seen_at = Profile.objects.get(user=teammate).whats_new_seen_at
        assert seen_at is not None

        # An older moment does not undo it
        teammate_client.post(SEEN_URL, {"seen_up_to": (seen_at - timedelta(days=1)).isoformat()}, format="json")
        assert Profile.objects.get(user=teammate).whats_new_seen_at == seen_at

        # A future moment is capped at now, so a note sent tomorrow still shows
        future = (timezone.now() + timedelta(days=2)).isoformat()
        teammate_client.post(SEEN_URL, {"seen_up_to": future}, format="json")
        assert Profile.objects.get(user=teammate).whats_new_seen_at <= timezone.now()

    @pytest.mark.django_db
    def test_a_new_account_does_not_get_old_notes(self, db):
        _sent("Before you joined", minutes_ago=60)
        newcomer = User.objects.create(email="newcomer@plane.so")
        client = APIClient()
        client.force_authenticate(user=newcomer)
        assert client.get(USER_URL).data == []

        after = _sent("After you joined", minutes_ago=0)
        assert [row["id"] for row in client.get(USER_URL).data] == [str(after.id)]

    @pytest.mark.django_db
    def test_signed_out_gets_nothing(self, db):
        _sent("News", minutes_ago=1)
        assert APIClient().get(USER_URL).status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)
