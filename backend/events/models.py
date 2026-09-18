"""Learning-center events: a seat limit, a sign-up, and a record of who came.

Two tables and no more. ``Event`` is the thing on the noticeboard; ``EventRegistration`` is
one student's seat at it, and it is the row that survives everything — a cancellation flips
its status rather than deleting it, so signing up again reuses it. That matters beyond
tidiness: the reward is keyed on the registration id, and the ticket (PR 2) is keyed on a
code stored on the same row, so a student who cancels and comes back keeps one identity at
the door and one in the ledger.

The counts are derived, never stored. A stored `registered_count` is a number that can be
wrong, and this one is read on every card a student sees.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.utils import timezone


class Event(models.Model):
    STATUS_DRAFT = "DRAFT"
    STATUS_PUBLISHED = "PUBLISHED"
    STATUS_CANCELLED = "CANCELLED"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PUBLISHED, "Published"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    title = models.CharField(max_length=160)
    description = models.TextField(blank=True, default="")
    # Plain ImageField and a plain multipart POST, like `stories.Story.image`. The bucket is
    # private, so `.url` is signed and expires — see the serializer's `_image_url`.
    cover_image = models.ImageField(upload_to="events/", null=True, blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    location = models.CharField(
        max_length=200, blank=True, default="",
        help_text='Where to turn up, e.g. "Fergana city branch, room 3".',
    )
    seats = models.PositiveIntegerField(help_text="How many students can sign up.")
    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True
    )
    published_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    #: Claim for the day-before reminder. Set by the sweep before it sends, cleared when the
    #: start moves more than REMINDER_LEAD away. See `services.send_due_reminders`.
    reminder_sent_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "events"
        ordering = ["starts_at"]
        constraints = [
            models.CheckConstraint(
                condition=Q(ends_at__gt=F("starts_at")), name="events_end_after_start"
            ),
            models.CheckConstraint(condition=Q(seats__gte=1), name="events_at_least_one_seat"),
        ]
        indexes = [models.Index(fields=["status", "starts_at"])]

    def __str__(self) -> str:
        return self.title

    @property
    def registered_count(self) -> int:
        """Seats taken. Reads the list view's annotation when there is one, else counts.

        The annotation is `registered_total` (see `views`): a list of twenty events would
        otherwise be twenty COUNT queries, drawn one card at a time.
        """
        annotated = getattr(self, "registered_total", None)
        if annotated is not None:
            return int(annotated)
        return self.registrations.filter(status=EventRegistration.STATUS_REGISTERED).count()

    @property
    def seats_left(self) -> int:
        return max(0, int(self.seats) - self.registered_count)

    @property
    def has_started(self) -> bool:
        return self.starts_at <= timezone.now()

    @property
    def is_past(self) -> bool:
        return self.ends_at < timezone.now()


class EventRegistration(models.Model):
    STATUS_REGISTERED = "REGISTERED"
    STATUS_CANCELLED = "CANCELLED"
    STATUS_CHOICES = [
        (STATUS_REGISTERED, "Registered"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    REASON_STUDENT = "STUDENT"
    REASON_EVENT_CANCELLED = "EVENT_CANCELLED"
    REASON_CHOICES = [
        (REASON_STUDENT, "Cancelled by the student"),
        (REASON_EVENT_CANCELLED, "The event was cancelled"),
    ]

    ATTENDANCE_ATTENDED = "ATTENDED"
    ATTENDANCE_MISSED = "MISSED"
    ATTENDANCE_CHOICES = [
        (ATTENDANCE_ATTENDED, "Attended"),
        (ATTENDANCE_MISSED, "Missed"),
    ]

    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="registrations")
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="event_registrations"
    )
    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default=STATUS_REGISTERED, db_index=True
    )
    #: What the student shows at the door. Minted once, on the row's creation, and kept for
    #: its life — a student who cancels and signs up again keeps one identity at the door and
    #: one in the ledger. Stored bare; the dash in "4K29-7XPD" is display only.
    ticket_code = models.CharField(
        max_length=10, unique=True, db_index=True, null=True, blank=True
    )
    cancel_reason = models.CharField(
        max_length=20, choices=REASON_CHOICES, blank=True, default=""
    )
    registered_at = models.DateTimeField(auto_now_add=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    #: NULL means nobody has marked this student yet — which is not the same as Missed.
    attendance = models.CharField(
        max_length=12, choices=ATTENDANCE_CHOICES, null=True, blank=True, db_index=True
    )
    marked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+",
    )
    marked_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "event_registrations"
        ordering = ["registered_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["event", "student"], name="uniq_event_registration"),
        ]
        indexes = [models.Index(fields=["event", "status"])]

    def __str__(self) -> str:
        return f"{self.student_id} @ {self.event_id}"
