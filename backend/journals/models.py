"""Journal data model.

A **Journal** is the complete, pre-authored homework plan for ONE course Level
(subject + level). It holds a fixed set of **JournalLesson** rows: most are HOMEWORK
lessons carrying a homework template (identical shape to ``classes.Assignment``); every
12th lesson is a MIDTERM marker with no homework.

Templates reference **live** content (assessment sets, past papers) — nothing is version
-pinned here. Version-pinning happens later, at classroom-release time (future work); see
``journals.services.release_lesson_into_classroom``.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from . import structure


class Journal(models.Model):
    SUBJECT_ENGLISH = structure.SUBJECT_ENGLISH
    SUBJECT_MATH = structure.SUBJECT_MATH
    SUBJECT_CHOICES = [
        (SUBJECT_ENGLISH, "English"),
        (SUBJECT_MATH, "Math"),
    ]

    # subject → the two resource vocabularies (mirrors classes.Classroom):
    #   platform (READING_WRITING/MATH): PracticeTest.subject, MockExam.midterm_subject
    #   domain   (english/math):         AssessmentSet.subject
    _PLATFORM_SUBJECT = {SUBJECT_MATH: "MATH", SUBJECT_ENGLISH: "READING_WRITING"}
    _DOMAIN_SUBJECT = {SUBJECT_MATH: "math", SUBJECT_ENGLISH: "english"}

    LEVEL_FOUNDATION = "foundation"
    LEVEL_JUNIOR = "junior"
    LEVEL_MIDDLE = "middle"
    LEVEL_SENIOR = "senior"
    LEVEL_CHOICES = [
        (LEVEL_FOUNDATION, "Foundation"),
        (LEVEL_JUNIOR, "Junior"),
        (LEVEL_MIDDLE, "Middle"),
        (LEVEL_SENIOR, "Senior"),
    ]
    LEVELS_BY_SUBJECT = {
        SUBJECT_ENGLISH: (LEVEL_JUNIOR, LEVEL_MIDDLE, LEVEL_SENIOR),
        SUBJECT_MATH: (LEVEL_FOUNDATION, LEVEL_JUNIOR, LEVEL_MIDDLE, LEVEL_SENIOR),
    }

    STATUS_DRAFT = "DRAFT"
    STATUS_PUBLISHED = "PUBLISHED"
    STATUS_ARCHIVED = "ARCHIVED"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PUBLISHED, "Published"),
        (STATUS_ARCHIVED, "Archived"),
    ]

    subject = models.CharField(max_length=20, choices=SUBJECT_CHOICES, db_index=True)
    level = models.CharField(max_length=16, choices=LEVEL_CHOICES, db_index=True)
    title = models.CharField(
        max_length=200,
        blank=True,
        default="",
        help_text="Optional custom name. Falls back to the derived '<Subject> <Level> Journal'.",
    )
    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True
    )
    duration_months = models.PositiveSmallIntegerField(default=0)
    total_lessons = models.PositiveSmallIntegerField(default=0)
    version = models.PositiveIntegerField(default=1)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="journals_created"
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journals_updated",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    published_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "journals_journal"
        ordering = ["subject", "level"]
        constraints = [
            models.UniqueConstraint(
                fields=["subject", "level"], name="uniq_journal_subject_level"
            ),
        ]
        indexes = [
            models.Index(fields=["status"]),
        ]

    def __str__(self) -> str:
        return self.display_title

    @property
    def platform_subject(self) -> str | None:
        """READING_WRITING / MATH — for PracticeTest / MockExam filtering."""
        return self._PLATFORM_SUBJECT.get(self.subject)

    @property
    def domain_subject(self) -> str | None:
        """english / math — for AssessmentSet filtering."""
        return self._DOMAIN_SUBJECT.get(self.subject)

    @property
    def display_title(self) -> str:
        if self.title.strip():
            return self.title.strip()
        subject_label = dict(self.SUBJECT_CHOICES).get(self.subject, self.subject)
        level_label = dict(self.LEVEL_CHOICES).get(self.level, self.level)
        return f"{subject_label} {level_label} Journal"

    @classmethod
    def allowed_levels_for_subject(cls, subject: str) -> tuple[str, ...]:
        return cls.LEVELS_BY_SUBJECT.get(subject, ())


class JournalLesson(models.Model):
    """One lesson slot in a Journal — a homework template, or a midterm marker.

    Mirrors ``classes.Assignment`` (title/instructions/attachments/practice ids/scope),
    minus the ``classroom`` FK and absolute ``due_at``. Deadlines are **relative** here:
    ``due_after_days`` + ``deadline_time`` become an absolute due date only at release time.
    """

    TYPE_HOMEWORK = structure.LESSON_TYPE_HOMEWORK
    TYPE_MIDTERM = structure.LESSON_TYPE_MIDTERM
    TYPE_CHOICES = [
        (TYPE_HOMEWORK, "Homework"),
        (TYPE_MIDTERM, "Midterm"),
    ]

    STATUS_DRAFT = "DRAFT"
    STATUS_PUBLISHED = "PUBLISHED"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PUBLISHED, "Published"),
    ]

    # Mirror classes.Assignment.PRACTICE_SCOPE_* verbatim.
    PRACTICE_SCOPE_BOTH = "BOTH"
    PRACTICE_SCOPE_ENGLISH = "ENGLISH"
    PRACTICE_SCOPE_MATH = "MATH"
    PRACTICE_SCOPE_CHOICES = [
        (PRACTICE_SCOPE_BOTH, "Both (English & Math)"),
        (PRACTICE_SCOPE_ENGLISH, "English (Reading & Writing) only"),
        (PRACTICE_SCOPE_MATH, "Math only"),
    ]

    CATEGORY_HOMEWORK = "HOMEWORK"

    journal = models.ForeignKey(
        Journal, on_delete=models.CASCADE, related_name="lessons"
    )
    lesson_number = models.PositiveSmallIntegerField(db_index=True)
    lesson_type = models.CharField(
        max_length=12, choices=TYPE_CHOICES, default=TYPE_HOMEWORK, db_index=True
    )
    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True
    )
    published_at = models.DateTimeField(null=True, blank=True)

    # --- Homework template fields (identical semantics to classes.Assignment) ---
    title = models.CharField(max_length=200, blank=True, default="")
    instructions = models.TextField(blank=True, default="")
    # Several links per brief. ``external_urls`` (list) is the source of truth; the singular
    # ``external_url`` mirrors the first so has_content / release / clients keep working.
    external_url = models.URLField(blank=True, default="")
    external_urls = models.JSONField(default=list, blank=True)
    # Optional lesson video (link or direct URL) — copied onto the released homework so a
    # student who missed the lesson can watch it. See classes.Assignment.video_url.
    video_url = models.URLField(max_length=500, blank=True, default="")
    # Uploaded lesson video (R2, presigned direct upload). Aliased onto the released
    # Assignment (the object key is shared, not re-copied — see delivery).
    video_file = models.FileField(upload_to="journal_videos/", max_length=500, null=True, blank=True)
    attachment_file = models.FileField(upload_to="journal_files/", null=True, blank=True)
    allow_file_upload = models.BooleanField(default=False)
    practice_scope = models.CharField(
        max_length=20, choices=PRACTICE_SCOPE_CHOICES, default=PRACTICE_SCOPE_BOTH
    )
    practice_test_ids = models.JSONField(null=True, blank=True)
    practice_test_pack_ids = models.JSONField(null=True, blank=True)
    # Vocabulary bank sets (vocabulary.VocabSet ids, owner__isnull=True) assigned with this
    # homework. Live id-list (like practice_test_ids); expanded to VocabHomework at release.
    vocabulary_set_ids = models.JSONField(null=True, blank=True)
    category = models.CharField(max_length=20, default=CATEGORY_HOMEWORK)
    max_score = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)

    # NOTE: there is deliberately NO deadline field. Homework is due at the START of the
    # classroom's next lesson (computed at release time); if no next lesson can be
    # determined the homework simply has no deadline.

    # Midterm sessions: which midterm this session runs, and how many days before the
    # session the classroom should get access (config consumed by the future
    # classroom-release step — see services.release_lesson_into_classroom).
    #
    # Points at midterms.Midterm (NOT the legacy exams.MockExam): Midterm.level is a
    # strict superset — midterms/sync.py mirrors every legacy MockExam.midterm_level into
    # it, AND natively-authored midterms (legacy_mock_exam_id=NULL) only exist here. The
    # level picker would miss every native midterm if it filtered on MockExam.
    midterm_exam = models.ForeignKey(
        "midterms.Midterm",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_lessons",
    )
    midterm_access_days_before = models.PositiveSmallIntegerField(
        default=2,
        help_text="Grant the classroom access to the midterm this many days before the session.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "journals_lesson"
        ordering = ["journal_id", "lesson_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["journal", "lesson_number"], name="uniq_lesson_number_per_journal"
            ),
        ]
        indexes = [
            models.Index(fields=["journal", "status"]),
            models.Index(fields=["journal", "lesson_type"]),
        ]

    def __str__(self) -> str:
        return f"{self.journal_id}·L{self.lesson_number} ({self.lesson_type})"

    @property
    def is_midterm(self) -> bool:
        return self.lesson_type == self.TYPE_MIDTERM

    def _assessment_count(self) -> int:
        cached = getattr(self, "_assess_count", None)
        return cached if cached is not None else self.assessments.count()

    def _extra_attachment_count(self) -> int:
        cached = getattr(self, "_attach_count", None)
        return cached if cached is not None else self.extra_attachments.count()

    @property
    def content_count(self) -> int:
        """Number of distinct openable/attached content pieces on this lesson."""
        n = self._assessment_count() + self._extra_attachment_count()
        n += len(self.practice_test_ids or [])
        n += len(self.practice_test_pack_ids or [])
        n += len(self.vocabulary_set_ids or [])
        if self.attachment_file:
            n += 1
        return n

    @property
    def has_content(self) -> bool:
        return bool(
            self._assessment_count()
            or self._extra_attachment_count()
            or self.practice_test_ids
            or self.practice_test_pack_ids
            or self.vocabulary_set_ids
            or self.attachment_file
            or self.allow_file_upload
            # An external link alone is a valid deliverable — parity with the
            # classroom assignment model, where external_url counts as content.
            or (self.external_url or "").strip()
            # A lesson video alone is valid content too — a student who missed the
            # lesson can watch it.
            or (self.video_url or "").strip()
            or self.video_file
        )

    def homework_validation_reasons(self) -> list[str]:
        """Why this session's HOMEWORK isn't publishable. Empty list = ready."""
        if self.is_midterm:
            return []
        reasons: list[str] = []
        if not (self.instructions or "").strip():
            reasons.append("Homework instructions are empty")
        if not self.has_content:
            reasons.append(
                "Homework has no content (add an assessment, past paper, file, link, or enable file upload)"
            )
        return reasons

    def classwork_validation_reasons(self) -> list[str]:
        """Why this session's CLASSWORK isn't publishable. Empty list = ready."""
        if self.is_midterm:
            return []
        cw = getattr(self, "classwork", None)
        if cw is None:
            return ["Classwork not set up"]
        return cw.validation_reasons()

    def roadmap_validation_reasons(self) -> list[str]:
        """Why this session's ROADMAP isn't publishable. Empty list = ready.

        A session with NO roadmap is ready — the reading is optional (see
        ``JournalRoadmap.validation_reasons``). Only a roadmap that was started and left
        half-written is reported.
        """
        if self.is_midterm:
            return []
        roadmap = getattr(self, "roadmap", None)
        return roadmap.validation_reasons() if roadmap is not None else []

    def validation_reasons(self) -> list[str]:
        """Why this session can't be published. Empty list = ready.

        A MIDTERM session only needs its midterm exam chosen; a HOMEWORK session needs
        both its homework brief and its in-class plan (classwork) filled in, and must not
        have a half-written roadmap attached.
        """
        if self.is_midterm:
            return [] if self.midterm_exam_id else ["No midterm exam selected"]
        return (
            self.homework_validation_reasons()
            + self.classwork_validation_reasons()
            + self.roadmap_validation_reasons()
        )

    @property
    def has_roadmap(self) -> bool:
        """Whether there is anything for a student to read before this session's homework."""
        roadmap = getattr(self, "roadmap", None)
        return bool(roadmap is not None and roadmap.has_content)

    @property
    def homework_ready(self) -> bool:
        return not self.homework_validation_reasons()

    @property
    def classwork_ready(self) -> bool:
        return not self.classwork_validation_reasons()

    @property
    def is_ready(self) -> bool:
        return not self.validation_reasons()


