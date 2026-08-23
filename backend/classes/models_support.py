"""Support-teacher availability and bookings.

Lives inside ``classes`` rather than its own app for the same reason attendance does: a
support teacher is a ``ClassroomMembership`` (ROLE_TA), and every rule here is expressed in
terms of classroom membership.

Two models, not three. The plan sketched availability → booking → session, but a booking with
a terminal status *is* the session — a third table would only duplicate the booking's own
lifecycle and give the reward hook two rows to disagree about.

**The 10-point award fires on HELD**, i.e. when the support teacher confirms the session
actually happened. Not on booking: a student who books and never turns up has not been helped,
and paying at booking time makes the calendar the cheapest points on the platform.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models


class SupportAvailability(models.Model):
    """One bookable slot published by a support teacher.

    Explicit datetimes rather than a recurrence rule: recurrence needs expansion, exception
    handling and a materialisation job, and the school books a handful of slots a week. A
    teacher publishing five slots five times is cheaper than the machinery.
    """

    support_teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="support_availability",
    )
    starts_at = models.DateTimeField(db_index=True)
    ends_at = models.DateTimeField()
    # More than one student can share a slot when the teacher runs it as a small group.
    capacity = models.PositiveSmallIntegerField(default=1)
    note = models.CharField(max_length=240, blank=True)
    is_cancelled = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "support_availability"
        ordering = ["starts_at", "id"]
        indexes = [models.Index(fields=["support_teacher", "starts_at"])]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(ends_at__gt=models.F("starts_at")),
                name="support_availability_ends_after_start",
            ),
            models.UniqueConstraint(
                fields=["support_teacher", "starts_at"],
                name="uniq_support_slot_per_teacher_start",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.support_teacher_id} @ {self.starts_at:%Y-%m-%d %H:%M}"

    @property
    def booked_count(self) -> int:
        return self.bookings.filter(status=SupportBooking.STATUS_BOOKED).count()

    @property
    def seats_left(self) -> int:
        return max(0, int(self.capacity) - self.booked_count)


class SupportBooking(models.Model):
    """A student's claim on a slot, and — once confirmed — the record that it happened."""

    STATUS_BOOKED = "BOOKED"
    STATUS_HELD = "HELD"
    STATUS_NO_SHOW = "NO_SHOW"
    STATUS_CANCELLED = "CANCELLED"
    STATUS_CHOICES = [
        (STATUS_BOOKED, "Booked"),
        (STATUS_HELD, "Held"),
        (STATUS_NO_SHOW, "Did not attend"),
        (STATUS_CANCELLED, "Cancelled"),
    ]
    #: Statuses that occupy a seat. A cancelled booking frees its seat; a held or missed one
    #: is in the past and no longer competes for it.
    OCCUPYING_STATUSES = (STATUS_BOOKED,)

    availability = models.ForeignKey(
        SupportAvailability, on_delete=models.CASCADE, related_name="bookings"
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="support_bookings"
    )
    # Which shared classroom the booking was made through. Eligibility only requires *a*
    # shared classroom, but the reward ledger wants one to attribute the points to, and a
    # teacher looking at their day wants to know which class the student is asking about.
    classroom = models.ForeignKey(
        "classes.Classroom", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="support_bookings",
    )
    topic = models.CharField(max_length=240, blank=True, help_text="What the student needs help with.")
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_BOOKED, db_index=True
    )
    booked_at = models.DateTimeField(auto_now_add=True)
    # Set when the support teacher settles the outcome.
    settled_at = models.DateTimeField(null=True, blank=True)
    settled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+",
    )

    # ── Invitation ──────────────────────────────────────────────────────────────────
    #: The classmate who brought this student in, when the seat came from an invitation
    #: rather than from the student finding the slot themselves.
    #:
    #: Nullable and SET_NULL because the overwhelming majority of bookings are self-made and
    #: because a deleted inviter must not take their guest's session with them. It is not an
    #: audit column: the support teacher sees it, so that an hour they published as a
    #: one-to-one and which now has two names on it explains itself.
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+", help_text="The classmate who invited this student, if any.",
    )

    # ── Cancellation ────────────────────────────────────────────────────────────────
    # A cancelled seat costs the teacher an hour they held open and another student the
    # chance to take it, so the reason is asked for and shown to the teacher. Its own three
    # fields rather than reusing settled_by: a cancellation is not a settlement, and
    # overloading them made "who ended this" ambiguous on a row that was later re-booked.
    cancel_reason = models.CharField(max_length=280, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+",
    )

    # ── How the session went ────────────────────────────────────────────────────────
    #: The student's rating of the SESSION, 1–5. Never a rating of the student, and never
    #: tied to their points — settling as HELD is what pays, whatever the rating says.
    rating = models.PositiveSmallIntegerField(null=True, blank=True)
    rating_comment = models.CharField(max_length=500, blank=True)
    rated_at = models.DateTimeField(null=True, blank=True)
    #: The teacher's own line on what the hour covered, written when they settle it. Visible
    #: to the student: "we went through inference questions" is worth more to them than a
    #: green tick.
    teacher_note = models.CharField(max_length=500, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    #: A rating outside this range is a bug in the caller, not a student's opinion.
    RATING_MIN = 1
    RATING_MAX = 5

    class Meta:
        db_table = "support_bookings"
        ordering = ["-booked_at", "-id"]
        indexes = [
            models.Index(fields=["student", "status"]),
            models.Index(fields=["availability", "status"]),
        ]
        constraints = [
            # One claim per student per slot. Re-booking a slot the student cancelled reuses
            # this row rather than adding a second — so the seat maths and the reward key
            # both stay keyed on a single, stable id.
            models.UniqueConstraint(
                fields=["availability", "student"], name="uniq_support_booking_per_slot"
            )
        ]

    def __str__(self) -> str:
        return f"{self.student_id} → {self.availability_id} ({self.status})"
