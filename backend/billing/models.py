"""The ledger's tables. Money is in whole so'm; below zero, the student owes the centre."""

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class Account(models.Model):
    """One student's money. Not a user: most former students who owe or are owed have no platform account."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="billing_account"
    )
    lcup_student_id = models.PositiveIntegerField(null=True, blank=True, unique=True)
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return self.name


class SeatState(models.TextChoices):
    ACTIVE = "active", "Active"
    TRIAL = "trial", "Trial"
    FROZEN = "frozen", "Frozen"
    LEFT = "left", "Left"


class Seat(models.Model):
    """One student's place in one group. Price and weekdays are read when a row is written; rows already
    written keep what they were."""

    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="seats")
    group_name = models.CharField(max_length=200)
    lcup_group_id = models.PositiveIntegerField(null=True, blank=True)
    #: The class of ours this seat is in. ``shadow`` keeps it from the paired group until lc-up goes; after that a
    #: seat is found by account and class. Deleting a class leaves the seat, whose money still stands.
    classroom = models.ForeignKey(
        "classes.Classroom", null=True, blank=True, on_delete=models.SET_NULL, related_name="billing_seats"
    )
    price = models.PositiveIntegerField(default=0)
    #: A price agreed for this student alone, which replaces the group's; 0 is a grant. lc-up's API does not
    #: give these, so an admin enters them (``ledger.set_personal_price``).
    personal_price = models.PositiveIntegerField(null=True, blank=True)
    days = models.JSONField(default=list, blank=True)
    state = models.CharField(max_length=10, choices=SeatState.choices)
    #: lc-up's own dates as last seen, so a later change to either is noticed.
    lcup_start_date = models.DateField(null=True, blank=True)
    lcup_left_on = models.DateField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["account", "lcup_group_id"], name="billing_seat_unique"),
            models.UniqueConstraint(
                fields=["account", "classroom"], condition=Q(classroom__isnull=False), name="billing_seat_one_per_class"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.account} in {self.group_name}"

    @property
    def charge_price(self) -> int:
        return self.price if self.personal_price is None else self.personal_price


class SeatPriceChange(models.Model):
    """Who changed a personal price, when and why. A discount moves money as surely as a payment does."""

    seat = models.ForeignKey(Seat, on_delete=models.PROTECT, related_name="price_changes")
    old_price = models.PositiveIntegerField(null=True, blank=True)
    new_price = models.PositiveIntegerField(null=True, blank=True)
    reason = models.CharField(max_length=300)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    changed_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-changed_at", "-id"]


class EndReason(models.TextChoices):
    LEAVE = "leave", "Left the group"
    FREEZE = "freeze", "Frozen"
    #: Ended the day before the seat began to pay per lesson (``billing_lessons_switch``); it goes on as a new span.
    SWITCH = "switch", "Moved to pay per lesson"


class SpanRule(models.TextChoices):
    """How a span is billed (owner, 2026-11-22): the month's price on each 1st, or each lesson from a balance."""

    MONTH = "month", "Monthly"
    LESSON = "lesson", "Per lesson"


class Span(models.Model):
    """A stretch of days a seat is paid for: from joining or coming back, until leaving or being frozen."""

    seat = models.ForeignKey(Seat, on_delete=models.PROTECT, related_name="spans")
    start = models.DateField()
    end = models.DateField(null=True, blank=True)
    ended_by = models.CharField(max_length=10, choices=EndReason.choices, blank=True, default="")
    #: "YYYY-MM": the charge of this month and earlier is already inside the opening balance. Empty for a
    #: span that began after the ledger opened.
    opening_month = models.CharField(max_length=7, blank=True, default="")
    #: Fixed when the span starts: a span never changes rule, it ends and a new one starts (``EndReason.SWITCH``).
    rule = models.CharField(max_length=10, choices=SpanRule.choices, default=SpanRule.MONTH, db_default=SpanRule.MONTH)

    def __str__(self) -> str:
        return f"{self.seat} from {self.start}"


class EntryKind(models.TextChoices):
    OPENING = "opening", "Opening balance"
    CHARGE = "charge", "Charge"
    CREDIT = "credit", "Lessons given back"
    PAYMENT = "payment", "Payment"
    REFUND = "refund", "Refund"
    ADJUST = "adjust", "Adjustment"


