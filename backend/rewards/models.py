"""Reward ledger — what a student has earned, and the trail of how it changed.

Design note, because it is easy to get backwards: this is **event-sourced**, and it is not
the same thing as ``classes.RankingSnapshot``. That model is a leaderboard cache, re-derived
from scratch every 20 minutes; nothing is ever awarded into it and nothing is ever spent from
it. Reward points are the opposite — written once by a hook at the moment something is earned,
and only ever *read* afterwards. Nothing here may be recomputed from source rows, or a rule
change would silently rewrite history that students have already seen.

Shape mirrors the append-only audit models used across the codebase (``AccessGrantEvent``,
``SubmissionAuditEvent``, ``GovernanceEvent``, ``JournalAuditEvent``) with one difference:
``PointAward`` holds the *current* value of an earning and is upserted, while
``PointAwardAudit`` is the append-only history of every change to it. A re-grade must correct
an award, not stack a second one on top.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from .constants import EVENT_CHOICES


class RewardSeason(models.Model):
    """A scoring period. Closing one and opening the next is how "reset everyone's points"
    is performed — balances read from the current season, and nothing is ever deleted."""

    name = models.CharField(max_length=120)
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    is_current = models.BooleanField(default=False)
    # The conversion rate is a season-level policy, not a global constant: the school can
    # retune it for a new term without restating what coins cost last term.
    points_per_coin = models.PositiveSmallIntegerField(
        default=10, help_text="Points needed to mint one coin."
    )
    note = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "reward_seasons"
        ordering = ["-started_at", "-id"]
        constraints = [
            # Exactly one season can be current. A partial unique index rather than a boolean
            # honour system, because every award resolves its season through this flag.
            models.UniqueConstraint(
                fields=["is_current"],
                condition=models.Q(is_current=True),
                name="uniq_single_current_reward_season",
            )
        ]

    def __str__(self) -> str:
        return f"{self.name}{' (current)' if self.is_current else ''}"


class RewardRule(models.Model):
    """What one event is worth, as data. Lets the school retune without a deploy.

    A missing or inactive row is not an error — the lookup falls back to
    ``constants.DEFAULT_POINTS`` — so adding a new event never breaks awarding.
    """

    event = models.CharField(max_length=40, choices=EVENT_CHOICES, unique=True)
    points = models.IntegerField()
    # Whether this event's points also count as XP. Data rather than a constant because the
    # school reversed the old exclusion list (see ``constants.XP_EXCLUDED_EVENTS``) and will
    # want to reverse parts of it back — SURVEY at 40 points dominates the XP board — without
    # waiting for a deploy. Default True: XP follows points everywhere unless told otherwise.
    grants_xp = models.BooleanField(
        default=True, help_text="Whether this event's points also earn XP."
    )
    is_active = models.BooleanField(default=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "reward_rules"
        ordering = ["event"]

    def __str__(self) -> str:
        return f"{self.event} = {self.points}"


class PointAward(models.Model):
    """One earning. Upserted on ``idempotency_key`` — never inserted twice for one source.

    ``points`` is the *current* value: a re-grade rewrites it in place and a revocation sets
    it to 0. Balance is therefore a plain SUM over this table, and re-running any hook is
    always safe.
    """

    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="point_awards"
    )
    season = models.ForeignKey(RewardSeason, on_delete=models.PROTECT, related_name="awards")
    event = models.CharField(max_length=40, choices=EVENT_CHOICES, db_index=True)
    points = models.IntegerField(default=0)

    # XP rides on the same row rather than in a table of its own, because it is earned by the
    # same events, at the same moment, keyed by the same idempotency key — a parallel ledger
    # would be the same hooks written twice and a second thing to keep in step.
    #
    # It is a HIGH-WATER MARK **while the earning stands**, and that is the entire difference
    # between the two columns. ``points`` is the current truth and moves in both directions.
    # ``xp`` never falls for a *smaller* fact — a re-grade dropping a homework percent, a
    # PRESENT corrected to LATE — because the school's rule is that XP is not taken off a
    # student for doing worse. A *withdrawn* fact is the one exception and takes its XP with
    # it: ``services.revoke`` zeroes both. Without that, one "Mark all present" mis-click
    # would permanently grant XP to a whole roster. See ``services.award`` / ``services.revoke``.
    xp = models.PositiveIntegerField(default=0)

    # Where it happened. Nullable because surveys and midterms belong to no single class —
    # they count toward the student's global balance but not to any one class board.
    classroom = models.ForeignKey(
        "classes.Classroom", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="point_awards",
    )
    # Loose pointer, deliberately not a GenericForeignKey: the sources live in five different
    # apps with unrelated lifecycles, and a hard FK would make deleting any of them cascade
    # into a student's earned history.
    source_type = models.CharField(max_length=40, blank=True)
    source_id = models.PositiveIntegerField(null=True, blank=True)

    idempotency_key = models.CharField(max_length=120, unique=True)

    awarded_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="point_awards_created", help_text="Null for a system award.",
    )
    note = models.CharField(max_length=240, blank=True)

    class Meta:
        db_table = "reward_point_awards"
        ordering = ["-awarded_at", "-id"]
        indexes = [
            models.Index(fields=["student", "season"]),          # balance
            models.Index(fields=["season", "classroom"]),        # per-class board
            models.Index(fields=["student", "-awarded_at"]),     # history feed
            # XP is read across every season at once — it is a lifetime figure, so its
            # aggregate cannot ride the season-scoped index above.
            models.Index(fields=["student", "xp"], name="reward_award_student_xp_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.student_id} {self.event} +{self.points}"


class PointAwardAudit(models.Model):
    """Append-only: one row per *change* in an award's value.

    Written only when the number actually moves, so a backfill command or a duplicate Celery
    delivery leaves no trace — which is what makes those safe to re-run.
    """

    award = models.ForeignKey(PointAward, on_delete=models.CASCADE, related_name="audit_events")
    previous_points = models.IntegerField(null=True, blank=True, help_text="Null on first grant.")
    new_points = models.IntegerField()
    # XP is tracked here too, because the one question the ledger will be asked is "why is my
    # XP higher than my points?" — and without these columns the answer would have to be
    # reconstructed by replaying the rules against the point history.
    previous_xp = models.PositiveIntegerField(null=True, blank=True, help_text="Null on first grant.")
    new_xp = models.PositiveIntegerField(null=True, blank=True)
    reason = models.CharField(max_length=240, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+", help_text="Null for a system change.",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "reward_point_award_audit"
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"award={self.award_id} {self.previous_points}→{self.new_points}"


class StudentWallet(models.Model):
    """A student's spendable coin balance.

    Deliberately GLOBAL, not per season, while points are per season. A season reset zeroes
    the scoreboard — that is what the school asked for — but confiscating coins a student has
    already earned and not yet spent would be taking something off them. Minting is still
    per-season (see ``CoinTransaction.season``), so a reset stops NEW coins from that term's
    points without touching the wallet.

    ``coins_balance`` is a cache of ``sum(CoinTransaction.amount)``. The ledger is the truth;
    this column exists so a balance read is one row instead of an aggregate.
    """

    student = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="coin_wallet"
    )
    coins_balance = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "reward_wallets"

    def __str__(self) -> str:
        return f"{self.student_id}: {self.coins_balance} coins"


class StudentStrike(models.Model):
    """A student's attendance streak — and, separately, what is left of it to spend.

    A strike is earned by turning up: PRESENT or LATE adds one, anything else resets to zero.
    That is the school's rule verbatim, and it is why this is not a second coin wallet. Coins
    accumulate forever; a strike is use-it-or-lose-it, and missing one lesson takes the lot.

    **Two numbers, because one cannot answer both questions.**

    ``current_streak`` is the pure count of consecutive lessons attended, re-derived from the
    register and never touched by spending. It is what the student is shown and what they are
    proud of.

    ``balance`` is what the shop may take. It starts equal to the streak and falls as they
    spend, so buying something does not rewrite the number on their profile — a streak that
    dropped from 12 to 4 because they bought a notebook would be a lie about their attendance.
    Both reset together when a lesson is missed, which is the use-it-or-lose-it part: strikes
    are worth spending precisely because they do not keep.

    ``best_streak`` is a high-water mark, kept for the same reason XP is: a student who broke
    a 30-lesson run should not be left with nothing to show for it.
    """

    student = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="strike_record"
    )
    current_streak = models.PositiveIntegerField(default=0)
    best_streak = models.PositiveIntegerField(default=0)
    spent_in_streak = models.PositiveIntegerField(
        default=0, help_text="Spent since the streak last broke. balance = current_streak - this."
    )
    # The register this was last computed against. Advisory — the recompute reads the whole
    # history — but it makes "why is my strike 3?" answerable without replaying anything.
    last_counted_date = models.DateField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "reward_student_strikes"

    def __str__(self) -> str:
        return f"{self.student_id}: {self.current_streak} strike(s)"

    @property
    def balance(self) -> int:
        """Spendable strikes. Clamped at zero — see ``strikes.recompute`` for how spending
        beyond a shrinking streak is settled."""
        return max(0, int(self.current_streak) - int(self.spent_in_streak))


class StrikeTransaction(models.Model):
    """Append-only: every strike spent, and every reset that wiped some.

    A student who loses nine strikes to one missed lesson will ask what happened, and the
    streak counter alone cannot tell them — it only ever shows the current number. This is the
    record that can.
    """

    KIND_SPEND = "SPEND"
    KIND_RESET = "RESET"           # a missed lesson wiped the streak
    KIND_ADMIN_GRANT = "ADMIN_GRANT"
    KIND_CHOICES = [
        (KIND_SPEND, "Spent"),
        (KIND_RESET, "Reset by a missed lesson"),
        (KIND_ADMIN_GRANT, "Granted by an admin"),
    ]

    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="strike_transactions"
    )
    kind = models.CharField(max_length=14, choices=KIND_CHOICES, db_index=True)
    amount = models.IntegerField(help_text="Signed: negative removes strikes.")
    balance_after = models.IntegerField()
    reference = models.CharField(max_length=240, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+", help_text="Null for an automatic reset.",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "reward_strike_transactions"
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["student", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.student_id} {self.kind} {self.amount:+d}"


class CoinTransaction(models.Model):
    """Append-only. Every coin that appears or disappears leaves a row.

    ``amount`` is signed: minting and grants are positive, spending and revocations negative,
    so the balance is a plain SUM and can always be recomputed from history if the cached
    column is ever doubted.
    """

    KIND_EARN = "EARN"                 # minted from points
    KIND_SPEND = "SPEND"
    KIND_ADMIN_GRANT = "ADMIN_GRANT"
    KIND_ADMIN_REVOKE = "ADMIN_REVOKE"
    KIND_CHOICES = [
        (KIND_EARN, "Earned from points"),
        (KIND_SPEND, "Spent"),
        (KIND_ADMIN_GRANT, "Granted by an admin"),
        (KIND_ADMIN_REVOKE, "Taken back by an admin"),
    ]

    wallet = models.ForeignKey(
        StudentWallet, on_delete=models.CASCADE, related_name="transactions"
    )
    kind = models.CharField(max_length=14, choices=KIND_CHOICES, db_index=True)
    amount = models.IntegerField(help_text="Signed: positive adds coins, negative removes them.")
    balance_after = models.IntegerField()
    # How many points this mint consumed. Only ever set on a KIND_EARN row; a spend or an
    # admin grant costs no points and leaves it 0.
    #
    # The deduction itself is a negative ``PointAward`` (``EVENT_COIN_CONVERSION``) — that is
    # what makes the balance fall, because the balance is a SUM over that table and nothing
    # else. This column is the receipt: it lets the wallet history say "40 points → 4 coins"
    # on the row the student is looking at, without joining back to a point ledger keyed only
    # by an idempotency string.
    points_spent = models.PositiveIntegerField(
        default=0, help_text="Points consumed by this mint. Zero for spends and adjustments."
    )
    # Which season's points minted this. Null for admin adjustments and spends, which belong
    # to no term's arithmetic.
    season = models.ForeignKey(
        RewardSeason, on_delete=models.PROTECT, null=True, blank=True, related_name="coin_mints"
    )
    reference = models.CharField(
        max_length=240, blank=True, help_text="What it was spent on, or why it was adjusted."
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+", help_text="Null for an automatic mint.",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "reward_coin_transactions"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["wallet", "-created_at"]),
            models.Index(fields=["wallet", "kind", "season"]),   # how many minted this season
        ]

    def __str__(self) -> str:
        return f"{self.wallet_id} {self.kind} {self.amount:+d}"
