"""Journal serializers.

Read serializers are hand-rolled (rich derived data: progress, validation, content
bundle). The write path uses a small ModelSerializer for scalar-field validation; files,
JSON id-lists and assessment links are reconciled in the view (multipart), mirroring
``classes.views.AssignmentViewSet``.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import Journal, JournalLesson


# --------------------------------------------------------------------------- helpers

def _abs_url(request, filefield):
    if not filefield:
        return None
    try:
        url = filefield.url
    except ValueError:
        return None
    return request.build_absolute_uri(url) if request is not None else url


def compute_progress(lessons) -> dict:
    """Progress/counts for a set of (ideally count-annotated) lessons.

    ``lessons`` should be a materialized list to avoid re-querying; readiness uses the
    ``_assess_count`` / ``_attach_count`` annotations set by the view when present.
    """
    homework = [l for l in lessons if not l.is_midterm]
    midterms = [l for l in lessons if l.is_midterm]
    ready = [l for l in homework if l.is_ready]
    hw_total = len(homework)
    return {
        "homework_total": hw_total,
        "homework_ready": len(ready),
        "homework_missing": hw_total - len(ready),
        "midterm_total": len(midterms),
        "midterm_count": len(midterms),
        "draft_count": sum(1 for l in lessons if l.status == JournalLesson.STATUS_DRAFT),
        "published_count": sum(
            1 for l in lessons if l.status == JournalLesson.STATUS_PUBLISHED
        ),
        "completion_pct": round(100 * len(ready) / hw_total) if hw_total else 0,
    }


# --------------------------------------------------------------------------- journals

class JournalListSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    subject = serializers.CharField()
    subject_label = serializers.SerializerMethodField()
    level = serializers.CharField()
    level_label = serializers.SerializerMethodField()
    title = serializers.CharField()
    display_title = serializers.CharField()
    status = serializers.CharField()
    duration_months = serializers.IntegerField()
    total_lessons = serializers.IntegerField()
    version = serializers.IntegerField()
    last_updated = serializers.DateTimeField(source="updated_at")
    progress = serializers.SerializerMethodField()

    def get_subject_label(self, obj):
        return dict(Journal.SUBJECT_CHOICES).get(obj.subject, obj.subject)

    def get_level_label(self, obj):
        return dict(Journal.LEVEL_CHOICES).get(obj.level, obj.level)

    def get_progress(self, obj):
        return compute_progress(list(obj.lessons.all()))


class JournalLessonSummarySerializer(serializers.Serializer):
    """Timeline card — light lesson row."""

    id = serializers.IntegerField()
    lesson_number = serializers.IntegerField()
    lesson_type = serializers.CharField()
    status = serializers.CharField()
    title = serializers.CharField()
    content_count = serializers.IntegerField()
    is_ready = serializers.BooleanField()
    validation = serializers.SerializerMethodField()
    has_files = serializers.SerializerMethodField()
    has_assessment = serializers.SerializerMethodField()
    has_pastpaper = serializers.SerializerMethodField()
    due_after_days = serializers.IntegerField()
    updated_at = serializers.DateTimeField()
    created_at = serializers.DateTimeField()

    def get_validation(self, obj):
        return obj.validation_reasons()

    def get_has_files(self, obj):
        return bool(obj.attachment_file) or obj._extra_attachment_count() > 0

    def get_has_assessment(self, obj):
        return obj._assessment_count() > 0

    def get_has_pastpaper(self, obj):
        return bool(obj.practice_test_ids) or bool(obj.practice_test_pack_ids)


class JournalDetailSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    subject = serializers.CharField()
    subject_label = serializers.SerializerMethodField()
    level = serializers.CharField()
    level_label = serializers.SerializerMethodField()
    title = serializers.CharField()
    display_title = serializers.CharField()
    status = serializers.CharField()
    duration_months = serializers.IntegerField()
    total_lessons = serializers.IntegerField()
    version = serializers.IntegerField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()
    published_at = serializers.DateTimeField()
    archived_at = serializers.DateTimeField()
    progress = serializers.SerializerMethodField()
    lessons = serializers.SerializerMethodField()

    def get_subject_label(self, obj):
        return dict(Journal.SUBJECT_CHOICES).get(obj.subject, obj.subject)

    def get_level_label(self, obj):
        return dict(Journal.LEVEL_CHOICES).get(obj.level, obj.level)

    def get_progress(self, obj):
        return compute_progress(list(obj.lessons.all()))

    def get_lessons(self, obj):
        return JournalLessonSummarySerializer(
            list(obj.lessons.all()), many=True
        ).data


# --------------------------------------------------------------------------- lessons

class JournalLessonAssessmentSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    assessment_set_id = serializers.IntegerField()
    title = serializers.SerializerMethodField()
    subject = serializers.SerializerMethodField()
    level = serializers.SerializerMethodField()
    source = serializers.SerializerMethodField()

    def get_title(self, obj):
        return getattr(obj.assessment_set, "title", "")

    def get_subject(self, obj):
        return getattr(obj.assessment_set, "subject", "")

    def get_level(self, obj):
        return getattr(obj.assessment_set, "level", "") or ""

    def get_source(self, obj):
        return getattr(obj.assessment_set, "source", "") or ""


class JournalLessonDetailSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    journal_id = serializers.IntegerField()
    lesson_number = serializers.IntegerField()
    lesson_type = serializers.CharField()
    status = serializers.CharField()
    title = serializers.CharField()
    instructions = serializers.CharField()
    external_url = serializers.CharField()
    allow_file_upload = serializers.BooleanField()
    practice_scope = serializers.CharField()
    practice_test_ids = serializers.SerializerMethodField()
    practice_test_pack_ids = serializers.SerializerMethodField()
    category = serializers.CharField()
    max_score = serializers.DecimalField(max_digits=7, decimal_places=2, allow_null=True)
    due_after_days = serializers.IntegerField(allow_null=True)
    deadline_time = serializers.TimeField(allow_null=True)
    assessments = serializers.SerializerMethodField()
    attachment_urls = serializers.SerializerMethodField()
    content_count = serializers.IntegerField()
    is_ready = serializers.BooleanField()
    validation = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()

    def get_practice_test_ids(self, obj):
        return obj.practice_test_ids or []

    def get_practice_test_pack_ids(self, obj):
        return obj.practice_test_pack_ids or []

    def get_assessments(self, obj):
        return JournalLessonAssessmentSerializer(obj.assessments.all(), many=True).data

    def get_attachment_urls(self, obj):
        request = self.context.get("request")
        urls = []
        primary = _abs_url(request, obj.attachment_file)
        if primary:
            urls.append({"id": None, "name": obj.attachment_file.name.split("/")[-1], "url": primary})
        for extra in obj.extra_attachments.all():
            url = _abs_url(request, extra.file)
            if url:
                urls.append({"id": extra.id, "name": extra.file.name.split("/")[-1], "url": url})
        return urls

    def get_validation(self, obj):
        return obj.validation_reasons()


class JournalLessonWriteSerializer(serializers.ModelSerializer):
    """Scalar-field validation for the lesson editor save (partial). Files, JSON id-lists
    and assessment links are handled in the view."""

    class Meta:
        model = JournalLesson
        fields = [
            "title",
            "instructions",
            "external_url",
            "allow_file_upload",
            "practice_scope",
            "category",
            "max_score",
            "due_after_days",
            "deadline_time",
        ]
        extra_kwargs = {f: {"required": False} for f in fields}