class JournalClasswork(models.Model):
    """The in-class plan for one session — the five timetable blocks.

    Mirrors the lesson timetable:
        Homework review · New topic · Break · Exercises · Revision
        20 min          · 20-30 min · 10min · 20 min    · 30 min   (all editable)

    Block content:
      * Homework review — NOT authored here; it is derived (the PREVIOUS session's
        homework), so the teacher can re-open and analyse what was set last lesson.
      * New topic       — authored exactly like a homework brief (title/instructions/
        resources/files/link).
      * Break           — nothing to author; shown in the timetable only.
      * Exercises       — in-class assessments / past papers students get access to
        during the lesson.
      * Revision        — re-opens the Exercises content for mistake review; optional notes.
    """

    BLOCK_NEW_TOPIC = "NEW_TOPIC"
    BLOCK_EXERCISES = "EXERCISES"
    BLOCK_CHOICES = [
        (BLOCK_NEW_TOPIC, "New topic"),
        (BLOCK_EXERCISES, "Exercises"),
    ]

    DEFAULT_HOMEWORK_REVIEW_MINUTES = 20
    DEFAULT_NEW_TOPIC_MINUTES = 30
    DEFAULT_BREAK_MINUTES = 10
    DEFAULT_EXERCISES_MINUTES = 20
    DEFAULT_REVISION_MINUTES = 30

    lesson = models.OneToOneField(
        JournalLesson, on_delete=models.CASCADE, related_name="classwork"
    )

    # Durations (minutes) — timetable defaults, all editable per session.
    homework_review_minutes = models.PositiveSmallIntegerField(
        default=DEFAULT_HOMEWORK_REVIEW_MINUTES
    )
    new_topic_minutes = models.PositiveSmallIntegerField(default=DEFAULT_NEW_TOPIC_MINUTES)
    break_minutes = models.PositiveSmallIntegerField(default=DEFAULT_BREAK_MINUTES)
    exercises_minutes = models.PositiveSmallIntegerField(default=DEFAULT_EXERCISES_MINUTES)
    revision_minutes = models.PositiveSmallIntegerField(default=DEFAULT_REVISION_MINUTES)

    # --- New topic (authored like a homework brief) ---
    new_topic_title = models.CharField(max_length=200, blank=True, default="")
    new_topic_instructions = models.TextField(blank=True, default="")
    # Several links on the new-topic block; singular field mirrors the first (see above).
    new_topic_external_url = models.URLField(blank=True, default="")
    new_topic_external_urls = models.JSONField(default=list, blank=True)
    # Optional lesson video for the in-class plan (shown to the teacher in the panel).
    new_topic_video_url = models.URLField(max_length=500, blank=True, default="")
    new_topic_video_file = models.FileField(upload_to="journal_videos/", max_length=500, null=True, blank=True)
    new_topic_attachment_file = models.FileField(
        upload_to="journal_files/", null=True, blank=True
    )
    new_topic_practice_test_ids = models.JSONField(null=True, blank=True)
    new_topic_practice_test_pack_ids = models.JSONField(null=True, blank=True)
    new_topic_vocabulary_set_ids = models.JSONField(null=True, blank=True)

    # --- Exercises (in-class practice) ---
    exercise_practice_test_ids = models.JSONField(null=True, blank=True)
    exercise_practice_test_pack_ids = models.JSONField(null=True, blank=True)
    exercise_vocabulary_set_ids = models.JSONField(null=True, blank=True)

    # --- Revision ---
    revision_notes = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "journals_classwork"

    def __str__(self) -> str:
        return f"classwork(lesson={self.lesson_id})"

    # ---- timetable -------------------------------------------------------
    @property
    def total_minutes(self) -> int:
        return (
            self.homework_review_minutes
            + self.new_topic_minutes
            + self.break_minutes
            + self.exercises_minutes
            + self.revision_minutes
        )

    def timetable(self) -> list[dict]:
        """Ordered blocks for the reminder table shown above the classwork."""
        return [
            {"key": "HOMEWORK_REVIEW", "label": "Homework", "minutes": self.homework_review_minutes},
            {"key": "NEW_TOPIC", "label": "New topic", "minutes": self.new_topic_minutes},
            {"key": "BREAK", "label": "Break", "minutes": self.break_minutes},
            {"key": "EXERCISES", "label": "Exercises", "minutes": self.exercises_minutes},
            {"key": "REVISION", "label": "Revision", "minutes": self.revision_minutes},
        ]

    # ---- content helpers -------------------------------------------------
    def _assessments_for(self, block: str):
        return [a for a in self.assessments.all() if a.block == block]

    @property
    def has_new_topic_content(self) -> bool:
        return bool(
            self._assessments_for(self.BLOCK_NEW_TOPIC)
            or self.new_topic_practice_test_ids
            or self.new_topic_practice_test_pack_ids
            or self.new_topic_vocabulary_set_ids
            or self.new_topic_attachment_file
            or (self.new_topic_external_url or "").strip()
            or (self.new_topic_video_url or "").strip()
            or self.new_topic_video_file
        )

    @property
    def has_exercises(self) -> bool:
        return bool(
            self._assessments_for(self.BLOCK_EXERCISES)
            or self.exercise_practice_test_ids
            or self.exercise_practice_test_pack_ids
        )

    def validation_reasons(self) -> list[str]:
        """A session's in-class plan needs at least a new-topic brief."""
        reasons: list[str] = []
        if not (self.new_topic_title or "").strip():
            reasons.append("New topic title is empty")
        if not (self.new_topic_instructions or "").strip():
            reasons.append("New topic instructions are empty")
        return reasons

    @property
    def is_ready(self) -> bool:
        return not self.validation_reasons()


