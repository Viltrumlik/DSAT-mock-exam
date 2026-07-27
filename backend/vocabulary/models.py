from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone


class VocabSection(models.Model):
    """
    A named vocabulary collection authored in the builder — "College Panda",
    "SAT Tashkent", "650 Hard Words". Sections hold sets; sets hold 25 words.
    """

    title = models.CharField(max_length=200, db_index=True)
    slug = models.SlugField(max_length=220, unique=True)
    description = models.TextField(blank=True, default="")
    order = models.PositiveIntegerField(default=0, db_index=True)
    is_published = models.BooleanField(default=True, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="vocab_sections_created",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "vocab_sections"
        ordering = ["order", "title", "id"]

    def __str__(self) -> str:
        return self.title


class VocabWord(models.Model):
    """
    One bank word. Words are scoped to their section so two sections may teach
    the same headword with different wording without colliding.
    """

    PART_NOUN = "noun"
    PART_VERB = "verb"
    PART_ADJECTIVE = "adjective"
    PART_ADVERB = "adverb"
    PART_PRONOUN = "pronoun"
    PART_PREPOSITION = "preposition"
    PART_CONJUNCTION = "conjunction"
    PART_INTERJECTION = "interjection"
    PART_OTHER = "other"

    PART_CHOICES = (
        (PART_NOUN, "Noun"),
        (PART_VERB, "Verb"),
        (PART_ADJECTIVE, "Adjective"),
        (PART_ADVERB, "Adverb"),
        (PART_PRONOUN, "Pronoun"),
        (PART_PREPOSITION, "Preposition"),
        (PART_CONJUNCTION, "Conjunction"),
        (PART_INTERJECTION, "Interjection"),
        (PART_OTHER, "Other"),
    )

    section = models.ForeignKey(
        VocabSection,
        on_delete=models.CASCADE,
        related_name="words",
    )
    word = models.CharField(max_length=120, db_index=True)
    definition = models.TextField()
    part_of_speech = models.CharField(max_length=24, choices=PART_CHOICES, default=PART_OTHER)
    example = models.TextField(blank=True, default="")
    synonyms = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "vocab_bank_words"
        ordering = ["word", "id"]
        constraints = [
            models.UniqueConstraint(fields=["section", "word"], name="uniq_vocab_word_per_section"),
        ]
        indexes = [
            models.Index(fields=["section", "word"]),
        ]

    def __str__(self) -> str:
        return self.word


class VocabSet(models.Model):
    """
    A study set of (nominally) 25 words. Exactly one of ``section`` / ``owner``
    is set: a *bank* set belongs to a builder section, a *custom* set belongs to
    the student who built it. Both are studied through the identical machinery.
    """

    TARGET_WORD_COUNT = 25

    section = models.ForeignKey(
        VocabSection,
        on_delete=models.CASCADE,
        related_name="sets",
        null=True,
        blank=True,
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="vocab_custom_sets",
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=200)
    order = models.PositiveIntegerField(default=0, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "vocab_sets"
        ordering = ["order", "id"]
        constraints = [
            models.CheckConstraint(
                # A set is either a bank set (section) or a student set (owner) — never both, never neither.
                condition=(
                    models.Q(section__isnull=False, owner__isnull=True)
                    | models.Q(section__isnull=True, owner__isnull=False)
                ),
                name="vocab_set_bank_xor_custom",
            ),
        ]
        indexes = [
            models.Index(fields=["owner", "-created_at"]),
        ]

    def __str__(self) -> str:
        return self.title

    @property
    def is_custom(self) -> bool:
        return self.owner_id is not None

    def is_completed_by(self, user) -> bool:
        """A set counts as done once the student finishes ANY one study mode."""
        return self.sessions.filter(user=user, completed_at__isnull=False).exists()


class VocabSetItem(models.Model):
    vocab_set = models.ForeignKey(VocabSet, on_delete=models.CASCADE, related_name="items")
    word = models.ForeignKey(VocabWord, on_delete=models.CASCADE, related_name="set_items")
    order = models.PositiveIntegerField(default=0, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "vocab_set_items"
        ordering = ["order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["vocab_set", "word"], name="uniq_vocab_set_word"),
        ]

    def __str__(self) -> str:
        return f"{self.vocab_set_id}:{self.word_id}"


class VocabWordProgress(models.Model):
    """
    One row per (user, word). Drives the All / New / Learning / Mastered filter.

    Mastery is streak-based on purpose: the previous generation gated mastery on
    a cumulative ``wrong_count`` that only ever grew, so a word could become
    permanently unmasterable. Here any wrong answer resets the streak and demotes
    to Learning, and three consecutive correct answers master it again.
    """

    STATUS_NEW = "new"
    STATUS_LEARNING = "learning"
    STATUS_MASTERED = "mastered"
    STATUS_CHOICES = (
        (STATUS_NEW, "New"),
        (STATUS_LEARNING, "Learning"),
        (STATUS_MASTERED, "Mastered"),
    )

    MASTERY_STREAK = 3

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="vocab_progress",
    )
    word = models.ForeignKey(VocabWord, on_delete=models.CASCADE, related_name="progress_rows")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_NEW, db_index=True)
    correct_count = models.PositiveIntegerField(default=0)
    wrong_count = models.PositiveIntegerField(default=0)
    streak = models.PositiveIntegerField(default=0)
    last_reviewed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "vocab_progress"
        constraints = [
            models.UniqueConstraint(fields=["user", "word"], name="uniq_vocab_progress_user_word"),
        ]
        indexes = [
            models.Index(fields=["user", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.word_id} ({self.status})"

    def record(self, *, correct: bool, at=None) -> None:
        """Apply one graded answer. Caller saves."""
        self.last_reviewed_at = at or timezone.now()
        if correct:
            self.correct_count += 1
            self.streak += 1
            self.status = (
                self.STATUS_MASTERED if self.streak >= self.MASTERY_STREAK else self.STATUS_LEARNING
            )
        else:
            self.wrong_count += 1
            self.streak = 0
            self.status = self.STATUS_LEARNING


class VocabHomework(models.Model):
    """
    Link row: one assigned bank set on one classroom Assignment. A homework may
    carry several sets, so this is a plain FK to the Assignment (the same shape
    ``assessments.HomeworkAssignment`` uses).

    Uniqueness is per-assignment, NOT per-classroom, so the same set can be
    assigned again in a later lesson for revision.
    """

    classroom = models.ForeignKey(
        "classes.Classroom",
        on_delete=models.CASCADE,
        related_name="vocab_homework",
    )
    assignment = models.ForeignKey(
        "classes.Assignment",
        on_delete=models.CASCADE,
        related_name="vocab_homeworks",
    )
    vocab_set = models.ForeignKey(VocabSet, on_delete=models.PROTECT, related_name="homework_links")
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="vocab_homework_assigned",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "vocab_homeworks"
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["assignment", "vocab_set"], name="uniq_vocab_hw_assignment_set"),
        ]
        indexes = [
            models.Index(fields=["classroom", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"assignment={self.assignment_id} set={self.vocab_set_id}"


class VocabStudySession(models.Model):
    """
    One run of one study mode over one set. ``homework`` is nullable because
    self-study on a bank set or on a student's own custom set is not homework.
    """

    MODE_FLASHCARD = "flashcard"
    MODE_MATCHING = "matching"
    MODE_SPEED = "speed"
    MODE_TEST = "test"
    MODE_CHOICES = (
        (MODE_FLASHCARD, "Flashcard"),
        (MODE_MATCHING, "Matching"),
        (MODE_SPEED, "Speed"),
        (MODE_TEST, "Test"),
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="vocab_sessions",
    )
    vocab_set = models.ForeignKey(VocabSet, on_delete=models.CASCADE, related_name="sessions")
    mode = models.CharField(max_length=16, choices=MODE_CHOICES, db_index=True)
    homework = models.ForeignKey(
        VocabHomework,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sessions",
    )
    started_at = models.DateTimeField(auto_now_add=True, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    duration_ms = models.PositiveIntegerField(default=0)
    correct_count = models.PositiveIntegerField(default=0)
    total_count = models.PositiveIntegerField(default=0)
    accuracy = models.FloatField(default=0.0)

    class Meta:
        db_table = "vocab_study_sessions"
        ordering = ["-started_at", "-id"]
        indexes = [
            models.Index(fields=["user", "vocab_set", "completed_at"]),
            models.Index(fields=["user", "-started_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.vocab_set_id}:{self.mode}"

    def finish(self, *, correct: int, total: int, duration_ms: int, at=None) -> None:
        """Caller saves."""
        self.completed_at = at or timezone.now()
        self.correct_count = max(0, int(correct))
        self.total_count = max(0, int(total))
        self.duration_ms = max(0, int(duration_ms))
        self.accuracy = round((self.correct_count / self.total_count) * 100, 1) if self.total_count else 0.0
