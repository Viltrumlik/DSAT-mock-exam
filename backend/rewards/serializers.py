from __future__ import annotations

from rest_framework import serializers

from .models import PointAward, RewardRule


class RewardRuleSerializer(serializers.ModelSerializer):
    label = serializers.CharField(source="get_event_display", read_only=True)

    class Meta:
        model = RewardRule
        fields = ["event", "label", "points"]


class PointAwardSerializer(serializers.ModelSerializer):
    label = serializers.CharField(source="get_event_display", read_only=True)
    classroom_name = serializers.CharField(source="classroom.name", default=None, read_only=True)

    class Meta:
        model = PointAward
        fields = [
            "id", "event", "label", "points",
            "classroom", "classroom_name", "awarded_at", "note",
        ]
