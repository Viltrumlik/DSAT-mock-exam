from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from . import templates as T

#: What is live since #300 (owner, 2026-10-18): on, at 10:00, #64942 on days 1..freeze day − 2 and
#: #52393 ("Bugun oxirgi kun!") on the last one. ``SmsSettings`` starts as exactly this.
DEFAULT_DEBT_HOUR = 10
DEBT_HOUR_MIN, DEBT_HOUR_MAX = 8, 20
DEFAULT_WARNING_TEMPLATE_ID = 64942
DEFAULT_LAST_DAY_TEMPLATE_ID = 52393


def default_debt_slots() -> list:
    return ["student"]


class SmsSettings(models.Model):
    """One row: the debt warning's knobs, set from /ops/sms. ``SMS_DEBT_WARNINGS_ENABLED`` (env)
    stays the master switch over ``debt_enabled`` (``sms.switchboard``).

    A pattern is copied in from ``EskizTemplate`` when an admin picks a template, so the warning
    keeps the exact text eskiz approved even if the cache row later changes or goes."""

    debt_enabled = models.BooleanField(default=True)
    debt_hour = models.PositiveSmallIntegerField(
        default=DEFAULT_DEBT_HOUR, validators=[MinValueValidator(DEBT_HOUR_MIN), MaxValueValidator(DEBT_HOUR_MAX)]
    )
    warning_template_id = models.PositiveIntegerField(default=DEFAULT_WARNING_TEMPLATE_ID)
    warning_pattern = models.TextField(default=T.DEBT_WARNING.text)
    warning_slots = models.JSONField(default=default_debt_slots)
    last_day_template_id = models.PositiveIntegerField(default=DEFAULT_LAST_DAY_TEMPLATE_ID)
    last_day_pattern = models.TextField(default=T.DEBT_LAST_DAY.text)
    last_day_slots = models.JSONField(default=default_debt_slots)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    #: Null until a person changes something: the row is created lazily with the live defaults.
    updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "sms_settings"

    def save(self, *args, **kwargs):
        self.pk = 1  # one row, whoever constructs it
        super().save(*args, **kwargs)

    @classmethod
    def get(cls) -> "SmsSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class EskizTemplate(models.Model):
    """eskiz's templates as ``GET /user/templates`` last listed them (``sms.eskiz_templates.sync``).

    ``pattern`` is eskiz's moderated ``template`` (``%w``/``%d`` slots) — what a text must match;
    ``original`` is the ``original_text`` that was submitted. A row eskiz stops listing is kept
    with status ``gone``, so a campaign or setting that named it still reads."""

    STATUS_SERVICE = "service"
    STATUS_REKLAMA = "reklama"  # usable, at the advertising price
    STATUS_MODERATION = "moderation"
    STATUS_INPROCCESS = "inproccess"  # eskiz's own spelling
    STATUS_REJECTED = "rejected"
    STATUS_GONE = "gone"
    USABLE_STATUSES = (STATUS_SERVICE, STATUS_REKLAMA)

    eskiz_id = models.PositiveIntegerField(unique=True)
    pattern = models.TextField(blank=True, default="")
    original = models.TextField(blank=True, default="")
    status = models.CharField(max_length=16, db_index=True)
    synced_at = models.DateTimeField()
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    submitted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "sms_eskiz_templates"
        ordering = ["-eskiz_id"]

    def __str__(self) -> str:
        return f"#{self.eskiz_id} [{self.status}]"

    @property
    def usable(self) -> bool:
        return self.status in self.USABLE_STATUSES


