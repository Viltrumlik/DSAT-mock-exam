from __future__ import annotations

from rest_framework import serializers

from .models import Survey, SurveyAnswer, SurveyQuestion, SurveyResponse


class SurveyQuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = SurveyQuestion
        fields = [
            "id", "order", "prompt", "help_text", "question_type",
            "is_required", "options", "scale_min", "scale_max",
        ]

    def validate(self, attrs):
        qtype = attrs.get("question_type", getattr(self.instance, "question_type", None))
        options = attrs.get("options", getattr(self.instance, "options", None)) or []
        if qtype in SurveyQuestion.CHOICE_TYPES and len([o for o in options if str(o).strip()]) < 1:
            raise serializers.ValidationError(
                {"options": "A choice question needs at least one option."}
            )
        lo = attrs.get("scale_min", getattr(self.instance, "scale_min", 1))
        hi = attrs.get("scale_max", getattr(self.instance, "scale_max", 5))
        if qtype == SurveyQuestion.TYPE_SCALE and int(hi) <= int(lo):
            raise serializers.ValidationError(
                {"scale_max": "The top of the scale must be above the bottom."}
            )
        return attrs


class SurveySerializer(serializers.ModelSerializer):
    questions = SurveyQuestionSerializer(many=True, read_only=True)
    question_count = serializers.SerializerMethodField()
    response_count = serializers.SerializerMethodField()
    is_open = serializers.SerializerMethodField()

    class Meta:
        model = Survey
        fields = [
            "id", "title", "description", "status", "opens_at", "closes_at",
            "created_at", "updated_at", "questions",
            "question_count", "response_count", "is_open",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_question_count(self, obj) -> int:
        return obj.questions.count()

    def get_response_count(self, obj) -> int:
        return obj.responses.filter(status=SurveyResponse.STATUS_SUBMITTED).count()

    def get_is_open(self, obj) -> bool:
        return obj.is_open()


class SurveyBriefSerializer(serializers.ModelSerializer):
    """What a student sees before opening one."""

    question_count = serializers.SerializerMethodField()

    class Meta:
        model = Survey
        fields = ["id", "title", "description", "closes_at", "question_count"]

    def get_question_count(self, obj) -> int:
        return obj.questions.count()


class SurveyAnswerSerializer(serializers.ModelSerializer):
    prompt = serializers.CharField(source="question.prompt", read_only=True)
    question_type = serializers.CharField(source="question.question_type", read_only=True)

    class Meta:
        model = SurveyAnswer
        fields = ["question", "prompt", "question_type", "value"]


class SurveyResponseSerializer(serializers.ModelSerializer):
    answers = SurveyAnswerSerializer(many=True, read_only=True)
    student_name = serializers.SerializerMethodField()

    class Meta:
        model = SurveyResponse
        fields = ["id", "survey", "student", "student_name", "status", "submitted_at", "answers"]

    def get_student_name(self, obj) -> str:
        user = obj.student
        return (
            f"{user.first_name} {user.last_name}".strip()
            or getattr(user, "username", "")
            or user.email
            or f"#{user.pk}"
        )
