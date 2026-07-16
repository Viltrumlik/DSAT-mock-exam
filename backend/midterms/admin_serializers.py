"""Admin/builder serializer for authoring midterms."""

from __future__ import annotations

from rest_framework import serializers

from .models import Midterm


def _publish_check(midterm: Midterm):
    # Version-aware: a versioned midterm keeps its questions on the versions, so its flat
    # ``question_module`` is empty by design — don't treat that as "no questions".
    if not midterm.has_questions():
        return False, "Add at least one question before publishing."
    return True, ""


class AdminMidtermSerializer(serializers.ModelSerializer):
    question_count = serializers.SerializerMethodField()
    publish_ready = serializers.SerializerMethodField()
    publish_block_reason = serializers.SerializerMethodField()

    class Meta:
        model = Midterm
        fields = [
            "id",
            "title",
            "subject",
            "level",
            "calculator_enabled",
            "scoring_scale",
            "duration_minutes",
            "question_limit",
            "is_published",
            "published_at",
            "created_by",
            "created_at",
            "question_count",
            "publish_ready",
            "publish_block_reason",
        ]
        read_only_fields = [
            "is_published",
            "published_at",
            "created_by",
            "created_at",
            "question_count",
            "publish_ready",
            "publish_block_reason",
            # Derived from subject+level — never authored directly.
            "calculator_enabled",
        ]

    def validate(self, attrs):
        """Level must be valid for the subject (Foundation is Math-only). Blank stays
        allowed = untagged/legacy. Falls back to the instance so PATCH of one field works."""
        subject = attrs.get("subject") or getattr(self.instance, "subject", None)
        level = attrs.get("level", getattr(self.instance, "level", "") if self.instance else "")
        if level and level not in Midterm.allowed_levels_for_subject(subject):
            raise serializers.ValidationError(
                {"level": f"'{level}' is not a valid level for {subject} midterms."}
            )
        return attrs

    def get_question_count(self, obj) -> int:
        return obj.display_question_count()

    def get_publish_ready(self, obj) -> bool:
        return _publish_check(obj)[0]

    def get_publish_block_reason(self, obj) -> str:
        return _publish_check(obj)[1]

    def validate_duration_minutes(self, value):
        if int(value) < 1:
            raise serializers.ValidationError("Duration must be at least 1 minute.")
        return value
