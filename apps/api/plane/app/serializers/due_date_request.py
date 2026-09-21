# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third Party imports
from rest_framework import serializers

# Module imports
from plane.db.models import IssueDueDateChangeRequest

from .base import BaseSerializer
from .user import UserLiteSerializer


class IssueDueDateChangeRequestSerializer(BaseSerializer):
    """
    Read serializer for a fixed-due-date change request.

    Everything that decides the outcome (status, reviewer, dates actually
    applied) is set server side, so the only field a client ever writes is
    handled by ``IssueDueDateChangeRequestCreateSerializer`` below.
    """

    requested_by_detail = UserLiteSerializer(source="requested_by", read_only=True)
    reviewed_by_detail = UserLiteSerializer(source="reviewed_by", read_only=True)

    class Meta:
        model = IssueDueDateChangeRequest
        fields = [
            "id",
            "issue",
            "project",
            "workspace",
            "requested_by",
            "requested_by_detail",
            "requested_target_date",
            "current_target_date",
            "reason",
            "status",
            "reviewed_by",
            "reviewed_by_detail",
            "reviewed_at",
            "review_comment",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class IssueDueDateChangeRequestCreateSerializer(serializers.Serializer):
    """Payload a member submits when asking for a fixed due date to be changed."""

    requested_target_date = serializers.DateField()
    reason = serializers.CharField(required=False, allow_blank=True, default="", max_length=2000)


class IssueDueDateChangeRequestReviewSerializer(serializers.Serializer):
    """Payload an admin submits when approving or rejecting a request."""

    review_comment = serializers.CharField(required=False, allow_blank=True, default="", max_length=2000)
