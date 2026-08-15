from __future__ import annotations

from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    is_read = serializers.BooleanField(read_only=True)
    category_label = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = Notification
        fields = [
            "id", "category", "category_label", "event",
            "title", "body", "link_url", "is_read", "read_at", "created_at",
        ]