class PaymentMethod(models.TextChoices):
    """lc-up's own names, so a payment reads the same before and after the cutover."""

    CASH = "Naqd pul", "Cash"
    CARD = "Plastik karta", "Card"
    BANK = "Bank hisobi", "Bank transfer"


class Entry(models.Model):
    """One movement of money. Never edited and never deleted: a wrong row is voided, with a reason, and
    stays visible. The balance is the sum of the rows that are not voided."""

    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="entries")
    span = models.ForeignKey(Span, null=True, blank=True, on_delete=models.PROTECT, related_name="entries")
    #: The group a payment or a refund is for (owner, 22 Nov 2026: "Ha, bog'lansin"): the student's seat in it.
    #: Rows written before it existed stay empty; nothing back-fills them.
    seat = models.ForeignKey(Seat, null=True, blank=True, on_delete=models.PROTECT, related_name="entries")
    kind = models.CharField(max_length=10, choices=EntryKind.choices)
    amount = models.BigIntegerField()
    day = models.DateField()
    #: The month a charge or a credit belongs to, "YYYY-MM".
    month = models.CharField(max_length=7, blank=True, default="")
    #: What this row is for. At most one live row per key, so running anything twice writes nothing twice.
    key = models.CharField(max_length=80)
    method = models.CharField(max_length=60, blank=True, default="")
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    void_reason = models.CharField(max_length=300, blank=True, default="")

    class Meta:
        ordering = ["day", "id"]
        constraints = [
            models.UniqueConstraint(fields=["key"], condition=Q(voided_at__isnull=True), name="billing_entry_live_key")
        ]
        indexes = [models.Index(fields=["account", "voided_at"], name="billing_entry_account_live")]

    def __str__(self) -> str:
        return f"{self.key} {self.amount}"


class BillingState(models.Model):
    """One row: when the ledger opened, and where lc-up's payments begin to be its own."""

    opened_at = models.DateTimeField(null=True, blank=True)
    #: lc-up payments up to this id are inside the opening balance and are never copied.
    opening_max_payment_id = models.BigIntegerField(default=0)
    last_tick_at = models.DateTimeField(null=True, blank=True)

    @classmethod
    def get(cls) -> "BillingState":
        return cls.objects.get_or_create(pk=1)[0]


class BillingRun(models.Model):
    """The opening, each day's comparison with lc-up, and any 15-minute tick where something happened."""

    class Kind(models.TextChoices):
        OPEN = "open", "Opening"
        TICK = "tick", "Tick"
        COMPARE = "compare", "Comparison"
        HISTORY = "history", "Past payments copied"

    kind = models.CharField(max_length=10, choices=Kind.choices)
    #: The day a comparison speaks for.
    day = models.DateField(null=True, blank=True)
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    ok = models.BooleanField(default=True)
    counts = models.JSONField(default=dict, blank=True)
    errors = models.JSONField(default=list, blank=True)
    alerts = models.JSONField(default=list, blank=True)
    #: A comparison's differences, biggest first: {account_id, name, ours, lcup, diff}.
    rows = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-started_at"]


class PastPayment(models.Model):
    """A payment or refund lc-up took before the ledger opened (owner, 2026-11-23: "1-dekabrdan o'zimizni sistemada
    ishlaymiz, api orqali barcha ma'lumotlarni ovolishingiz kerak"). History only: the opening balance already holds
    it, so it never counts toward a balance. Copied from the archive by ``billing.history``, so the student's page,
    their history and the money pages still show it once lc-up is gone."""

    lcup_payment_id = models.PositiveBigIntegerField(unique=True)
    lcup_student_id = models.PositiveIntegerField(db_index=True)
    account = models.ForeignKey(
        Account, null=True, blank=True, on_delete=models.SET_NULL, related_name="past_payments"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    #: The student's name as lc-up had it, for someone who never had an account here.
    name = models.CharField(max_length=200, blank=True, default="")
    kind = models.CharField(max_length=10, choices=EntryKind.choices)
    #: A refund is below zero, as in the ledger.
    amount = models.BigIntegerField()
    day = models.DateField(db_index=True)
    month = models.CharField(max_length=7, blank=True, default="")
    method = models.CharField(max_length=60, blank=True, default="")
    group_name = models.CharField(max_length=200, blank=True, default="")
    classroom = models.ForeignKey(
        "classes.Classroom", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    note = models.CharField(max_length=300, blank=True, default="")
    copied_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-day", "-lcup_payment_id"]
