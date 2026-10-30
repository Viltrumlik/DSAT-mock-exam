"""What we know about lc-up, and how it maps onto our records.

lc-up is the master for groups and their members (the owner's decision), so these tables hold
lc-up's ids next to ours: a *link* row per lc-up filial, teacher, student and group, plus the
membership lc-up last reported. The sync (``sync.py``) fills them; the admin reviews whatever
could not be linked automatically in ``/ops/lcup``.

``AccountClaim`` belongs to the accounts the sync creates for students who had none: the first
sign-in is phone + its last four digits (``auth_backend``), and the claim is what limits that.
"""

from django.conf import settings
from django.db import models, transaction
from django.db.models import F
from django.utils import timezone

#: Wrong codes before a claim locks. The admin unlocks it by reissuing.
MAX_CLAIM_FAILURES = 5


class LinkStatus(models.TextChoices):
    UNMATCHED = "unmatched", "Unmatched"
    AUTO = "auto", "Auto-linked"
    NEEDS_REVIEW = "needs_review", "Needs review"
    CONFIRMED = "confirmed", "Confirmed"
    CREATED = "created", "Account created"
    IGNORED = "ignored", "Ignored"


class GroupLinkStatus(models.TextChoices):
    SUGGESTED = "suggested", "Suggested"
    NEEDS_TEACHER = "needs_teacher", "Needs a linked teacher"
    CONFIRMED = "confirmed", "Confirmed"
    IGNORED = "ignored", "Ignored"


class LcupState(models.Model):
    """One row. ``initial_review_done_at`` is the gate on creating accounts: until the admin has
    linked everyone who already has an account, a new one would be a duplicate."""

    initial_review_done_at = models.DateTimeField(null=True, blank=True)
    initial_review_done_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    #: When lc-up's whole payment history was first copied in (``finance.sync_payments``). Until
    #: then a run reads every month since the earliest course; afterwards only the last few days.
    payments_backfilled_at = models.DateTimeField(null=True, blank=True)

    @classmethod
    def get(cls) -> "LcupState":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class LcupFilialLink(models.Model):
    lcup_filial_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=200)
    branch = models.ForeignKey(
        "classes.Branch", null=True, blank=True, on_delete=models.SET_NULL, related_name="lcup_filials"
    )
    last_seen_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return self.name


class LcupTeacherLink(models.Model):
    lcup_teacher_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True, default="", db_index=True)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="lcup_teacher_link"
    )
    status = models.CharField(max_length=16, choices=LinkStatus.choices, default=LinkStatus.UNMATCHED, db_index=True)
    candidates = models.JSONField(default=list, blank=True)
    match_reason = models.CharField(max_length=200, blank=True, default="")
    deleted_in_lcup = models.BooleanField(default=False)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return self.name


class LcupStudentLink(models.Model):
    lcup_student_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True, default="", db_index=True)
    lcup_filial_id = models.PositiveIntegerField(null=True, blank=True)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="lcup_student_link"
    )
    status = models.CharField(max_length=16, choices=LinkStatus.choices, default=LinkStatus.UNMATCHED, db_index=True)
    candidates = models.JSONField(default=list, blank=True)
    match_reason = models.CharField(max_length=200, blank=True, default="")
    deleted_in_lcup = models.BooleanField(default=False)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    #: lc-up's balance as last seen; negative means the student owes the center. None = unknown
    #: (never seen, or lc-up sent something that is not a number), never mistaken for 0.
    balance = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    balance_seen_at = models.DateTimeField(null=True, blank=True)
    #: Set by an admin (a grant, an agreement): the debt freeze never applies to this student.
    debt_freeze_exempt_at = models.DateTimeField(null=True, blank=True)
    debt_freeze_exempt_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    def __str__(self) -> str:
        return self.name


