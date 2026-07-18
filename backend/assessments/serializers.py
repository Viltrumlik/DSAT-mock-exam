from __future__ import annotations

import re

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
            "question_prompt",
            "question_type",
            "choices",
            "points",
            "is_active",
            "explanation",
            "question_image",
            "option_a_image",
            "option_b_image",
            "option_c_image",
            "option_d_image",
        ]


@extend_schema_serializer(component_name="AssessmentQuestionRunner")
class AssessmentQuestionRunnerSerializer(serializers.ModelSerializer):
    """
    Student-runner-safe question serializer: like AssessmentQuestionSerializer but
    OMITS ``explanation`` (the worked solution, shown only AFTER grading), on top of
    correct_answer/grading_config (never listed). Used for the in-progress attempt
    bundle so a student can't read the solution before answering.
    """

    class Meta:
        model = AssessmentQuestion
        fields = [
            "id",
            "order",
            "prompt",
            "question_prompt",
            "question_type",
            "choices",
            "points",
            "is_active",
            "question_image",
            "option_a_image",
            "option_b_image",
            "option_c_image",
            "option_d_image",
        ]


class AssessmentQuestionAdminReadSerializer(serializers.ModelSerializer):
    """
    Admin-only read serializer: identical to AssessmentQuestionSerializer but
    also exposes correct_answer and grading_config so the builder UI can
    correctly display the saved correct answer when re-opening a question.
    NOT used on student-facing endpoints.
    """

    class Meta:
        model = AssessmentQuestion
        fields = [
            "id",
            "order",
            "prompt",
            "question_prompt",
            "question_type",
            "choices",
            "correct_answer",
            "grading_config",
            "points",
            "is_active",
            "explanation",
            "question_image",
            "option_a_image",
            "option_b_image",
            "option_c_image",
            "option_d_image",
        ]


_CLEAR_IMAGE_FIELDS = [
    "clear_question_image",
    "clear_option_a_image",
    "clear_option_b_image",
    "clear_option_c_image",
    "clear_option_d_image",
]

# A numeric answer is either a plain number or a simple fraction like "1/2" or
# "-3/4" (graded as a decimal on the backend). Mirrors the builder's client check.
_FRACTION_RE = re.compile(r"^-?\d+(?:\.\d+)?/-?\d+(?:\.\d+)?$")