class JournalClassworkAssessment(models.Model):
    """Assessment set attached to a classwork block (new topic or exercises).

    Live reference, no version pin — same rationale as JournalLessonAssessment.
    """

    classwork = models.ForeignKey(
        JournalClasswork, on_delete=models.CASCADE, related_name="assessments"
    )
    assessment_set = models.ForeignKey(
        "assessments.AssessmentSet",
        on_delete=models.PROTECT,
        related_name="journal_classwork_links",
    )
    block = models.CharField(
        max_length=16,
        choices=JournalClasswork.BLOCK_CHOICES,
        default=JournalClasswork.BLOCK_NEW_TOPIC,
        db_index=True,
    )
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_classwork_assessment_links",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "journals_classwork_assessment"
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["classwork", "assessment_set", "block"],
                name="uniq_classwork_assessment_block",
            ),
        ]

    def __str__(self) -> str:
        return f"classwork={self.classwork_id} set={self.assessment_set_id} block={self.block}"


class JournalClassworkAttachment(models.Model):
    """Extra file on a classwork block (new topic)."""

    classwork = models.ForeignKey(
        JournalClasswork, on_delete=models.CASCADE, related_name="extra_attachments"
    )
    file = models.FileField(upload_to="journal_files/")
    block = models.CharField(
        max_length=16,
        choices=JournalClasswork.BLOCK_CHOICES,
        default=JournalClasswork.BLOCK_NEW_TOPIC,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "journals_classwork_attachment"
        ordering = ["id"]

    def __str__(self) -> str:
        return f"classwork={self.classwork_id} file={self.file.name}"


class JournalLessonAssessment(models.Model):
    """Assessment set attached to a lesson (mirrors assessments.HomeworkAssignment).

    Stores a **live** reference — NO ``set_version`` snapshot. A template must always
    reflect the current set content; the version is pinned later, when a classroom
    actually receives this homework.
    """

    lesson = models.ForeignKey(
        JournalLesson, on_delete=models.CASCADE, related_name="assessments"
    )
    assessment_set = models.ForeignKey(
        "assessments.AssessmentSet",
        on_delete=models.PROTECT,
        related_name="journal_lesson_links",
    )
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_assessment_links",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "journals_lesson_assessment"
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["lesson", "assessment_set"], name="uniq_lesson_assessment"
            ),
        ]

    def __str__(self) -> str:
        return f"lesson={self.lesson_id} set={self.assessment_set_id}"


