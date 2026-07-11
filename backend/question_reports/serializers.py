from __future__ import annotations

from rest_framework import serializers

from .models import QuestionErrorReport


class QuestionReportCreateSerializer(serializers.Serializer):
    system = serializers.ChoiceField(
        choices=[QuestionErrorReport.SYSTEM_EXAM, QuestionErrorReport.SYSTEM_ASSESSMENT]
    )
    question_id = serializers.IntegerField(min_value=1)
    category = serializers.ChoiceField(
        choices=[c[0] for c in QuestionErrorReport.CATEGORY_CHOICES],
        default=QuestionErrorReport.CATEGORY_OTHER,
    )
    message = serializers.CharField(
        max_length=2000, allow_blank=True, required=False, default="", trim_whitespace=True
    )
    attempt_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