class LcupGroupLink(models.Model):
    lcup_group_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=200)
    #: The whole lc-up group row as last fetched (course, days, times, teachers, filial…).
    snapshot = models.JSONField(default=dict, blank=True)
    classroom = models.OneToOneField(
        "classes.Classroom", null=True, blank=True, on_delete=models.SET_NULL, related_name="lcup_group_link"
    )
    status = models.CharField(
        max_length=16, choices=GroupLinkStatus.choices, default=GroupLinkStatus.SUGGESTED, db_index=True
    )
    suggestion = models.ForeignKey(
        "classes.Classroom", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    suggestion_score = models.FloatField(default=0)
    suggestion_reasons = models.JSONField(default=list, blank=True)
    deleted_in_lcup_at = models.DateTimeField(null=True, blank=True)
    #: When the sync archived ``classroom`` because lc-up deleted the group. A restore in lc-up
    #: reopens only a class archived this way — never one an admin had archived already.
    class_archived_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return self.name


class LcupMembership(models.Model):
    """Who lc-up says is in a group. ``left_at`` set means they have left it."""

    group = models.ForeignKey(LcupGroupLink, on_delete=models.CASCADE, related_name="memberships")
    student = models.ForeignKey(LcupStudentLink, on_delete=models.CASCADE, related_name="memberships")
    lcup_status = models.CharField(max_length=10)  # active | trial | frozen
    start_date = models.DateField(null=True, blank=True)
    joined_at = models.DateTimeField(null=True, blank=True)
    left_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["group", "student"], name="lcup_membership_unique")]


class LcupAbsenceReason(models.Model):
    """lc-up's reasons for an excused absence ("Kasal", …), synced each run. An EXCUSED mark in a
    paired class names one of these; lc-up receives it as ``reason_id`` on an ``absent``."""

    lcup_reason_id = models.PositiveIntegerField(unique=True)
    title = models.CharField(max_length=120)
    color = models.CharField(max_length=20, blank=True, default="")
    last_seen_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["lcup_reason_id"]

    def __str__(self) -> str:
        return self.title


