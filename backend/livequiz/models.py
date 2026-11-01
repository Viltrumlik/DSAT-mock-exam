"""Live Quiz: one classroom, one code, a frozen paper and a room of players.

Four tables:

    LiveQuizSession      the room — its code, its state, where the clock is
    LiveQuizQuestion     the paper, COPIED at creation (see the class docstring)
    LiveQuizParticipant  one student's place in the room and their running score
    LiveQuizAnswer       one answer, at most one per participant per question

The session row is the single authority for the game. Redis carries the messages, but
nothing is true until it is here.
"""

from __future__ import annotations

import secrets

from django.conf import settings
from django.db import models
from django.db.models import Q

from . import constants as const


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


def generate_join_code() -> str:
    """A fresh code. ``secrets``, not ``random`` — the code is the door to the room."""
    return "".join(secrets.choice(const.JOIN_CODE_ALPHABET) for _ in range(const.JOIN_CODE_LENGTH))


class LiveQuizSession(TimestampedModel):
    """One sitting of a live quiz: a classroom, a code, and a clock the server owns.

    ``current_index`` is -1 until the first question opens, then 0-based into this session's
    own ``questions``. ``question_ends_at`` is the deadline in the only clock that counts —
    the server's. Every late-answer decision reads it, so a client whose clock is wrong, or
    whose user has set it forward on purpose, changes nothing.

    ``version`` exists for compare-and-set transitions (see ``engine_db_guard``). Three
    different things race to close a question — the timer, the last student answering, and
    the host pressing skip — and exactly one of them must win.
    """

    # The paper's source: a word set, or an SAT assessment set — exactly one (see Meta).
    vocab_set = models.ForeignKey(
        "vocabulary.VocabSet",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="live_quiz_sessions",
        help_text="The words this game was built from. PROTECT: a played session must stay readable.",
    )
    assessment_set = models.ForeignKey(
        "assessments.AssessmentSet",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="live_quiz_sessions",
        help_text="The SAT questions this game was copied from.",
    )
    # Required, unlike a mock sitting. The room IS a classroom: only its roster may join.
    classroom = models.ForeignKey(
        "classes.Classroom",
        on_delete=models.CASCADE,
        related_name="live_quiz_sessions",
        db_index=True,
    )
    host = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="hosted_live_quizzes",
    )

    join_code = models.CharField(max_length=const.JOIN_CODE_LENGTH, db_index=True)
    status = models.CharField(
        max_length=20, choices=const.STATUS_CHOICES, default=const.STATUS_LOBBY, db_index=True
    )

    current_index = models.IntegerField(
        default=-1, help_text="0-based index into this session's questions; -1 before the first."
    )
    question_started_at = models.DateTimeField(null=True, blank=True)
    question_ends_at = models.DateTimeField(
        null=True, blank=True, help_text="Server-side deadline for the open question."
    )

    paused_at = models.DateTimeField(null=True, blank=True)
    paused_from = models.CharField(
        max_length=20, blank=True, default="", help_text="Status to restore on resume."
    )

    config = models.JSONField(default=dict, blank=True)

    # Compare-and-set guard. Bumped on every state transition.
    version = models.PositiveIntegerField(default=0)

    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "livequiz_session"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["classroom", "status"]),
            models.Index(fields=["status", "-created_at"]),
        ]
        constraints = [
            # A code is unique only among rooms that are still open. Once a game finishes the
            # code is free again, so the school does not burn through the code space, and
            # yesterday's code cannot be typed into today's room.
            models.UniqueConstraint(
                fields=["join_code"],
                condition=Q(status__in=list(const.LIVE_STATUSES)),
                name="uniq_livequiz_active_join_code",
            ),
            models.CheckConstraint(
                condition=(
                    Q(vocab_set__isnull=False, assessment_set__isnull=True)
                    | Q(vocab_set__isnull=True, assessment_set__isnull=False)
                ),
                name="livequiz_one_source",
            ),
        ]

    def __str__(self) -> str:
        return f"LiveQuizSession #{self.pk} ({self.join_code}, {self.status})"

    # ── Read-only helpers. None of these write; the services layer owns transitions. ──

    @property
    def is_live(self) -> bool:
        return self.status in const.LIVE_STATUSES

    @property
    def is_over(self) -> bool:
        return self.status in const.TERMINAL_STATUSES

    def setting(self, key: str):
        """A config value, falling back to the shipped default for anything absent."""
        cfg = self.config if isinstance(self.config, dict) else {}
        if key in cfg:
            return cfg[key]
        return const.CONFIG_DEFAULTS.get(key)

    def current_question(self):
        if self.current_index < 0:
            return None
        return self.questions.filter(order=self.current_index).first()


