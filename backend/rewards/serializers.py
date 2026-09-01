from __future__ import annotations

from rest_framework import serializers

from .models import PointAward, RewardRule


class RewardRuleSerializer(serializers.ModelSerializer):
    label = serializers.CharField(source="get_event_display", read_only=True)

    class Meta:
        model = RewardRule
        # `grants_xp` is served because the page shows a student "+40" beside a survey and,
        # since surveys stopped counting toward XP, that number no longer tells the whole
        # truth about what the earning does. Read from the rule rather than hardcoded in the
        # UI: this is a checkbox the school can tick back on without a deploy, and a sentence
        # in React would go on saying the opposite.
        fields = ["event", "label", "points", "grants_xp"]


class PointAwardSerializer(serializers.ModelSerializer):
    label = serializers.CharField(source="get_event_display", read_only=True)
    classroom_name = serializers.CharField(source="classroom.name", default=None, read_only=True)

    class Meta:
        model = PointAward
        fields = [
            "id", "event", "label", "points",
            "classroom", "classroom_name", "awarded_at", "note",
        ]