class LcupAttendancePush(models.Model):
    """One ``POST /attendance`` for one lc-up group and day — the outbox and its audit trail.

    Unique per (group, date): lc-up charges the fee for what it receives, and the owner's rule is
    one push per register, sent when it closes. ``failed`` is a transient error and is retried on
    later runs; ``refused`` (lc-up's window was closed) and ``sent`` are final."""

    STATE_SENT = "sent"
    STATE_FAILED = "failed"
    STATE_REFUSED = "refused"
    STATE_CHOICES = [(STATE_SENT, "Sent"), (STATE_FAILED, "Failed"), (STATE_REFUSED, "Refused")]

    group = models.ForeignKey(LcupGroupLink, on_delete=models.CASCADE, related_name="attendance_pushes")
    date = models.DateField()
    state = models.CharField(max_length=10, choices=STATE_CHOICES, default=STATE_FAILED, db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    #: What was sent: [{user_id, student_id, status, reason_id?}].
    records = models.JSONField(default=list, blank=True)
    #: lc-up's own summary: {saved, deleted, unchanged, failed}.
    summary = models.JSONField(default=dict, blank=True)
    #: The students lc-up did not take: [{user_id, student_id, code, message}].
    failures = models.JSONField(default=list, blank=True)
    error = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-date", "-id"]
        constraints = [models.UniqueConstraint(fields=["group", "date"], name="lcup_attendance_push_once")]

    def __str__(self) -> str:
        return f"{self.group_id} {self.date} {self.state}"


class AccountClaim(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="lcup_claim")
    phone = models.CharField(max_length=20, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    locked_at = models.DateTimeField(null=True, blank=True)
    first_login_at = models.DateTimeField(null=True, blank=True)
    password_set_at = models.DateTimeField(null=True, blank=True)
    reissued_count = models.PositiveSmallIntegerField(default=0)

    def can_attempt(self, now) -> bool:
        return self.password_set_at is None and self.locked_at is None and self.expires_at > now

    def record_failure(self, now) -> None:
        # F() so two wrong codes typed at once both count — a read-modify-write would lose one.
        with transaction.atomic():
            AccountClaim.objects.filter(pk=self.pk).update(failed_attempts=F("failed_attempts") + 1)
            self.refresh_from_db(fields=["failed_attempts"])
            if self.failed_attempts >= MAX_CLAIM_FAILURES and self.locked_at is None:
                self.locked_at = now
                self.save(update_fields=["locked_at"])

    def record_success(self, now) -> None:
        updates = {"failed_attempts": 0}
        if self.first_login_at is None:
            updates["first_login_at"] = now
        AccountClaim.objects.filter(pk=self.pk).update(**updates)
        for field, value in updates.items():
            setattr(self, field, value)


class LcupPhonePrompt(models.Model):
    """One of a student's same-name accounts, asked for the phone the student gave the centre.

    Some students have two or three accounts here and the sync linked the one they do not use. The
    owner's fix (2026-10-14): ask each such account, and the one the number is typed on becomes the
    linked one (``phone_confirm``). Once any account of the student answers, the others' prompts are
    superseded — the form goes from all of them.
    """

    PENDING = "pending"
    CONFIRMED = "confirmed"
    NOT_ME = "not_me"
    SUPERSEDED = "superseded"
    STATES = [
        (PENDING, "Waiting for the phone"),
        (CONFIRMED, "Confirmed on this account"),
        (NOT_ME, "Another person of the same name"),
        (SUPERSEDED, "Settled on another account"),
    ]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="lcup_phone_prompt")
    student = models.ForeignKey(LcupStudentLink, on_delete=models.CASCADE, related_name="phone_prompts")
    state = models.CharField(max_length=12, choices=STATES, default=PENDING, db_index=True)
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return f"{self.user_id} {self.state}"


class LcupPayment(models.Model):
    """A payment (or refund) as lc-up records it. lc-up is the ledger; this copy is what the student's
    Payments page and /ops/finance read, refreshed by every sync (``finance.sync_payments``)."""

    lcup_payment_id = models.PositiveIntegerField(unique=True)
    student = models.ForeignKey(
        LcupStudentLink, null=True, blank=True, on_delete=models.SET_NULL, related_name="payments"
    )
    lcup_student_id = models.PositiveIntegerField(db_index=True)
    group = models.ForeignKey(LcupGroupLink, null=True, blank=True, on_delete=models.SET_NULL, related_name="payments")
    lcup_group_id = models.PositiveIntegerField(null=True, blank=True)
    #: lc-up's ``type``: payment | refund | extra.
    kind = models.CharField(max_length=16)
    #: In so'm, as lc-up gives it (always positive; ``kind`` says which way it went).
    amount = models.BigIntegerField()
    method = models.CharField(max_length=60, blank=True, default="")
    paid_on = models.DateField(db_index=True)
    #: The month it pays for, "YYYY-MM".
    month = models.CharField(max_length=7, blank=True, default="", db_index=True)
    note = models.CharField(max_length=300, blank=True, default="")
    created_in_lcup = models.DateTimeField(null=True, blank=True)
    synced_at = models.DateTimeField()
    #: When the class bot told the student about this payment, or found it could not (no
    #: Telegram on the account) — plan 2026-10-16. Null = not yet. Set once, so a payment that
    #: every sync re-reads is announced once.
    bot_notified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-paid_on", "-lcup_payment_id"]

    def __str__(self) -> str:
        return f"{self.lcup_payment_id} {self.kind} {self.amount}"


class LcupSyncRun(models.Model):
    # Not auto_now_add: a dry run's row is written after its rolled-back transaction, and must
    # still say when the run began.
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    dry_run = models.BooleanField(default=False)
    ok = models.BooleanField(default=False)
    counts = models.JSONField(default=dict, blank=True)
    errors = models.JSONField(default=list, blank=True)
    alerts = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-started_at"]


from .models_archive import (  # noqa: E402,F401
    ArchiveEntity,
    LcupArchiveMark,
    LcupArchiveRecord,
    LcupArchiveRun,
    LcupArchiveVersion,
)