class AssessmentQuestionAdminWriteSerializer(serializers.ModelSerializer):
    """
    Create/update serializer for the builder.

    ``assessment_set`` and ``order`` are **server-owned** (read-only): the parent
    set is injected by the view via ``save(assessment_set=…)`` and ``order`` is
    assigned under a set row-lock (append on create; the atomic reorder endpoint
    otherwise). This closes two defects: (1) a stale builder tab sending ``order``
    can no longer collide under ``UNIQUE(assessment_set, order)``, and (2) the
    client can't spoof ``assessment_set`` across sets.

    Validation is strict and returns precise per-field messages so the builder can
    surface *why* a save failed instead of a generic error. JSON columns tolerate a
    raw JSON string (belt-and-suspenders for any transport that skips DRF's
    html-input decoding) and reject malformed values by name.
    """

    clear_question_image = serializers.BooleanField(write_only=True, required=False)
    clear_option_a_image = serializers.BooleanField(write_only=True, required=False)
    clear_option_b_image = serializers.BooleanField(write_only=True, required=False)
    clear_option_c_image = serializers.BooleanField(write_only=True, required=False)
    clear_option_d_image = serializers.BooleanField(write_only=True, required=False)

    class Meta:
        model = AssessmentQuestion
        read_only_fields = ["assessment_set", "order"]
        fields = [
            "id",
            "assessment_set",
            "order",
            "prompt",
            "question_prompt",
            "question_type",
            "choices",
            "correct_answer",
            "grading_config",
            "points",
            "is_active",
            "explanation",
            "question_image",
            "option_a_image",
            "option_b_image",
            "option_c_image",
            "option_d_image",
            "clear_question_image",
            "clear_option_a_image",
            "clear_option_b_image",
            "clear_option_c_image",
            "clear_option_d_image",
        ]

    # ── field-level structural checks ────────────────────────────────────────
    # NOTE: choices/correct_answer/grading_config are DRF JSONFields — by the time
    # these run, DRF has already decoded any JSON string (a malformed string 400s
    # as "<field>: Value must be valid JSON" before we get here). So we only assert
    # the top-level shape; type-specific rules live in validate() below.
    def validate_choices(self, value):
        if value in (None, ""):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError("Choices must be a list.")
        return value

    def validate_grading_config(self, value):
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("Grading config must be an object.")
        return value

    # ── cross-field validation (type-aware, PATCH-tolerant) ──────────────────
    def validate(self, attrs):
        # On a partial PATCH, only re-validate the answer shape when the request is
        # actually changing it. Editing just prompt/points/is_active/images must NOT
        # re-check the stored choices/correct_answer — otherwise a legacy question
        # whose data predates these rules would become uneditable.
        is_create = self.instance is None
        touches_answer = is_create or any(
            f in attrs for f in ("question_type", "choices", "correct_answer", "grading_config")
        )
        if not touches_answer:
            return attrs

        def current(field, default=None):
            if field in attrs:
                return attrs[field]
            if self.instance is not None:
                return getattr(self.instance, field, default)
            return default

        qtype = current("question_type")
        choices = current("choices") or []
        correct = current("correct_answer")

        if qtype == AssessmentQuestion.TYPE_MULTIPLE_CHOICE:
            ids = []
            for i, ch in enumerate(choices):
                if not isinstance(ch, dict):
                    raise serializers.ValidationError({"choices": f"Choice #{i + 1} must be an object."})
                cid = str(ch.get("id") or "").strip()
                if not cid:
                    raise serializers.ValidationError({"choices": f"Choice #{i + 1} is missing an id."})
                ids.append(cid)
            if not ids:
                raise serializers.ValidationError({"choices": "Add at least one answer choice."})
            if len(set(ids)) != len(ids):
                raise serializers.ValidationError({"choices": "Answer choice ids must be unique."})
            # correct_answer is required on create; on partial PATCH it may be absent.
            has_correct = "correct_answer" in attrs or self.instance is not None
            if has_correct:
                cstr = correct if isinstance(correct, str) else ("" if correct is None else str(correct))
                if not cstr:
                    raise serializers.ValidationError({"correct_answer": "Pick which choice is correct."})
                if cstr not in ids:
                    raise serializers.ValidationError(
                        {"correct_answer": f'Selected answer "{cstr}" does not match any choice id.'}
                    )
                attrs["correct_answer"] = cstr

        elif qtype == AssessmentQuestion.TYPE_NUMERIC and ("correct_answer" in attrs):
            # Accept a single value OR several acceptable values (SAT grid-in: 10.25
            # and 21/2 are both correct). Input may be a JSON list or a
            # comma-separated string; each token is a number or a simple fraction.
            if isinstance(correct, list):
                tokens = [str(x).strip() for x in correct]
            else:
                raw = "" if correct is None else str(correct).strip()
                tokens = [t.strip() for t in raw.split(",")]
            tokens = [t for t in tokens if t != ""]
            if not tokens:
                raise serializers.ValidationError({"correct_answer": "Enter a correct numeric value."})

            def _coerce_numeric(tok: str):
                if _FRACTION_RE.match(tok):
                    # Reject a zero (or zero-ish) denominator now — otherwise
                    # grading swallows the DivisionByZero and the variant is
                    # silently un-answerable. Catch the teacher typo at save time.
                    _, _, den = tok.partition("/")
                    if float(den) == 0:
                        raise serializers.ValidationError(
                            {"correct_answer": "A fraction cannot have a zero denominator."}
                        )
                    return tok
                try:
                    return float(tok) if ("." in tok or "e" in tok.lower()) else int(tok)
                except (TypeError, ValueError):
                    raise serializers.ValidationError(
                        {"correct_answer": "Each value must be a number or a fraction like 1/2."}
                    )

            normalized = [_coerce_numeric(t) for t in tokens]
            # Store a bare value for a single answer (unchanged behavior); a list only
            # when there are genuinely several acceptable answers.
            attrs["correct_answer"] = normalized[0] if len(normalized) == 1 else normalized

        elif qtype == AssessmentQuestion.TYPE_BOOLEAN and ("correct_answer" in attrs):
            if isinstance(correct, bool):
                pass
            elif isinstance(correct, str) and correct.strip().lower() in ("true", "false"):
                attrs["correct_answer"] = correct.strip().lower() == "true"
            else:
                raise serializers.ValidationError({"correct_answer": "Value must be true or false."})

        elif qtype == AssessmentQuestion.TYPE_SHORT_TEXT and ("correct_answer" in attrs):
            if correct is not None and not isinstance(correct, (str, list)):
                raise serializers.ValidationError(
                    {"correct_answer": "Value must be a string or a list of acceptable strings."}
                )

        return attrs

    # ── image clear handling ─────────────────────────────────────────────────
    def _clear_image_field(self, instance, field_name):
        field = getattr(instance, field_name)
        if field:
            field.delete(save=False)
        setattr(instance, field_name, None)

    def create(self, validated_data):
        for key in _CLEAR_IMAGE_FIELDS:
            validated_data.pop(key, None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        image_fields = {
            "question_image": validated_data.pop("clear_question_image", False),
            "option_a_image": validated_data.pop("clear_option_a_image", False),
            "option_b_image": validated_data.pop("clear_option_b_image", False),
            "option_c_image": validated_data.pop("clear_option_c_image", False),
            "option_d_image": validated_data.pop("clear_option_d_image", False),
        }
        for field_name, should_clear in image_fields.items():
            if should_clear and field_name not in validated_data:
                self._clear_image_field(instance, field_name)
        return super().update(instance, validated_data)


@extend_schema_serializer(component_name="AssessmentSet")
class AssessmentSetSerializer(serializers.ModelSerializer):
    questions = AssessmentQuestionSerializer(many=True, read_only=True)
    # Creator attribution — only serialized when the view explicitly opts in via
    # context["expose_creator"] (super_admin on the set-list panel). This serializer
    # is ALSO nested under HomeworkAssignmentSerializer on student-facing endpoints,
    # so the fields must stay null unless the requesting view is a trusted admin one.
    created_by_email = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = AssessmentSet
        fields = [
            "id",
            "subject",
            "source",
            "level",
            "category",
            "title",
            "description",
            "is_active",
            "review_status",
            "created_at",
            "updated_at",
            "created_by_email",
            "created_by_name",
            "questions",
        ]
        read_only_fields = ["review_status"]

    def _expose_creator(self) -> bool:
        return bool(self.context.get("expose_creator"))

    def get_created_by_email(self, obj) -> str | None:
        if not self._expose_creator() or obj.created_by_id is None:
            return None
        return getattr(obj.created_by, "email", None)

    def get_created_by_name(self, obj) -> str | None:
        if not self._expose_creator() or obj.created_by_id is None:
            return None
        u = obj.created_by
        full = (u.get_full_name() or "").strip() if hasattr(u, "get_full_name") else ""
        return full or (getattr(u, "username", None) or getattr(u, "email", None))


@extend_schema_serializer(component_name="AssessmentSetRunner")
class AssessmentSetRunnerSerializer(serializers.ModelSerializer):
    """
    Student-runner-safe set serializer: nests the explanation-free question
    serializer so the in-progress attempt bundle's ``set.questions`` never leaks
    worked solutions. Used in place of AssessmentSetSerializer on both bundle paths.
    """

    questions = AssessmentQuestionRunnerSerializer(many=True, read_only=True)

    class Meta:
        model = AssessmentSet
        fields = [
            "id",
            "subject",
            "source",
            "level",
            "category",
            "title",
            "description",
            "is_active",
            "created_at",
            "updated_at",
            "questions",
        ]


@extend_schema_serializer(component_name="AssessmentSetAdmin")
class AssessmentSetAdminSerializer(serializers.ModelSerializer):
    """
    Admin read serializer for a set: includes correct_answer + grading_config
    on each question so the builder UI can display saved answers correctly.
    Only used by admin endpoints — never exposed to students.
    """

    questions = AssessmentQuestionAdminReadSerializer(many=True, read_only=True)

    class Meta:
        model = AssessmentSet
        fields = [
            "id",
            "subject",
            "source",
            "level",
            "category",
            "title",
            "description",
            "is_active",
            "review_status",
            "created_at",
            "updated_at",
            "questions",
        ]
        read_only_fields = ["review_status"]


class AssessmentSetAdminWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssessmentSet
        fields = [
            "id",
            "subject",
            "source",
            "level",
            "category",
            "title",
            "description",
            "is_active",
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        # Resolve the effective subject/source/level (fall back to the instance on PATCH).
        subject = attrs.get("subject") or getattr(self.instance, "subject", None)
        source = attrs.get("source", getattr(self.instance, "source", ""))
        level = attrs.get("level", getattr(self.instance, "level", ""))
        creating = self.instance is None
        if creating and not source:
            raise serializers.ValidationError(
                {"source": "Source is required when creating an assessment set."}
            )
        if source:
            allowed = AssessmentSet.allowed_sources_for_subject(subject)
            if source not in allowed:
                raise serializers.ValidationError(
                    {"source": f"'{source}' is not a valid source for {subject} sets."}
                )
        # Level is required in the authoring UI but not hard-blocked here (blank =
        # legacy/untagged, valid for existing sets). If provided it must fit the subject.
        if level:
            allowed_levels = AssessmentSet.allowed_levels_for_subject(subject)
            if level not in allowed_levels:
                raise serializers.ValidationError(
                    {"level": f"'{level}' is not a valid level for {subject} sets."}
                )
        return attrs


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
            "client_seq",
            "time_spent_seconds",
            "is_correct",
            "points_awarded",
            "answered_at",
        ]


@extend_schema_serializer(component_name="AssessmentAttempt")
class AttemptSerializer(serializers.ModelSerializer):
    answers = AttemptAnswerSerializer(many=True, read_only=True)
    homework_id = serializers.IntegerField(read_only=True)
    # Pause / resume state for save-and-exit. ``elapsed_seconds`` is the
    # server-authoritative time-on-task (frozen while paused) the runner seeds
    # its count-up timer from so it never resets to 0 on resume; ``server_now``
    # lets the client anchor a drift-free local clock.
    is_paused = serializers.BooleanField(read_only=True)
    elapsed_seconds = serializers.SerializerMethodField()
    server_now = serializers.SerializerMethodField()

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
            "question_times",
            "grading_status",
            "grading_attempts",
            "question_order",
            "answers",
            "is_paused",
            "paused_at",
            "paused_seconds",
            "current_question_index",
            "elapsed_seconds",
            "server_now",
        ]

    def get_elapsed_seconds(self, obj) -> int:
        return obj.elapsed_seconds()

    def get_server_now(self, obj) -> str:
        from django.utils import timezone as _tz
        return _tz.now().isoformat()


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
    # Prefer homework_id (unambiguous when an assignment bundles several
    # assessments). assignment_id is kept for back-compat: it resolves to the
    # assignment's single homework, and errors if the assignment has several.
    homework_id = serializers.IntegerField(required=False)
    assignment_id = serializers.IntegerField(required=False)

    def validate(self, attrs):
        if not attrs.get("homework_id") and not attrs.get("assignment_id"):
            raise serializers.ValidationError("Provide homework_id or assignment_id.")
        return attrs
    # Optional: retry mode — restrict attempt to a subset of question IDs.
    # Used by "retry incorrect only" flow in the pedagogical review page.
    focus_question_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        max_length=500,
    )


class SaveAnswerSerializer(serializers.Serializer):
    attempt_id = serializers.IntegerField()
    question_id = serializers.IntegerField()
    answer = serializers.JSONField(required=False, allow_null=True)
    client_seq = serializers.IntegerField(required=False, min_value=0)
    # Client may send these, but server will ignore for time tracking.
    answered_at = serializers.DateTimeField(required=False)
    # Optional: last-viewed question position, persisted so a resumed attempt
    # lands where the student left off (also stamped on pause).
    current_index = serializers.IntegerField(required=False, min_value=0)


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
    # Runner-safe: neither set.questions nor the top-level questions expose
    # explanation/correct_answer during an in-progress attempt.
    set = AssessmentSetRunnerSerializer()
    questions = AssessmentQuestionRunnerSerializer(many=True)


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