class LiveQuizQuestion(TimestampedModel):
    """A question as it was when the game started — text, choices and answer key.

    A vocabulary set holds words, not questions, so these are GENERATED when the room is
    created (``question_builder``) and then frozen. Generating them once is what makes a
    game reviewable: the wrong options were chosen at random, and without storing them
    nobody could ever see the question a student actually answered. It also means an editor
    fixing a definition mid-game cannot change the question on screen.

    ``source_word`` is a soft link kept for reporting. It goes NULL if the word is deleted
    and nothing here changes.
    """

    session = models.ForeignKey(LiveQuizSession, on_delete=models.CASCADE, related_name="questions")
    order = models.PositiveIntegerField(help_text="0-based position in this session.")

    source_word = models.ForeignKey(
        "vocabulary.VocabWord",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="live_quiz_questions",
    )

    # An SAT room's question remembers the assessment question it was copied from (for the
    # report), and the image files it showed — names, not copies: an image is not edited in
    # place, it is replaced, so a name keeps pointing at what was shown.
    source_question = models.ForeignKey(
        "assessments.AssessmentQuestion",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="live_quiz_copies",
    )
    image_paths = models.JSONField(default=dict, blank=True)

    # Which way round this one was asked — see question_builder.FORMS. Kept so a review
    # screen can say "you were shown the definition" rather than leaving it to be guessed.
    form = models.CharField(max_length=32, blank=True, default="")

    prompt = models.TextField()
    question_prompt = models.TextField(blank=True, default="")
    question_type = models.CharField(max_length=32)
    choices = models.JSONField(default=list, blank=True)
    correct_answer = models.JSONField(default=None, null=True, blank=True)
    grading_config = models.JSONField(default=dict, blank=True)
    points = models.PositiveIntegerField(default=1)
    explanation = models.TextField(blank=True, default="")

    time_limit_seconds = models.PositiveIntegerField(default=const.CONFIG_DEFAULTS["question_seconds"])

    class Meta:
        db_table = "livequiz_question"
        ordering = ["session_id", "order"]
        constraints = [
            models.UniqueConstraint(fields=["session", "order"], name="uniq_livequiz_question_order"),
        ]

    def __str__(self) -> str:
        return f"LiveQuizQuestion #{self.pk} (session {self.session_id}, #{self.order})"


class LiveQuizParticipant(TimestampedModel):
    """One student in one room, with their running total.

    The score fields are a running tally maintained as answers land, not a derived value
    recomputed on read: the leaderboard is pushed to thirty phones between questions and
    re-aggregating every answer each time is the kind of thing that looks fine with four
    testers and falls over with a real class.

    ``connections`` counts open sockets, not people — a student with the page open on a
    phone and a laptop is one participant. They have left when it reaches zero.
    """

    session = models.ForeignKey(LiveQuizSession, on_delete=models.CASCADE, related_name="participants")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="live_quiz_participations"
    )
    display_name = models.CharField(max_length=120)

    status = models.CharField(
        max_length=16,
        choices=const.PARTICIPANT_STATUS_CHOICES,
        default=const.PARTICIPANT_JOINED,
        db_index=True,
    )
    connections = models.PositiveIntegerField(default=0)

    joined_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now_add=True)

    score = models.IntegerField(default=0)
    correct_count = models.PositiveIntegerField(default=0)
    answered_count = models.PositiveIntegerField(default=0)
    rank = models.PositiveIntegerField(null=True, blank=True, help_text="Final placing, set at finish.")

    # Right answers in a row. Both modes keep it; a wrong answer or a missed question resets
    # it unless a streak saver was armed.
    streak = models.PositiveIntegerField(default=0)
    best_streak = models.PositiveIntegerField(default=0)

    # ── Student-paced only. In a teacher-paced game the session's own pointer is the clock. ──
    #
    # Each student walks their own sequence: ``question_order`` holds the session question
    # ``order`` values in the order THIS student meets them (shuffled per student when the
    # host asked for it), ``position`` is how many of them are behind them. The deadline is
    # theirs alone and, like the session's, it is the only clock that counts.
    question_order = models.JSONField(default=list, blank=True)
    position = models.PositiveIntegerField(default=0)
    question_started_at = models.DateTimeField(null=True, blank=True)
    question_ends_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(
        null=True, blank=True, help_text="Student-paced: when they answered their last question."
    )
    # Second chance: the position at which the missed questions brought back at the end begin.
    # None until the paper is done and something was missed; a question at or past it is a
    # second try, scored by its own rules (``paced``).
    redemption_from = models.PositiveIntegerField(null=True, blank=True)

    # Power-ups held (a list of keys, duplicates allowed) and the ones armed for the question
    # in front of them — see ``powerups``.
    powerups = models.JSONField(default=list, blank=True)
    armed = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "livequiz_participant"
        ordering = ["-score", "joined_at"]
        indexes = [models.Index(fields=["session", "-score"])]
        constraints = [
            models.UniqueConstraint(fields=["session", "user"], name="uniq_livequiz_participant"),
        ]

    def __str__(self) -> str:
        return f"{self.display_name} in session {self.session_id}"

    @property
    def is_present(self) -> bool:
        return self.status == const.PARTICIPANT_JOINED and self.connections > 0


