"""What the card is sent.

The question goes out through ``AssessmentQuestionRunnerSerializer`` — the one the assessment
runner already trusts not to leak ``correct_answer``, ``grading_config`` or ``explanation`` —
so a new field on a question cannot reach an unanswered card by accident. The answer key and
the worked solution are added only to an ANSWERED question, by this serializer, on purpose.
"""

from __future__ import annotations

from rest_framework import serializers

from assessments.serializers import AssessmentQuestionRunnerSerializer
from rewards import constants as reward_const
from rewards.models import PointAward
from rewards.services import pricing_for

from .models import DailyQuestionAssignment


def reward_on_offer() -> dict:
    """What right first time pays today, as the card advertises it."""
    points, grants_xp = pricing_for(reward_const.EVENT_DAILY_QUESTION)
    return {
        "points": points,
        "xp": reward_const.xp_for(reward_const.EVENT_DAILY_QUESTION, points, grants_xp=grants_xp),
    }


def earned_by_assignment(assignments) -> dict[int, dict]:
    keys = {reward_const.daily_question_key(a.pk): a.pk for a in assignments if a.is_correct}
    if not keys:
        return {}
    return {
        keys[award.idempotency_key]: {"points": award.points, "xp": award.xp}
        for award in PointAward.objects.filter(idempotency_key__in=keys)
    }


class DailyQuestionSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()
    question = serializers.SerializerMethodField()
    result = serializers.SerializerMethodField()

    class Meta:
        model = DailyQuestionAssignment
        fields = ["id", "date", "subject", "level", "status", "question", "result"]

    def get_status(self, obj) -> str:
        return "answered" if obj.is_answered else "open"

    def get_question(self, obj) -> dict:
        return AssessmentQuestionRunnerSerializer(obj.question, context=self.context).data

    def get_result(self, obj) -> dict | None:
        if not obj.is_answered:
            return None
        earned = self.context.get("earned", {}).get(obj.pk, {"points": 0, "xp": 0})
        return {
            "answer": obj.answer,
            "is_correct": bool(obj.is_correct),
            "correct_answer": obj.question.correct_answer,
            "explanation": obj.question.explanation,
            "earned": earned,
        }
