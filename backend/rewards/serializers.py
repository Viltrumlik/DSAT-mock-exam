from __future__ import annotations

from rest_framework import serializers

from . import constants
from .models import PointAward, RewardRule


class RewardRuleSerializer(serializers.ModelSerializer):
    label = serializers.CharField(source="get_event_display", read_only=True)
    group_points = serializers.SerializerMethodField()

    def get_group_points(self, rule) -> list[int] | None:
        """``[alone, two, three]`` for an earning whose price depends on how many students
        share it, and ``None`` for every other rule — which is all of them but one.

        A support hour pays per head and the rate climbs with the group, so "+10" beside it
        is not the whole rule and a student reading only that has no reason to bring anybody.
        Computed from the same helper the hook pays from rather than written into React,
        because the school retunes the bottom rung from the admin and a sentence in the UI
        would go on quoting the old numbers.
        """
        if rule.event != constants.EVENT_SUPPORT_SESSION:
            return None
        return constants.support_session_ladder(int(rule.points))

    class Meta:
        model = RewardRule
        # `grants_xp` is served because the page shows a student "+40" beside a survey and,
        # since surveys stopped counting toward XP, that number no longer tells the whole
        # truth about what the earning does. Read from the rule rather than hardcoded in the
        # UI: this is a checkbox the school can tick back on without a deploy, and a sentence
        # in React would go on saying the opposite.
        fields = ["event", "label", "points", "grants_xp", "group_points"]


class PointAwardSerializer(serializers.ModelSerializer):
    label = serializers.CharField(source="get_event_display", read_only=True)
    classroom_name = serializers.CharField(source="classroom.name", default=None, read_only=True)

    class Meta:
        model = PointAward
        fields = [
            "id", "event", "label", "points",
            "classroom", "classroom_name", "awarded_at", "note",
        ]
