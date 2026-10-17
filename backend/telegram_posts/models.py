"""Posts the class bot makes into class Telegram groups (plan 2026-10-17).

Two tables and no more. ``GroupPost`` is what to say, to which groups, and when — an admin's
post, or one of the two an event's Publish creates. ``GroupPostDelivery`` is one message in one
group on one day. It is the log the console shows, the claim that stops a second worker sending
the same post into the same group twice, and the Telegram message id that makes "delete from
groups" possible. Nothing is ever recalled by any other route: a message in 26 groups has been
read by the time anyone notices a typo.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class GroupPost(models.Model):
    KIND_MANUAL = "MANUAL"
    KIND_EVENT_ANNOUNCE = "EVENT_ANNOUNCE"
    KIND_EVENT_REMINDER = "EVENT_REMINDER"
    KIND_CHOICES = [
        (KIND_MANUAL, "Written in the console"),
        (KIND_EVENT_ANNOUNCE, "Event announcement"),
        (KIND_EVENT_REMINDER, "Event reminder"),
    ]

    WHEN_NOW = "NOW"
    WHEN_ONCE = "ONCE"
    WHEN_WEEKLY = "WEEKLY"
    #: An event reminder: the evening before the event, read from the event at sweep time, so
    #: a moved start moves the reminder with it. See `schedule.reminder_at`.
    WHEN_EVENT = "EVENT"
    WHEN_CHOICES = [
        (WHEN_NOW, "Now"),
        (WHEN_ONCE, "Once, at a set time"),
        (WHEN_WEEKLY, "Every week"),
        (WHEN_EVENT, "The evening before the event"),
    ]

    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default=KIND_MANUAL, db_index=True)
    #: The admin's own words, plain text. Event posts leave it empty: their text is built from
    #: the event when they are sent (`render`).
    text = models.TextField(blank=True, default="")
    image = models.ImageField(upload_to="telegram_posts/", null=True, blank=True)
    #: What Telegram calls the picture once it has it. The first group gets the bytes; every
    #: later group gets this, so a post to 26 groups uploads its picture once.
    image_file_id = models.CharField(max_length=200, blank=True, default="")
    button_text = models.CharField(max_length=64, blank=True, default="")
    button_url = models.URLField(max_length=500, blank=True, default="")

    #: Audience. Empty lists mean "every subject" / "every level". A non-empty
    #: `classroom_ids` means exactly those classes and the other two are ignored.
    subjects = models.JSONField(default=list, blank=True)
    levels = models.JSONField(default=list, blank=True)
    classroom_ids = models.JSONField(default=list, blank=True)

    when = models.CharField(max_length=10, choices=WHEN_CHOICES, default=WHEN_NOW)
    send_at = models.DateTimeField(null=True, blank=True)
    #: 0 = Monday … 6 = Sunday, as `date.weekday()` counts.
    weekdays = models.JSONField(default=list, blank=True)
    #: Wall-clock time in TIME_ZONE (Asia/Tashkent).
    time_of_day = models.TimeField(null=True, blank=True)
    #: No run scheduled before this moment is ever due. Set on create, on a schedule edit and
    #: on resume, so a weekly post made at 18:30 on its own Saturday waits a week, and a pause
    #: never ends in a burst of everything it covered.
    active_from = models.DateTimeField(default=timezone.now)
    #: The local date of the last run claimed. The claim itself (`sender.claim_run`).
    last_run_on = models.DateField(null=True, blank=True)
    is_paused = models.BooleanField(default=False)
    #: Deleted from the groups (or stopped before it ever ran). Never sends again.
    deleted_at = models.DateTimeField(null=True, blank=True)

    event = models.ForeignKey(
        "events.Event", on_delete=models.CASCADE, null=True, blank=True,
        related_name="telegram_posts",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "telegram_group_posts"
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["event", "kind"], condition=Q(event__isnull=False),
                name="uniq_telegram_post_per_event_kind",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.kind} #{self.pk}"

    @property
    def is_event_post(self) -> bool:
        return self.kind != self.KIND_MANUAL


class GroupPostDelivery(models.Model):
    STATUS_PENDING = "PENDING"
    STATUS_SENDING = "SENDING"
    STATUS_SENT = "SENT"
    STATUS_FAILED = "FAILED"
    #: The run was more than LATE_LIMIT behind its time (the server was down): never sent on
    #: its own, because "tomorrow's mock" posted at 23:00 is worse than nothing.
    STATUS_MISSED = "MISSED"
    STATUS_DELETED = "DELETED"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_SENDING, "Sending"),
        (STATUS_SENT, "Sent"),
        (STATUS_FAILED, "Failed"),
        (STATUS_MISSED, "Missed"),
        (STATUS_DELETED, "Deleted"),
    ]

    post = models.ForeignKey(GroupPost, on_delete=models.CASCADE, related_name="deliveries")
    #: The run's local date — a weekly post gets a new run every week.
    run_on = models.DateField()
    chat_id = models.CharField(max_length=100)
    #: The classes sharing that chat, as they were named when the run opened.
    group_names = models.CharField(max_length=300, blank=True, default="")
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True
    )
    message_id = models.BigIntegerField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    error = models.CharField(max_length=400, blank=True, default="")
    sent_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "telegram_group_post_deliveries"
        ordering = ["run_on", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["post", "run_on", "chat_id"], name="uniq_telegram_post_delivery"
            ),
        ]
        indexes = [models.Index(fields=["post", "run_on"])]

    def __str__(self) -> str:
        return f"{self.post_id} → {self.chat_id} @ {self.run_on}: {self.status}"