class JournalLessonAttachment(models.Model):
    """Extra teacher file on a lesson (mirrors classes.AssignmentExtraAttachment)."""

    lesson = models.ForeignKey(
        JournalLesson, on_delete=models.CASCADE, related_name="extra_attachments"
    )
    file = models.FileField(upload_to="journal_files/")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "journals_lesson_attachment"
        ordering = ["id"]

    def __str__(self) -> str:
        return f"lesson={self.lesson_id} file={self.file.name}"


class JournalAuditEvent(models.Model):
    """Append-only history for a journal (powers the 'History' action)."""

    journal = models.ForeignKey(
        Journal, on_delete=models.CASCADE, related_name="audit_events"
    )
    lesson = models.ForeignKey(
        JournalLesson,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_audit_events",
    )
    event_type = models.CharField(max_length=40, db_index=True)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "journals_audit_event"
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"{self.journal_id}:{self.event_type}@{self.created_at:%Y-%m-%d}"


class ClassroomJournal(models.Model):
    """Binds one Classroom to the Journal template for its (subject, level).

    The journal is *derivable* from the classroom's subject+level, but the binding is
    stored for two reasons. First, ``starts_on`` is a stable anchor: session dates are
    counted from it, and without one ``lesson_starts`` would fall back to "today" for a
    classroom with no ``start_date`` and slide the whole plan forward every day. Second,
    an explicit binding survives a classroom's level being corrected mid-term, which would
    otherwise silently swap the class onto a different journal.
    """

    classroom = models.OneToOneField(
        "classes.Classroom", on_delete=models.CASCADE, related_name="journal_binding"
    )
    journal = models.ForeignKey(
        Journal, on_delete=models.PROTECT, related_name="classroom_bindings"
    )
    # Anchor for date mapping; seeded from classroom.start_date when the binding is made.
    # Null means "no computable dates" — the plan still lists, with no dates attached.
    starts_on = models.DateField(null=True, blank=True)
    bound_at = models.DateTimeField(auto_now_add=True)
    bound_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_bindings",
    )

    class Meta:
        db_table = "journals_classroom_journal"

    def __str__(self) -> str:
        return f"class {self.classroom_id} → journal {self.journal_id}"