class LiveQuizAnswer(TimestampedModel):
    """One answer. The unique constraint is the rule, not a view's if-statement.

    "A participant may not submit two valid answers to the same question" is enforced by the
    database. When answer changes are configured on, the row is updated in place rather than
    a second one being written, so the constraint holds either way and there is never a
    second opinion about what somebody answered.
    """

    # Denormalised from participant.session so per-session stats do not need the join.
    session = models.ForeignKey(LiveQuizSession, on_delete=models.CASCADE, related_name="answers")
    participant = models.ForeignKey(
        LiveQuizParticipant, on_delete=models.CASCADE, related_name="answers"
    )
    question = models.ForeignKey(LiveQuizQuestion, on_delete=models.CASCADE, related_name="answers")

    answer = models.JSONField(null=True, blank=True)
    is_correct = models.BooleanField(default=False)
    response_time_ms = models.PositiveIntegerField(
        default=0, help_text="From the question opening to the answer landing, server-measured."
    )
    points_awarded = models.IntegerField(default=0)
    submitted_at = models.DateTimeField(auto_now_add=True)

    # Student-paced: the clock ran out before they answered. The row is still written, so a
    # missed question is a fact in the report rather than a gap, but it is not an answer —
    # tallies leave it out of "answered".
    timed_out = models.BooleanField(default=False)
    powerups_used = models.JSONField(default=list, blank=True)
    # Second chance: None if the question never came back; True/False for how the retry went.
    # A right retry also turns ``is_correct`` on, so the paper reads as right from then on.
    second_try_correct = models.BooleanField(null=True, blank=True)

    class Meta:
        db_table = "livequiz_answer"
        ordering = ["question_id", "submitted_at"]
        indexes = [models.Index(fields=["session", "question"])]
        constraints = [
            models.UniqueConstraint(
                fields=["participant", "question"], name="uniq_livequiz_answer_per_question"
            ),
        ]

    def __str__(self) -> str:
        return f"Answer p{self.participant_id} q{self.question_id} ({'correct' if self.is_correct else 'wrong'})"


# ─── Gems: the Live Quiz's own currency, and the avatars it buys ─────────────────
#
# Kept apart from the school's coins on purpose: coins are worth money (1 coin = 1,000 so'm)
# and a live game is easy to replay, so a game must never be a way to mint them. Gems buy
# avatars and nothing else, and cannot be converted or passed on.


def _today():
    from django.utils import timezone

    return timezone.localdate()


class GemWallet(models.Model):
    """A student's gem balance. ``balance`` caches ``sum(GemTransaction.amount)``; the ledger
    is the truth and the column exists so a balance read is one row."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="gem_wallet"
    )
    balance = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "livequiz_gem_wallet"

    def __str__(self) -> str:
        return f"{self.user_id}: {self.balance} gems"


class GemTransaction(models.Model):
    """One movement of gems. Never edited, never deleted: a correction is a new ADJUST row."""

    KIND_EARN = "EARN"
    KIND_SPEND = "SPEND"
    KIND_ADJUST = "ADJUST"
    KIND_CHOICES = [
        (KIND_EARN, "Earned in a game"),
        (KIND_SPEND, "Spent in the shop"),
        (KIND_ADJUST, "Adjusted by staff"),
    ]

    wallet = models.ForeignKey(GemWallet, on_delete=models.CASCADE, related_name="transactions")
    kind = models.CharField(max_length=8, choices=KIND_CHOICES, db_index=True)
    amount = models.IntegerField()
    balance_after = models.IntegerField()
    session = models.ForeignKey(
        LiveQuizSession,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="gem_transactions",
    )
    item_key = models.CharField(max_length=64, blank=True, default="")
    # The Tashkent day it counts toward, for the daily earning cap.
    day = models.DateField(default=_today, db_index=True)
    # EARN: how the amount was made up — {"correct", "finish", "podium", "total", "capped"}.
    detail = models.JSONField(default=dict, blank=True)
    note = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "livequiz_gem_transaction"
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["wallet", "kind", "day"])]
        constraints = [
            # A game pays a student once, whatever calls the payout twice.
            models.UniqueConstraint(
                fields=["wallet", "session"],
                condition=Q(kind="EARN"),
                name="uniq_gem_earn_per_game",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.wallet_id} {self.kind} {self.amount:+d}"


class OwnedAvatarItem(models.Model):
    """An avatar item a student owns — see ``avatars`` for the keys."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="avatar_items"
    )
    item_key = models.CharField(max_length=64)
    acquired_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "livequiz_owned_avatar_item"
        constraints = [
            models.UniqueConstraint(fields=["user", "item_key"], name="uniq_owned_avatar_item"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} owns {self.item_key}"


class AvatarLook(models.Model):
    """What a student is wearing: a character, and optionally one of its skins."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="live_avatar_look"
    )
    character = models.CharField(max_length=32)
    skin = models.CharField(max_length=16, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "livequiz_avatar_look"

    def __str__(self) -> str:
        return f"{self.user_id} wears {self.character}{':' + self.skin if self.skin else ''}"

    def as_wire(self) -> dict:
        return {"character": self.character, "skin": self.skin or None}
