"""Journal serializers.

Read serializers are hand-rolled (rich derived data: progress, validation, timetable,
content bundles). The write path uses small ModelSerializers for scalar-field validation;
files, JSON id-lists and assessment links are reconciled in the view (multipart), mirroring
``classes.views.AssignmentViewSet``.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import Journal, JournalClasswork, JournalLesson


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
    """Progress/counts for a set of (ideally count-annotated) sessions."""
    homework_sessions = [l for l in lessons if not l.is_midterm]
    midterms = [l for l in lessons if l.is_midterm]
    ready = [l for l in lessons if l.is_ready]
    hw_ready = [l for l in homework_sessions if l.homework_ready]
    cw_ready = [l for l in homework_sessions if l.classwork_ready]
    total = len(lessons)
    return {
        "sessions_total": total,
        "sessions_ready": len(ready),
        "sessions_missing": total - len(ready),
        "homework_total": len(homework_sessions),
        "homework_ready": len(hw_ready),
        "homework_missing": len(homework_sessions) - len(hw_ready),
        "classwork_ready": len(cw_ready),
        "classwork_missing": len(homework_sessions) - len(cw_ready),
        "midterm_total": len(midterms),
        "midterm_count": len(midterms),
        "midterm_configured": sum(1 for l in midterms if l.midterm_exam_id),
        "draft_count": sum(1 for l in lessons if l.status == JournalLesson.STATUS_DRAFT),
        "published_count": sum(
            1 for l in lessons if l.status == JournalLesson.STATUS_PUBLISHED
        ),
        "completion_pct": round(100 * len(ready) / total) if total else 0,
    }


def _assessment_rows(links):
    return [
        {
            "id": l.id,
            "assessment_set_id": l.assessment_set_id,
            "title": getattr(l.assessment_set, "title", ""),
            "subject": getattr(l.assessment_set, "subject", ""),
            "level": getattr(l.assessment_set, "level", "") or "",
            "source": getattr(l.assessment_set, "source", "") or "",
        }
        for l in links
    ]


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
    """Session row in the journal timeline."""

    id = serializers.IntegerField()
    lesson_number = serializers.IntegerField()
    lesson_type = serializers.CharField()
    status = serializers.CharField()
    title = serializers.CharField()
    content_count = serializers.IntegerField()
    is_ready = serializers.BooleanField()
    homework_ready = serializers.BooleanField()
    classwork_ready = serializers.BooleanField()
    validation = serializers.SerializerMethodField()
    homework_validation = serializers.SerializerMethodField()
    classwork_validation = serializers.SerializerMethodField()
    has_files = serializers.SerializerMethodField()
    has_assessment = serializers.SerializerMethodField()
    has_pastpaper = serializers.SerializerMethodField()
    midterm = serializers.SerializerMethodField()
    new_topic_title = serializers.SerializerMethodField()
    updated_at = serializers.DateTimeField()
    created_at = serializers.DateTimeField()

    def get_validation(self, obj):
        return obj.validation_reasons()

    def get_homework_validation(self, obj):
        return obj.homework_validation_reasons()

    def get_classwork_validation(self, obj):
        return obj.classwork_validation_reasons()

    def get_has_files(self, obj):
        return bool(obj.attachment_file) or obj._extra_attachment_count() > 0

    def get_has_assessment(self, obj):
        return obj._assessment_count() > 0

    def get_has_pastpaper(self, obj):
        return bool(obj.practice_test_ids) or bool(obj.practice_test_pack_ids)

    def get_midterm(self, obj):
        if not obj.is_midterm:
            return None
        exam = obj.midterm_exam
        return {
            "exam_id": obj.midterm_exam_id,
            "title": getattr(exam, "title", "") or "",
            "access_days_before": obj.midterm_access_days_before,
        }

    def get_new_topic_title(self, obj):
        cw = getattr(obj, "classwork", None)
        return (cw.new_topic_title if cw else "") or ""


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
    recommended = serializers.SerializerMethodField()
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

    def get_recommended(self, obj):
        """Advisory only — the admin decides the real session/midterm counts."""
        from . import structure

        try:
            months = structure.months_for(obj.subject, obj.level)
        except structure.InvalidCourse:
            return None
        total = months * structure.LESSONS_PER_MONTH
        return {
            "months": months,
            "lessons": total,
            "midterms": total // structure.MIDTERM_INTERVAL,
            "midterm_every": structure.MIDTERM_INTERVAL,
        }

    def get_progress(self, obj):
        return compute_progress(list(obj.lessons.all()))

    def get_lessons(self, obj):
        return JournalLessonSummarySerializer(list(obj.lessons.all()), many=True).data


# --------------------------------------------------------------------------- classwork

class JournalClassworkSerializer(serializers.Serializer):
    """The in-class plan for a session, plus the reminder timetable."""

    id = serializers.IntegerField()
    timetable = serializers.SerializerMethodField()
    total_minutes = serializers.IntegerField()

    homework_review_minutes = serializers.IntegerField()
    new_topic_minutes = serializers.IntegerField()
    break_minutes = serializers.IntegerField()
    exercises_minutes = serializers.IntegerField()
    revision_minutes = serializers.IntegerField()

    new_topic_title = serializers.CharField()
    new_topic_instructions = serializers.CharField()
    new_topic_external_url = serializers.CharField()
    new_topic_practice_test_ids = serializers.SerializerMethodField()
    new_topic_practice_test_pack_ids = serializers.SerializerMethodField()
    new_topic_assessments = serializers.SerializerMethodField()
    new_topic_attachment_urls = serializers.SerializerMethodField()

    exercise_practice_test_ids = serializers.SerializerMethodField()
    exercise_practice_test_pack_ids = serializers.SerializerMethodField()
    exercise_assessments = serializers.SerializerMethodField()

    revision_notes = serializers.CharField()
    revision_targets = serializers.SerializerMethodField()

    homework_review = serializers.SerializerMethodField()

    is_ready = serializers.BooleanField()
    validation = serializers.SerializerMethodField()

    def get_timetable(self, obj):
        return obj.timetable()

    def get_new_topic_practice_test_ids(self, obj):
        return obj.new_topic_practice_test_ids or []

    def get_new_topic_practice_test_pack_ids(self, obj):
        return obj.new_topic_practice_test_pack_ids or []

    def get_exercise_practice_test_ids(self, obj):
        return obj.exercise_practice_test_ids or []

    def get_exercise_practice_test_pack_ids(self, obj):
        return obj.exercise_practice_test_pack_ids or []

    def get_new_topic_assessments(self, obj):
        return _assessment_rows(
            [a for a in obj.assessments.all() if a.block == JournalClasswork.BLOCK_NEW_TOPIC]
        )

    def get_exercise_assessments(self, obj):
        return _assessment_rows(
            [a for a in obj.assessments.all() if a.block == JournalClasswork.BLOCK_EXERCISES]
        )

    def get_new_topic_attachment_urls(self, obj):
        request = self.context.get("request")
        urls = []
        primary = _abs_url(request, obj.new_topic_attachment_file)
        if primary:
            urls.append(
                {
                    "id": None,
                    "name": obj.new_topic_attachment_file.name.split("/")[-1],
                    "url": primary,
                }
            )
        for extra in obj.extra_attachments.all():
            url = _abs_url(request, extra.file)
            if url:
                urls.append(
                    {"id": extra.id, "name": extra.file.name.split("/")[-1], "url": url}
                )
        return urls

    def get_revision_targets(self, obj):
        """Revision re-opens the Exercises content for mistake review."""
        return {
            "assessments": self.get_exercise_assessments(obj),
            "practice_test_ids": obj.exercise_practice_test_ids or [],
            "practice_test_pack_ids": obj.exercise_practice_test_pack_ids or [],
        }

    def get_homework_review(self, obj):
        """Derived: the PREVIOUS session's homework, for in-class analysis.

        Nothing is authored for this block — the teacher re-opens last lesson's homework.
        """
        lesson = obj.lesson
        prev = (
            JournalLesson.objects.filter(
                journal_id=lesson.journal_id,
                lesson_number__lt=lesson.lesson_number,
                lesson_type=JournalLesson.TYPE_HOMEWORK,
            )
            .order_by("-lesson_number")
            .prefetch_related("assessments__assessment_set", "extra_attachments")
            .first()
        )
        if prev is None:
            return None
        request = self.context.get("request")
        attachments = []
        primary = _abs_url(request, prev.attachment_file)
        if primary:
            attachments.append(
                {"id": None, "name": prev.attachment_file.name.split("/")[-1], "url": primary}
            )
        for extra in prev.extra_attachments.all():
            url = _abs_url(request, extra.file)
            if url:
                attachments.append(
                    {"id": extra.id, "name": extra.file.name.split("/")[-1], "url": url}
                )
        return {
            "lesson_id": prev.id,
            "lesson_number": prev.lesson_number,
            "title": prev.title,
            "instructions": prev.instructions,
            "external_url": prev.external_url,
            "assessments": _assessment_rows(prev.assessments.all()),
            "practice_test_ids": prev.practice_test_ids or [],
            "practice_test_pack_ids": prev.practice_test_pack_ids or [],
            "attachment_urls": attachments,
            "allow_file_upload": prev.allow_file_upload,
        }

    def get_validation(self, obj):
        return obj.validation_reasons()


class JournalClassworkWriteSerializer(serializers.ModelSerializer):
    """Scalar-field validation for the classwork editor save (partial)."""

    class Meta:
        model = JournalClasswork
        fields = [
            "homework_review_minutes",
            "new_topic_minutes",
            "break_minutes",
            "exercises_minutes",
            "revision_minutes",
            "new_topic_title",
            "new_topic_instructions",
            "new_topic_external_url",
            "revision_notes",
        ]
        extra_kwargs = {f: {"required": False} for f in fields}


# --------------------------------------------------------------------------- lessons

class JournalLessonDetailSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    journal_id = serializers.IntegerField()
    lesson_number = serializers.IntegerField()
    lesson_type = serializers.CharField()
    status = serializers.CharField()

    # Homework brief
    title = serializers.CharField()
    instructions = serializers.CharField()
    external_url = serializers.CharField()
    allow_file_upload = serializers.BooleanField()
    practice_scope = serializers.CharField()
    practice_test_ids = serializers.SerializerMethodField()
    practice_test_pack_ids = serializers.SerializerMethodField()
    category = serializers.CharField()
    max_score = serializers.DecimalField(max_digits=7, decimal_places=2, allow_null=True)
    assessments = serializers.SerializerMethodField()
    attachment_urls = serializers.SerializerMethodField()

    # Midterm session
    midterm = serializers.SerializerMethodField()

    # In-class plan
    classwork = serializers.SerializerMethodField()

    content_count = serializers.IntegerField()
    is_ready = serializers.BooleanField()
    homework_ready = serializers.BooleanField()
    classwork_ready = serializers.BooleanField()
    validation = serializers.SerializerMethodField()
    homework_validation = serializers.SerializerMethodField()
    classwork_validation = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()

    def get_practice_test_ids(self, obj):
        return obj.practice_test_ids or []

    def get_practice_test_pack_ids(self, obj):
        return obj.practice_test_pack_ids or []

    def get_assessments(self, obj):
        return _assessment_rows(obj.assessments.all())

    def get_attachment_urls(self, obj):
        request = self.context.get("request")
        urls = []
        primary = _abs_url(request, obj.attachment_file)
        if primary:
            urls.append(
                {"id": None, "name": obj.attachment_file.name.split("/")[-1], "url": primary}
            )
        for extra in obj.extra_attachments.all():
            url = _abs_url(request, extra.file)
            if url:
                urls.append(
                    {"id": extra.id, "name": extra.file.name.split("/")[-1], "url": url}
                )
        return urls

    def get_midterm(self, obj):
        if not obj.is_midterm:
            return None
        exam = obj.midterm_exam
        return {
            "exam_id": obj.midterm_exam_id,
            "title": getattr(exam, "title", "") or "",
            "subject": getattr(exam, "subject", "") or "",
            "level": getattr(exam, "level", "") or "",
            "scoring_scale": getattr(exam, "scoring_scale", "") or "",
            "duration_minutes": getattr(exam, "duration_minutes", None),
            "access_days_before": obj.midterm_access_days_before,
        }

    def get_classwork(self, obj):
        if obj.is_midterm:
            return None
        cw = getattr(obj, "classwork", None)
        if cw is None:
            return None
        return JournalClassworkSerializer(cw, context=self.context).data

    def get_validation(self, obj):
        return obj.validation_reasons()

    def get_homework_validation(self, obj):
        return obj.homework_validation_reasons()

    def get_classwork_validation(self, obj):
        return obj.classwork_validation_reasons()


class JournalLessonWriteSerializer(serializers.ModelSerializer):
    """Scalar-field validation for the homework-brief save (partial)."""

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
            "midterm_access_days_before",
        ]
        extra_kwargs = {f: {"required": False} for f in fields}