class ClassroomLesson(models.Model):
    """One journal session **as actually delivered** in one classroom.

    A Journal is a template shared by every classroom of its (subject, level); this row is
    the per-classroom record of what happened to session N: when its homework was handed
    out, and which ``classes.Assignment`` that produced.

    Content is **never copied** here — it is read through ``journal_lesson``, so an admin
    fixing the template still reaches live classrooms. Content is duplicated exactly once,
    at release time, and only into the structures students already read
    (``classes.Assignment``, ``HomeworkAssignment``, ``MidtermSchedule``).

    Rows are created **lazily** — only when a teacher acts on a session. The teacher's
    lesson LIST is derived on read by pairing the journal's sessions with real dates from
    ``classes.lesson_schedule.lesson_starts``, so admin edits to the journal (adding,
    removing or reordering sessions) flow through automatically instead of needing a sync.
    """

    classroom = models.ForeignKey(
        "classes.Classroom", on_delete=models.CASCADE, related_name="journal_lessons"
    )
    # SET_NULL, not PROTECT: an admin must stay able to delete a session from the journal
    # even after some class has already delivered it (PROTECT made that a 500). The
    # delivery row outlives the template as history — it still points at the Assignment
    # the students actually received — and simply stops appearing in the derived plan.
    journal_lesson = models.ForeignKey(
        JournalLesson,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="classroom_deliveries",
    )
    # Snapshot of the template's position when this row was created. The live ordering
    # still comes from journal_lesson.lesson_number; this only preserves the number the
    # teacher actually saw, so history stays readable after the journal is renumbered.
    lesson_number = models.PositiveSmallIntegerField()
    # The concrete date this session was delivered on. Computed from the classroom
    # schedule at release time and then frozen, so a later schedule change cannot
    # retroactively move a lesson that already happened.
    scheduled_for = models.DateTimeField(null=True, blank=True)

    # Homework hand-out: the classes.Assignment built from the session's brief.
    assignment = models.ForeignKey(
        "classes.Assignment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_deliveries",
    )
    # In-class work granted during the lesson. Separate from `assignment` (the homework)
    # because HomeworkAssignment.assignment is NOT nullable — an assessment opened in
    # class still needs an Assignment to hang off, so it gets this one, categorised
    # CLASSWORK and with no deadline. One per lesson, reused by every item granted.
    classwork_assignment = models.ForeignKey(
        "classes.Assignment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_classwork_deliveries",
    )
    homework_released_at = models.DateTimeField(null=True, blank=True)
    released_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_lesson_releases",
    )
    # MIDTERM sessions only: the per-classroom access window created at grant time. The
    # 6-digit start code lives on this row too — assigning a midterm is NOT enough to let
    # students in, the teacher must also generate that code (see midterms.access).
    midterm_schedule = models.ForeignKey(
        "classes.MidtermSchedule",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_deliveries",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "journals_classroom_lesson"
        ordering = ["classroom_id", "lesson_number", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["classroom", "journal_lesson"],
                name="journals_classroom_lesson_unique",
            )
        ]
        indexes = [models.Index(fields=["classroom", "lesson_number"])]

    def __str__(self) -> str:
        return f"class {self.classroom_id} · session {self.lesson_number}"

    @property
    def homework_released(self) -> bool:
        return self.homework_released_at is not None


