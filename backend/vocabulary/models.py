from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone

#: The four study games, and the order every "n of 4" reads in. Module-level because BOTH
#: ``VocabWordProgress`` (a word is mastered once it has been answered correctly in every
#: game) and ``VocabStudySession`` (which game a run was) are defined against them, and the
#: session class is declared last.
STUDY_MODE_FLASHCARD = "flashcard"
STUDY_MODE_MATCHING = "matching"
STUDY_MODE_SPEED = "speed"
STUDY_MODE_TEST = "test"
STUDY_MODES: tuple[str, ...] = (
    STUDY_MODE_FLASHCARD,
    STUDY_MODE_MATCHING,
    STUDY_MODE_SPEED,
    STUDY_MODE_TEST,
)
STUDY_MODE_LABELS = {
    STUDY_MODE_FLASHCARD: "Flashcard",
    STUDY_MODE_MATCHING: "Matching",
    STUDY_MODE_SPEED: "Speed",
    STUDY_MODE_TEST: "Test",
}


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
    One row per (user, word). Drives the All / New / Mastered filter.

    **Mastery is per-GAME.** A word is mastered once the student has answered it correctly
    in every one of the four study modes — the per-word form of the rule that masters the
    set itself (all four games played clean). Getting it wrong in a game takes that game
    back off the list, so the word has to be re-earned in the game it was missed in, not
    everywhere.

    This replaces a "three correct in a row" streak, and the middle *Learning* bucket went
    with it. A streak answers "how warm is this word right now", which is a different
    question from "have I proved I know it", and having two competing definitions of
    mastered on one screen — a streak here, a clean sweep on the progress bar — is what
    made the old filter unreadable. Two buckets now: not yet, and proven in all four games.
    """

    STATUS_NEW = "new"
    STATUS_MASTERED = "mastered"
    STATUS_CHOICES = (
        (STATUS_NEW, "New"),
        (STATUS_MASTERED, "Mastered"),
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="vocab_progress",
    )
    word = models.ForeignKey(VocabWord, on_delete=models.CASCADE, related_name="progress_rows")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_NEW, db_index=True)
    correct_count = models.PositiveIntegerField(default=0)
    wrong_count = models.PositiveIntegerField(default=0)
    #: The games this word has been answered correctly in, from :data:`STUDY_MODES`. The
    #: word is mastered once all four are present. A list rather than four booleans so a
    #: fifth game costs no migration — the same reason the homework score divides by the
    #: number of modes the model declares instead of by a literal 4.
    correct_modes = models.JSONField(default=list, blank=True)
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

    #: Written together by record(); handed to save(update_fields=...) by callers.
    RECORD_FIELDS = (
        "status",
        "correct_count",
        "wrong_count",
        "correct_modes",
        "last_reviewed_at",
        "updated_at",
    )

    def record(self, *, correct: bool, mode: str, at=None) -> None:
        """Apply one graded answer from one game. Caller saves.

        ``mode`` is required rather than optional: without it an answer cannot say which
        game it proves, and a caller that forgets it would silently stop the word ever
        reaching mastered.
        """
        self.last_reviewed_at = at or timezone.now()
        earned = [m for m in (self.correct_modes or []) if m in STUDY_MODES]
        if correct:
            self.correct_count += 1
            if mode in STUDY_MODES and mode not in earned:
                earned.append(mode)
        else:
            self.wrong_count += 1
            # Only THIS game is given up. A word missed in Speed has not stopped being
            # known in Flashcards, and wiping the lot would make one slip cost four games.
            earned = [m for m in earned if m != mode]
        # Stored in the canonical game order so two rows that earned the same games compare
        # equal and the column is diffable.
        self.correct_modes = [m for m in STUDY_MODES if m in earned]
        self.status = (
            self.STATUS_MASTERED if len(self.correct_modes) == len(STUDY_MODES) else self.STATUS_NEW
        )


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

    # Kept as class constants for every existing caller (``VocabStudySession.MODE_TEST``);
    # the values live at module level so VocabWordProgress can name the same four games.
    MODE_FLASHCARD = STUDY_MODE_FLASHCARD
    MODE_MATCHING = STUDY_MODE_MATCHING
    MODE_SPEED = STUDY_MODE_SPEED
    MODE_TEST = STUDY_MODE_TEST
    MODE_CHOICES = tuple((m, STUDY_MODE_LABELS[m]) for m in STUDY_MODES)

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
    # How many DISTINCT words of the set this run actually answered. NOT the same number
    # as ``total_count`` in any mode: flashcards re-drill the missed pile into the same
    # run and report every verdict, so a 10-word set can report 18 answers over 10 words.
    distinct_words = models.PositiveIntegerField(default=0)
    # The ids behind ``distinct_words``. A bare counter cannot accumulate a DISTINCT set
    # across flushes: a mode sends only the answers it has not sent yet, and the same word
    # legitimately arrives in two different flushes (that flashcard re-drill), so adding
    # each flush's own distinct count would count it twice and inflate coverage.
    answered_word_ids = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "vocab_study_sessions"
        ordering = ["-started_at", "-id"]
        indexes = [
            # ``mode`` sits between the set and the timestamp because the scoring query is
            # "the FIRST completed session for this (set, mode)" — one lookup per mode, four
            # times per set. Without it the planner reads every mode's sessions for the set
            # and filters; the leading (user, vocab_set) pair still serves the mode-agnostic
            # "has this student completed the set at all" lookup.
            models.Index(fields=["user", "vocab_set", "mode", "completed_at"]),
            models.Index(fields=["user", "-started_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.vocab_set_id}:{self.mode}"

    # Written together by record_batch(); handed to save(update_fields=...) by callers.
    BATCH_FIELDS = ("correct_count", "total_count", "duration_ms", "accuracy")

    def record_batch(self, *, correct: int, total: int, duration_ms: int = 0) -> None:
        """
        Fold one flush of answers into the running totals. Caller saves.

        Counts ACCUMULATE rather than overwrite: a mode flushes the answers it has when
        the student leaves and again when it completes, each flush carrying only what it
        has not sent yet. ``duration_ms`` is a running clock, not a delta, so the largest
        value reported wins.
        """
        self.correct_count += max(0, int(correct))
        self.total_count += max(0, int(total))
        self.duration_ms = max(self.duration_ms, max(0, int(duration_ms)))
        self.accuracy = (
            round((self.correct_count / self.total_count) * 100, 1) if self.total_count else 0.0
        )

    # Written together by record_distinct_words(); the count is derived from the ids, so
    # the two columns cannot drift. Handed to save(update_fields=...) by callers.
    DISTINCT_FIELDS = ("distinct_words", "answered_word_ids")

    def record_distinct_words(self, word_ids) -> None:
        """
        Fold one flush's word ids into the run's distinct set. Caller saves.

        Set-union, not addition, for the same reason :meth:`record_batch` adds: the flushes
        are partial and a word may appear in more than one of them.
        """
        seen = {int(w) for w in (self.answered_word_ids or [])}
        seen.update(int(w) for w in word_ids)
        # Sorted so the column is diffable and two runs that answered the same words in a
        # different order store the same value.
        self.answered_word_ids = sorted(seen)
        self.distinct_words = len(seen)

    def coverage(self, set_size: int) -> float:
        """
        How much of the set this run reached, 0..1.

        Coverage exists because raw ``accuracy`` is not comparable across the four modes
        and is trivially farmable on its own: Speed only ever reports the prompts answered
        before its 60-second clock expires, so answering 2 of 20 words correctly stores
        ``accuracy = 100``. At coverage 0.1 that run is worth 10, which is what it was.

        Capped at 1.0 because a custom set can be edited after a run — ``word_ids``
        REPLACES membership, so a set can shrink below the number of words a past session
        answered, and a shrunken set must not pay more than a complete one.
        """
        if not set_size:
            return 0.0
        return min(1.0, self.distinct_words / set_size)

    def scaled_accuracy(self, set_size: int) -> float:
        """This run's homework percent: ``accuracy`` (0..100) discounted by :meth:`coverage`."""
        return self.accuracy * self.coverage(set_size)

    def is_perfect(self, set_size: int) -> bool:
        """Did this run MASTER its game? Every word in the set answered, none of them wrong.

        Both halves are load-bearing. Without "none wrong" it is not mastery; without
        "every word" it is farmable outright — Speed reports only what was answered before
        its sixty seconds expire, so one correct answer and a expired clock stores
        ``accuracy = 100`` over a single word. Flashcards re-drill what was missed into the
        same run and report every verdict, so a clean sweep there means clean on the FIRST
        pass, which is the bar the word deserves.

        Counted on the raw counters rather than on ``accuracy``: that column is a rounded
        float, and "did the student get everything right" is an equality question about two
        integers, not a comparison against 100.0.
        """
        return (
            self.completed_at is not None
            and self.total_count > 0
            and self.correct_count == self.total_count
            and set_size > 0
            and self.distinct_words >= set_size
        )

    def complete(self, at=None) -> None:
        """
        Mark the run finished. Caller saves.

        Separate from :meth:`record_batch` because a partial flush must record progress
        WITHOUT completing the set — quitting halfway is not "any one mode completed".
        """
        self.completed_at = at or timezone.now()