class SmsCampaign(models.Model):
    """One manual send ("jo'natma") from /ops/sms. The pattern is a snapshot taken at create; the
    recipients are resolved when it goes out (``sms.campaigns``), so a debtor who paid meanwhile
    is skipped."""

    STATUS_SCHEDULED = "SCHEDULED"
    STATUS_SENDING = "SENDING"
    STATUS_DONE = "DONE"
    STATUS_CANCELLED = "CANCELLED"
    STATUS_FAILED = "FAILED"
    STATUS_CHOICES = [
        (STATUS_SCHEDULED, "Scheduled"),
        (STATUS_SENDING, "Sending"),
        (STATUS_DONE, "Done"),
        (STATUS_CANCELLED, "Cancelled"),
        (STATUS_FAILED, "Failed"),
    ]

    AUDIENCE_STUDENT = "student"
    AUDIENCE_GROUP = "group"
    AUDIENCE_DEBTORS = "debtors"
    AUDIENCE_CHOICES = [(AUDIENCE_STUDENT, "Students"), (AUDIENCE_GROUP, "Group"), (AUDIENCE_DEBTORS, "Debtors")]

    template_eskiz_id = models.PositiveIntegerField()
    pattern = models.TextField()
    original = models.TextField(blank=True, default="")
    #: One per slot: ``student`` | ``debt`` | ``text``.
    slot_roles = models.JSONField(default=list)
    #: One per slot: the typed value of a ``text`` slot, "" for the others.
    slot_texts = models.JSONField(default=list)
    audience = models.CharField(max_length=10, choices=AUDIENCE_CHOICES)
    #: User ids (student), [classroom id] (group) or [] (debtors).
    audience_ids = models.JSONField(default=list, blank=True)
    scheduled_at = models.DateTimeField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_SCHEDULED, db_index=True)
    #: Filled at send time: {sent, failed, rejected, uncertain, errors, skipped: {reason: [{user_id, name}]}}.
    result = models.JSONField(default=dict, blank=True)
    error = models.CharField(max_length=400, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "sms_campaigns"
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["status", "scheduled_at"])]

    def __str__(self) -> str:
        return f"campaign {self.pk} {self.audience}: {self.status}"


class SmsMessage(models.Model):
    """One SMS we asked eskiz to send: the log, and — by its unique (kind, day, key) — the claim that
    stops a second one. The row is written BEFORE the request leaves, so a run that dies half-way
    never sends the same SMS again on a re-run."""

    KIND_DEBT_WARNING = "debt_warning"
    KIND_CAMPAIGN = "campaign"
    KIND_TEST = "test"
    KIND_CHOICES = [(KIND_DEBT_WARNING, "Debt warning"), (KIND_CAMPAIGN, "Campaign"), (KIND_TEST, "Test")]

    STATUS_PENDING = "PENDING"  # claimed; the request is about to leave
    STATUS_SENT = "SENT"  # eskiz took it; delivery not known yet
    STATUS_DELIVERED = "DELIVERED"
    STATUS_UNDELIVERED = "UNDELIVERED"  # the operator gave up: blacklist, phone off for 24 h, …
    STATUS_REJECTED = "REJECTED"  # eskiz refused it: not an approved text, a bad number, no balance
    STATUS_FAILED = "FAILED"  # eskiz was not reached; nothing was sent
    STATUS_UNCERTAIN = "UNCERTAIN"  # the request left and no answer came: it may have been sent
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_SENT, "Sent"),
        (STATUS_DELIVERED, "Delivered"),
        (STATUS_UNDELIVERED, "Undelivered"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_FAILED, "Failed"),
        (STATUS_UNCERTAIN, "Uncertain"),
    ]

    kind = models.CharField(max_length=24, choices=KIND_CHOICES)
    #: The local day it went out on — one warning per student per day.
    run_on = models.DateField()
    #: Who the day's limit counts: "student:<lc-up id>", "phone:<998…>" or, for a test, "test:<random>".
    dedupe_key = models.CharField(max_length=64)
    phone = models.CharField(max_length=12)
    text = models.TextField()
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    lcup_student_id = models.PositiveIntegerField(null=True, blank=True)
    campaign = models.ForeignKey(
        SmsCampaign, null=True, blank=True, on_delete=models.SET_NULL, related_name="messages"
    )
    #: The admin who sent it from /ops/sms (a campaign, a test); null for the scheduled warning.
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    #: eskiz's id for the request (a UUID) — what its delivery status is read by.
    request_id = models.CharField(max_length=64, blank=True, default="")
    #: eskiz's own last word on delivery (DELIVERED, EXPIRED, ACCEPTED, …).
    eskiz_status = models.CharField(max_length=32, blank=True, default="")
    parts = models.PositiveSmallIntegerField(null=True, blank=True)
    error = models.CharField(max_length=400, blank=True, default="")
    #: 1, plus one for every later run that sent a FAILED one (it never left) again.
    attempts = models.PositiveSmallIntegerField(default=1)
    sent_at = models.DateTimeField(null=True, blank=True)
    checked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sms_messages"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["kind", "run_on", "dedupe_key"], name="uniq_sms_per_day"),
        ]
        indexes = [models.Index(fields=["status", "sent_at"])]

    def __str__(self) -> str:
        return f"{self.kind} {self.run_on} {self.dedupe_key}: {self.status}"
