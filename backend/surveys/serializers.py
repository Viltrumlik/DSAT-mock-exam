from __future__ import annotations

from rest_framework import serializers

from .models import Survey, SurveyAnswer, SurveyQuestion, SurveyResponse


def _image_url(instance, request=None):
    """Signed URL for an attached picture, or None.

    The ``ValueError`` guard is the house pattern (shop/serializers.py, questionbank/
    serializers.py, assessments/helpers.py): calling ``.url`` on an unset ImageField raises
    rather than returning None, and the R2 bucket is private, so every URL is signed and
    expires in an hour — never cache one or store it.
    """
    image = getattr(instance, "image", None)
    if not image:
        return None
    try:
        url = image.url
    except ValueError:
        return None
    return request.build_absolute_uri(url) if request and url.startswith("/") else url


class SurveyQuestionSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = SurveyQuestion
        fields = [
            "id", "order", "prompt", "help_text", "question_type",
            "is_required", "options", "max_selections", "scale_min", "scale_max",
            "image", "image_url",
            # The recommendation slider's two written ends.
            "scale_low_label", "scale_high_label",
            # The follow-up box: when it opens, what it says while empty, whether it must
            # be filled in, and — for choice questions — which options open it.
            "follow_up_threshold", "follow_up_placeholder", "follow_up_required",
            "follow_up_options",
            # Show this question only when an earlier one was answered a certain way.
            "condition_question", "condition_operator", "condition_value",
        ]
        extra_kwargs = {"image": {"write_only": True, "required": False, "allow_null": True}}

    def get_image_url(self, obj) -> str | None:
        return _image_url(obj, self.context.get("request"))

    def _validate_condition(self, attrs, field):
        """The four rules that make a display condition safe to evaluate in one pass."""
        source = field("condition_question")
        operator = field("condition_operator") or ""
        if source is None and not operator:
            return
        if source is None or not operator:
            raise serializers.ValidationError({
                "condition_question": "Pick both a question and a rule, or neither."
            })

        # 1. Same survey. A condition across surveys could never be evaluated — the other
        #    survey's answers are not in this response.
        survey = self.instance.survey if self.instance is not None else self.context.get("survey")
        if survey is not None and source.survey_id != survey.id:
            raise serializers.ValidationError({
                "condition_question": "That question belongs to a different survey."
            })

        # 2. Not itself. Trivial, and a cycle of one.
        if self.instance is not None and source.pk == self.instance.pk:
            raise serializers.ValidationError({
                "condition_question": "A question cannot depend on itself."
            })

        # 3. EARLIER. This is the load-bearing rule: it makes cycles impossible without a
        #    graph walk, lets the whole form be evaluated in a single ordered pass, and stops
        #    a student being asked to satisfy a condition from a question further down the
        #    page that they have not reached.
        own_order = field("order")
        if own_order is None and self.instance is not None:
            own_order = self.instance.order
        if own_order is not None and source.order >= int(own_order):
            raise serializers.ValidationError({
                "condition_question": "The question it depends on has to come before it."
            })

        # 4. The operator has to suit the source's type, or it can never be true.
        value = field("condition_value")
        if operator in SurveyQuestion.NUMERIC_CONDITIONS:
            if source.question_type not in SurveyQuestion.NUMERIC_TYPES:
                raise serializers.ValidationError({
                    "condition_operator": "A score rule only works on a scale or slider question."
                })
            try:
                bar = int(value)
            except (TypeError, ValueError):
                raise serializers.ValidationError({
                    "condition_value": "Give the score to compare against."
                })
            if not (source.scale_min <= bar <= source.scale_max):
                raise serializers.ValidationError({
                    "condition_value": (
                        f"That score is outside the question's scale "
                        f"({source.scale_min}–{source.scale_max})."
                    )
                })
        elif operator in SurveyQuestion.CHOICE_CONDITIONS:
            if source.question_type not in SurveyQuestion.CHOICE_TYPES:
                raise serializers.ValidationError({
                    "condition_operator": "An option rule only works on a choice question."
                })
            wanted = [str(v).strip() for v in (value or []) if str(v).strip()]
            if not wanted:
                raise serializers.ValidationError({
                    "condition_value": "Pick at least one option."
                })
            unknown = [w for w in wanted if w not in list(source.options or [])]
            if unknown:
                raise serializers.ValidationError({
                    "condition_value": f"“{unknown[0]}” is not one of that question's options."
                })
            attrs["condition_value"] = wanted

    def validate(self, attrs):
        def field(name, default=None):
            if name in attrs:
                return attrs[name]
            return getattr(self.instance, name, default)

        qtype = field("question_type")
        options = [str(o).strip() for o in (field("options") or []) if str(o).strip()]

        if qtype in SurveyQuestion.CHOICE_TYPES and len(options) < 1:
            raise serializers.ValidationError(
                {"options": "A choice question needs at least one option."}
            )
        if len(options) != len(set(options)):
            # The stored answer IS the option text, so two identical options would be two
            # rows of results nobody could tell apart.
            raise serializers.ValidationError(
                {"options": "Two options cannot have the same text."}
            )

        cap = int(field("max_selections", 0) or 0)
        if cap:
            if qtype != SurveyQuestion.TYPE_MULTI_CHOICE:
                raise serializers.ValidationError({
                    "max_selections": "Only a checkbox question can cap how many are picked."
                })
            if cap > len(options):
                # A cap above the number of options is not a cap; a required question with a
                # cap of 0 would be unanswerable. Both are author mistakes worth naming.
                raise serializers.ValidationError({
                    "max_selections": f"There are only {len(options)} options to pick from."
                })

        lo, hi = int(field("scale_min", 1) or 0), int(field("scale_max", 5) or 0)
        if qtype in SurveyQuestion.NUMERIC_TYPES and hi <= lo:
            raise serializers.ValidationError(
                {"scale_max": "The top of the scale must be above the bottom."}
            )

        threshold = field("follow_up_threshold")
        if threshold is not None and qtype in SurveyQuestion.NUMERIC_TYPES:
            if not (lo < int(threshold) <= hi):
                # At or below the bottom would open the box for nobody (nothing scores less
                # than the minimum); above the top would open it for everybody, which is a
                # required paragraph wearing a scale's clothes.
                raise serializers.ValidationError({
                    "follow_up_threshold": (
                        f"The satisfactory score has to sit inside the scale — more than "
                        f"{lo} and at most {hi}."
                    )
                })

        self._validate_condition(attrs, field)

        triggers = [str(o).strip() for o in (field("follow_up_options") or []) if str(o).strip()]
        unknown = [t for t in triggers if t not in options]
        if unknown:
            raise serializers.ValidationError({
                "follow_up_options": f"“{unknown[0]}” is not one of this question's options."
            })

        # STORE what was validated, not what was posted. Everything above checked the
        # cleaned lists — blanks dropped, values coerced to str, whitespace stripped — and
        # then returned `attrs` untouched, so the raw payload went to the database and the
        # two drifted apart:
        #   * options=[1, 2, 3] validated fine and stored ints; the form renders 1/2/3, a
        #     pick posts "1", and `normalize_answer`'s `str(raw) not in options` refuses it
        #     — which, because submitting is all-or-nothing, locked EVERY student out of the
        #     whole survey;
        #   * options=["Yes ", "No"] with a "Yes" trigger stored the trailing space, so the
        #     follow-up box the author configured never opened for anybody.
        # The stored answer IS the option text, so these have to be the same strings.
        if "options" in attrs:
            attrs["options"] = options
        if "follow_up_options" in attrs:
            attrs["follow_up_options"] = triggers
        return attrs