class ClassroomLessonGrant(models.Model):
    """One "give the class access to this" action a teacher took during a lesson.

    The teacher presses a button next to a specific item in the lesson plan; the access
    itself is written by ``access.engine.classroom_service.ClassroomAccessService`` into
    whichever legacy gate that resource type really uses (``PracticeTest.assigned_users``,
    ``ResourceAccessGrant``, …). This row is the *record* of the press, so the panel can
    show "Given" and so pressing twice is a no-op rather than a duplicate grant.
    """

    BLOCK_HOMEWORK = "HOMEWORK"
    BLOCK_NEW_TOPIC = "NEW_TOPIC"
    BLOCK_EXERCISES = "EXERCISES"
    BLOCK_MIDTERM = "MIDTERM"
    BLOCK_CHOICES = [
        (BLOCK_HOMEWORK, "Homework"),
        (BLOCK_NEW_TOPIC, "New topic"),
        (BLOCK_EXERCISES, "Exercises"),
        (BLOCK_MIDTERM, "Midterm"),
    ]

    classroom_lesson = models.ForeignKey(
        ClassroomLesson, on_delete=models.CASCADE, related_name="grants"
    )
    block = models.CharField(max_length=16, choices=BLOCK_CHOICES, db_index=True)
    # access.resources RT_* key (assessment_set / practice_test / practice_test_pack /
    # midterm_v2). Stored as a bare string so journals does not import the registry.
    resource_type = models.CharField(max_length=32, db_index=True)
    resource_id = models.PositiveIntegerField()

    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_lesson_grants",
    )
    granted_at = models.DateTimeField(auto_now_add=True, db_index=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "journals_classroom_lesson_grant"
        ordering = ["-granted_at", "-id"]
        constraints = [
            # Partial: only ACTIVE grants are unique, so the button is idempotent at the
            # DB level while a revoke-then-regrant still records both events.
            models.UniqueConstraint(
                fields=["classroom_lesson", "block", "resource_type", "resource_id"],
                condition=models.Q(revoked_at__isnull=True),
                name="journals_classroom_lesson_grant_unique_active",
            )
        ]

    def __str__(self) -> str:
        return f"{self.resource_type}#{self.resource_id} → lesson {self.classroom_lesson_id}"


class JournalRoadmap(models.Model):
    """The reading a student does BEFORE the homework — one per session.

    The third authored block on a session, beside the homework brief (flat on
    ``JournalLesson``) and the in-class plan (``JournalClasswork``). Those two are written
    for a teacher; this one is written for the STUDENT: the explanation of the topic, in
    pictures, video and prose, that they read on their own before opening the homework.

    Its content is a list of ordered SECTIONS rather than a fixed set of fields, because the
    school asked for "images, video and long texts" in the plural — a topic is a paragraph,
    then a diagram, then two more paragraphs, then a worked example on video, and a schema
    with one ``body`` and one ``image`` can only ever express the first of those.

    Nothing here is copied into the classroom at release time, unlike the homework brief.
    The student reads it straight off the template through the delivery row, so an admin
    fixing a typo fixes it for every class already reading it — the same rule
    ``ClassroomLesson`` states for content in general.
    """

    lesson = models.OneToOneField(
        JournalLesson, on_delete=models.CASCADE, related_name="roadmap"
    )
    title = models.CharField(max_length=200, blank=True, default="")
    #: One line under the title, telling the student what this reading is for.
    summary = models.CharField(max_length=300, blank=True, default="")
    #: Roughly how long it takes to read. Shown before they start, so the estimate is the
    #: author's own rather than a word count guessed from the body.
    estimated_minutes = models.PositiveSmallIntegerField(default=0)
    #: Whether the student must press "I've finished reading" before the homework opens.
    #:
    #: On by default, because that button is the ONLY signal this feature produces — without
    #: it the roadmap is a page nobody can tell was read, and the homework is one scroll away
    #: whether they read it or not. An author who just wants to attach reading can turn it off.
    require_read_confirmation = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "journals_roadmap"

    def __str__(self) -> str:
        return f"roadmap(lesson={self.lesson_id})"

    @property
    def display_title(self) -> str:
        if self.title.strip():
            return self.title.strip()
        lesson = self.lesson
        return (lesson.title or "").strip() or f"Lesson {lesson.lesson_number}"

    def _section_list(self):
        # `.all()` rather than a filtered query, so a prefetch upstream is actually used.
        return list(self.sections.all())

    @property
    def has_content(self) -> bool:
        return any(s.is_filled for s in self._section_list())

    def validation_reasons(self) -> list[str]:
        """Why this session's roadmap isn't publishable. Empty list = ready.

        An EMPTY roadmap is not a reason. Unlike the homework brief and the in-class plan,
        the roadmap is optional: a session that is pure practice has nothing to read, and
        refusing to publish it until somebody writes an essay would make this feature a tax
        on every existing journal rather than an addition to it. Only a roadmap that has
        been started and left broken is reported.
        """
        sections = self._section_list()
        if not sections:
            return []
        reasons: list[str] = []
        empty = [s for s in sections if not s.is_filled]
        if empty:
            reasons.append(
                f"Roadmap section {empty[0].order + 1} is empty — fill it in or remove it"
            )
        return reasons

    @property
    def is_ready(self) -> bool:
        return not self.validation_reasons()


class JournalRoadmapSection(models.Model):
    """One block of a roadmap: a passage, a picture, or a video."""

    KIND_TEXT = "TEXT"
    KIND_IMAGE = "IMAGE"
    KIND_VIDEO = "VIDEO"
    KIND_CHOICES = [
        (KIND_TEXT, "Text"),
        (KIND_IMAGE, "Image"),
        (KIND_VIDEO, "Video"),
    ]

    roadmap = models.ForeignKey(
        JournalRoadmap, on_delete=models.CASCADE, related_name="sections"
    )
    order = models.PositiveIntegerField(default=0, db_index=True)
    kind = models.CharField(max_length=8, choices=KIND_CHOICES, default=KIND_TEXT)

    #: An optional heading above the block, on any kind.
    heading = models.CharField(max_length=200, blank=True, default="")
    #: TEXT: the passage itself. Plain text with blank lines between paragraphs — NOT html.
    #:
    #: The renderer splits on blank lines and prints the parts as paragraphs. Storing HTML
    #: would put author-supplied markup on a student's page, and this repo already carries a
    #: `SafeHtml` component and a documented set of rules about where that is allowed; a
    #: reading page is not a good place to add another entrance.
    body = models.TextField(blank=True, default="")
    #: IMAGE: the picture, plus the line under it.
    image = models.ImageField(upload_to="journal_roadmap/", null=True, blank=True)
    caption = models.CharField(max_length=300, blank=True, default="")
    #: VIDEO: a link (YouTube and the like) or an uploaded file. Mirrors the lesson-video
    #: pair already on JournalLesson, including the R2 presigned upload for the file half.
    video_url = models.URLField(max_length=500, blank=True, default="")
    video_file = models.FileField(
        upload_to="journal_roadmap_videos/", max_length=500, null=True, blank=True
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "journals_roadmap_section"
        ordering = ["order", "id"]
        indexes = [models.Index(fields=["roadmap", "order"])]

    def __str__(self) -> str:
        return f"roadmap={self.roadmap_id} #{self.order} {self.kind}"

    @property
    def is_filled(self) -> bool:
        """Whether this block has anything for a student to read or watch.

        A heading alone does not count: a section that is only a title renders as a bare
        line with nothing under it, which reads as a page that failed to load.
        """
        if self.kind == self.KIND_TEXT:
            return bool((self.body or "").strip())
        if self.kind == self.KIND_IMAGE:
            return bool(self.image)
        if self.kind == self.KIND_VIDEO:
            return bool((self.video_url or "").strip() or self.video_file)
        return False


class RoadmapRead(models.Model):
    """One student has read one classroom's copy of one session's roadmap.

    Hung off ``ClassroomLesson`` rather than ``JournalRoadmap``, so the mark belongs to the
    student's own delivery of the lesson. A journal is shared by every classroom of its
    (subject, level); marking it read against the template would mean a student in one class
    could unlock the homework for a student in another.

    The row is the whole signal — its existence is "read", and ``read_at`` says when. There
    is no un-read: a student who presses the button and then scrolls back up has still read
    it, and the homework button must not disappear under them.
    """

    classroom_lesson = models.ForeignKey(
        ClassroomLesson, on_delete=models.CASCADE, related_name="roadmap_reads"
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="roadmap_reads"
    )
    read_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "journals_roadmap_read"
        ordering = ["-read_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["classroom_lesson", "student"], name="uniq_roadmap_read_per_student"
            )
        ]
        indexes = [models.Index(fields=["student", "classroom_lesson"])]

    def __str__(self) -> str:
        return f"{self.student_id} read delivery {self.classroom_lesson_id}"
