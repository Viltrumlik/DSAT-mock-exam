from django.conf import settings
from django.db import models


class SmsMessage(models.Model):
    """One SMS we asked eskiz to send: the log, and — by its unique (kind, day, key) — the claim that
    stops a second one. The row is written BEFORE the request leaves, so a run that dies half-way
    never sends the same SMS again on a re-run."""

    KIND_DEBT_WARNING = "debt_warning"
    KIND_TEST = "test"
    KIND_CHOICES = [(KIND_DEBT_WARNING, "Debt warning"), (KIND_TEST, "Test")]

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
