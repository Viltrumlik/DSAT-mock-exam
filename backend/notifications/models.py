"""The in-app inbox, and the browser subscriptions push is delivered to.

**Why this is not `realtime.RealtimeEvent`.** That model is a delivery *hint* bus — its own
POLICY.md says clients always refetch canonical REST endpoints — and it is deliberately lossy:
low-priority events are sampled before the DB write and the whole table is reaped after 24
hours. It has no read state, no category and no title. It is the right thing to tell a browser
"something changed"; it cannot be the thing a student scrolls back through.

So the two work together rather than competing: a notification is written here, and
`realtime.emit_to_user` fires a `notifications.updated` hint so an open tab refetches. That
event name is already reserved and already wired end to end on the client.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from .constants import CATEGORY_CHOICES, CATEGORY_SYSTEM, EVENT_CHOICES


class Notification(models.Model):
    """One thing a student is told."""

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    category = models.CharField(
        max_length=16, choices=CATEGORY_CHOICES, default=CATEGORY_SYSTEM, db_index=True
    )
    event = models.CharField(max_length=32, choices=EVENT_CHOICES, db_index=True)

    title = models.CharField(max_length=160)
    body = models.CharField(max_length=400, blank=True, default="")
    #: Where tapping it goes. A relative path — the platform is served from several
    #: subdomains and an absolute URL would send a teacher to the student site.
    link_url = models.CharField(max_length=300, blank=True, default="")

    #: Null means unread. A timestamp rather than a boolean because "when did they see this"
    #: is the question that gets asked, and a boolean cannot answer it later.
    read_at = models.DateTimeField(null=True, blank=True, db_index=True)

    #: Collapses repeats of the same fact. A homework graded, then re-graded twice in a
    #: minute, is one thing that happened as far as the student is concerned.
    dedupe_key = models.CharField(max_length=120, blank=True, default="", db_index=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "notifications"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["recipient", "-created_at"]),          # the inbox
            models.Index(fields=["recipient", "category", "read_at"]),  # the per-section badge
        ]

    def __str__(self) -> str:
        return f"{self.recipient_id}: {self.title}"

    @property
    def is_read(self) -> bool:
        return self.read_at is not None


class PushSubscription(models.Model):
    """One browser that has agreed to receive push.

    Keyed on `endpoint`, which is what the browser gives us and what uniquely identifies the
    installation. A student with a laptop and a phone has two rows, and re-subscribing on the
    same device updates the existing one rather than accumulating dead endpoints.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions"
    )
    endpoint = models.URLField(max_length=500, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    user_agent = models.CharField(max_length=240, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)
    #: Set when the push service says the endpoint is gone (404/410). The row is kept for a
    #: while rather than deleted so "why did my phone stop buzzing?" is answerable.
    failed_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "notification_push_subscriptions"
        ordering = ["-last_seen_at"]
        indexes = [models.Index(fields=["user", "failed_at"])]

    def __str__(self) -> str:
        return f"{self.user_id} @ {self.endpoint[:40]}…"


class NotificationPreference(models.Model):
    """Per-student, per-category opt-out.

    Absence of a row means everything is on, so a new category does not arrive switched off
    for everyone who registered before it existed.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_prefs"
    )
    #: `{category: false}` for the ones they have switched off. Only stores exceptions.
    muted_categories = models.JSONField(default=list, blank=True)
    #: Separate from the categories: a student may want the bell but not their phone buzzing.
    push_enabled = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "notification_preferences"

    def is_muted(self, category: str) -> bool:
        return category in (self.muted_categories or [])