class SurveySerializer(serializers.ModelSerializer):
    questions = SurveyQuestionSerializer(many=True, read_only=True)
    question_count = serializers.SerializerMethodField()
    response_count = serializers.SerializerMethodField()
    is_open = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = Survey
        fields = [
            "id", "title", "description", "status", "opens_at", "closes_at",
            "allow_anonymous", "image", "image_url",
            "audience_kind", "audience_level", "audience_classrooms", "audience_branch",
            "points_award",
            "created_at", "updated_at", "questions",
            "question_count", "response_count", "is_open",
        ]
        read_only_fields = ["created_at", "updated_at"]
        extra_kwargs = {"image": {"write_only": True, "required": False, "allow_null": True}}

    def get_image_url(self, obj) -> str | None:
        return _image_url(obj, self.context.get("request"))

    def get_question_count(self, obj) -> int:
        # `len(obj.questions.all())` rather than `.count()`: the list view prefetches the
        # questions to serialize them anyway, so a COUNT per survey would be a second query
        # for a number already in memory.
        return len(obj.questions.all())

    def get_response_count(self, obj) -> int:
        cached = getattr(obj, "submitted_count", None)
        if cached is not None:
            return cached
        return obj.responses.filter(status=SurveyResponse.STATUS_SUBMITTED).count()

    def get_is_open(self, obj) -> bool:
        return obj.is_open()


class SurveyBriefSerializer(serializers.ModelSerializer):
    """What a student sees before opening one."""

    question_count = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = Survey
        fields = [
            "id", "title", "description", "closes_at", "question_count",
            "allow_anonymous", "image_url", "points_award",
        ]

    def get_image_url(self, obj) -> str | None:
        return _image_url(obj, self.context.get("request"))

    def get_question_count(self, obj) -> int:
        return obj.questions.count()


class SurveyAnswerSerializer(serializers.ModelSerializer):
    prompt = serializers.CharField(source="question.prompt", read_only=True)
    question_type = serializers.CharField(source="question.question_type", read_only=True)

    class Meta:
        model = SurveyAnswer
        fields = ["question", "prompt", "question_type", "value", "follow_up"]


class SurveyResponseSerializer(serializers.ModelSerializer):
    answers = SurveyAnswerSerializer(many=True, read_only=True)
    student_name = serializers.SerializerMethodField()
    student = serializers.SerializerMethodField()
    classroom_name = serializers.CharField(source="classroom.name", read_only=True, default=None)

    class Meta:
        model = SurveyResponse
        fields = [
            "id", "survey", "student", "student_name", "is_anonymous", "submitted_at",
            # The cohort SNAPSHOT. Safe on an anonymous reply — it says which class the
            # answer came from, never who wrote it, which is the whole point of collecting it.
            "classroom", "classroom_name", "level",
            "answers",
        ]

    # Anonymity is enforced HERE, on the only surface that reads a response, rather than left
    # to each client to respect. A serializer that shipped the id and asked the UI not to
    # render it would have handed the name to anyone who opened the network tab.
    def get_student(self, obj) -> int | None:
        return None if obj.is_anonymous else obj.student_id

    def get_student_name(self, obj) -> str:
        if obj.is_anonymous:
            return "Anonymous"
        user = obj.student
        return (
            f"{user.first_name} {user.last_name}".strip()
            or getattr(user, "username", "")
            or user.email
            or f"#{user.pk}"
        )
