from __future__ import annotations

from drf_spectacular.utils import extend_schema_serializer
from rest_framework import serializers

from .models import (
    AssessmentSet,
    AssessmentSetVersion,
    AssessmentQuestion,
    HomeworkAssignment,
    AssessmentAttempt,
    AssessmentAnswer,
    AssessmentResult,
)


@extend_schema_serializer(component_name="AssessmentQuestion")
class AssessmentQuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssessmentQuestion
        fields = [
            "id",
            "order",
            "prompt",
            "question_type",
            "choices",
            "points",
            "is_active",
            "explanation",
            "question_image",
        ]


class AssessmentQuestionAdminWriteSerializer(serializers.ModelSerializer):
    clear_question_image = serializers.BooleanField(write_only=True, required=False)

    class Meta:
        model = AssessmentQuestion
        fields = [
            "id",
            "assessment_set",
            "order",
            "prompt",
            "question_type",
            "choices",
            "correct_answer",
            "grading_config",
            "points",
            "is_active",
            "explanation",
            "question_image",
            "clear_question_image",
        ]

    def create(self, validated_data):
        validated_data.pop("clear_question_image", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        clear_question_image = validated_data.pop("clear_question_image", False)
        if clear_question_image and "question_image" not in validated_data:
            if instance.question_image:
                instance.question_image.delete(save=False)
            instance.question_image = None
        return super().update(instance, validated_data)


@extend_schema_serializer(component_name="AssessmentSet")
class AssessmentSetSerializer(serializers.ModelSerializer):
    questions = AssessmentQuestionSerializer(many=True, read_only=True)

    class Meta:
        model = AssessmentSet
        fields = [
            "id",
            "subject",
            "category",
            "title",
            "description",
            "is_active",
            "created_at",
            "updated_at",
            "questions",
        ]


class AssessmentSetAdminWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssessmentSet
        fields = [
            "id",
            "subject",
            "category",
            "title",
            "description",
            "is_active",
        ]


class HomeworkAssignmentSerializer(serializers.ModelSerializer):
    assessment_set = AssessmentSetSerializer(read_only=True)

    class Meta:
        model = HomeworkAssignment
        fields = ["id", "classroom_id", "assignment_id", "assessment_set", "assigned_by_id", "created_at"]


@extend_schema_serializer(component_name="AssessmentAttemptAnswer")
class AttemptAnswerSerializer(serializers.ModelSerializer):
    question_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = AssessmentAnswer
        fields = [
            "id",
            "question_id",
            "answer",
            "time_spent_seconds",
            "is_correct",
            "points_awarded",
            "answered_at",
        ]


@extend_schema_serializer(component_name="AssessmentAttempt")
class AttemptSerializer(serializers.ModelSerializer):
    answers = AttemptAnswerSerializer(many=True, read_only=True)
    homework_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = AssessmentAttempt
        fields = [
            "id",
            "homework_id",
            "student_id",
            "status",
            "started_at",
            "submitted_at",
            "abandoned_at",
            "last_activity_at",
            "total_time_seconds",
            "active_time_seconds",
            "grading_status",
            "grading_attempts",
            "question_order",
            "answers",
        ]


@extend_schema_serializer(component_name="AssessmentResult")
class ResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssessmentResult
        fields = [
            "id",
            "attempt_id",
            "score_points",
            "max_points",
            "percent",
            "correct_count",
            "total_questions",
            "graded_at",
        ]


class AssignHomeworkSerializer(serializers.Serializer):
    classroom_id = serializers.IntegerField()
    set_id = serializers.IntegerField()
    title = serializers.CharField(required=False, allow_blank=True)
    instructions = serializers.CharField(required=False, allow_blank=True)
    due_at = serializers.DateTimeField(required=False, allow_null=True)


class StartAttemptSerializer(serializers.Serializer):
    assignment_id = serializers.IntegerField()


class SaveAnswerSerializer(serializers.Serializer):
    attempt_id = serializers.IntegerField()
    question_id = serializers.IntegerField()
    answer = serializers.JSONField(required=False, allow_null=True)
    client_seq = serializers.IntegerField(required=False, min_value=0)
    # Client may send these, but server will ignore for time tracking.
    answered_at = serializers.DateTimeField(required=False)


class SubmitAttemptSerializer(serializers.Serializer):
    attempt_id = serializers.IntegerField()


class ApiAssessmentDetailSerializer(serializers.Serializer):
    """Minimal `{detail}` error payloads returned by assessments student APIs."""

    detail = serializers.CharField()


class SaveAnswerStaleWriteSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.CharField()
    server_client_seq = serializers.IntegerField()
    answer_id = serializers.IntegerField()


class SaveAnswerStoredSerializer(serializers.Serializer):
    answer_id = serializers.IntegerField()


@extend_schema_serializer(component_name="AssessmentAttemptBundleResponse")
class AttemptBundleResponseSerializer(serializers.Serializer):
    attempt = AttemptSerializer()
    set = AssessmentSetSerializer()
    questions = AssessmentQuestionSerializer(many=True)


@extend_schema_serializer(component_name="AssessmentSubmitQueuedResponse")
class SubmitAttemptQueuedResponseSerializer(serializers.Serializer):
    """Async grading accepted; poll `my-result` or re-fetch bundle for graded state."""

    attempt = AttemptSerializer()
    result = ResultSerializer(required=True, allow_null=True)
    grading = serializers.ChoiceField(choices=[("pending", "Pending")])


@extend_schema_serializer(component_name="AssessmentSubmitCompleteResponse")
class SubmitAttemptCompleteResponseSerializer(serializers.Serializer):
    """Submit completed synchronously or idempotent replay of submitted/graded attempt."""

    attempt = AttemptSerializer()
    result = ResultSerializer(required=False, allow_null=True)


@extend_schema_serializer(component_name="AssessmentSnapshotConflictResponse")
class SubmitAssessmentVersionConflictSerializer(serializers.Serializer):
    detail = serializers.CharField()


@extend_schema_serializer(component_name="AssessmentSubmitBadRequestResponse")
class SubmitAttemptBadRequestSerializer(serializers.Serializer):
    detail = serializers.CharField()
    missing_question_ids = serializers.ListField(child=serializers.IntegerField(), required=False)


@extend_schema_serializer(component_name="AssessmentMyResultResponse")
class MyAssessmentResultResponseSerializer(serializers.Serializer):
    attempt = AttemptSerializer(required=True, allow_null=True)
    result = ResultSerializer(required=True, allow_null=True)


@extend_schema_serializer(component_name="AssessmentSetVersion")
class AssessmentSetVersionSerializer(serializers.ModelSerializer):
    """
    Read-only serializer for AssessmentSetVersion.

    snapshot_json is intentionally excluded from the default fields — it is
    large and should only be returned when explicitly requested (e.g. a
    dedicated snapshot-download endpoint). Use snapshot_json_field below
    if you need to include it.
    """

    set_id = serializers.IntegerField(source="assessment_set_id", read_only=True)
    set_title = serializers.CharField(source="assessment_set.title", read_only=True)
    published_by_email = serializers.SerializerMethodField()

    class Meta:
        model = AssessmentSetVersion
        fields = [
            "id",
            "set_id",
            "set_title",
            "version_number",
            "snapshot_checksum",
            "question_count",
            "published_by",
            "published_by_email",
            "published_at",
        ]
        read_only_fields = fields

    def get_published_by_email(self, obj) -> str | None:
        if obj.published_by_id is None:
            return None
        return getattr(obj.published_by, "email", None)


@extend_schema_serializer(component_name="AdminPublishResponse")
class AdminPublishResponseSerializer(serializers.Serializer):
    """Returned by POST /admin/sets/{pk}/publish/."""

    version = AssessmentSetVersionSerializer(read_only=True)
    created = serializers.BooleanField(
        read_only=True,
        help_text="True = new version was created; False = identical content, existing version returned.",
    )

