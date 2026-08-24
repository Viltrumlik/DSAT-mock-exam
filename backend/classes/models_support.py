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


class SupportWorkingHours(models.Model):
    """One weekday of a support teacher's **standing** schedule: do they work, and when.

    This is the answer to "set it once and it always applies". Everything else in this module
    is dated — a ``SupportAvailability`` row is a specific Tuesday — which meant the only way
    to say "I work 10–4 on Wednesdays" was to click every Wednesday hour on a rolling four-day
    grid, forever, and to redo it as the window slid forward. Nobody was ever going to keep
    that up, and the school didn't: the desk ran on the 08:00–18:00 default with hours nobody
    had actually agreed to.

    So the two concepts are now separated and they compose in one direction:

      * **This model is the rule.** Weekly, undated, entered once.
      * **``SupportAvailability`` is the exception**, and it can only ever *narrow* — a
        withdrawn hour inside working hours is closed; a published row outside them does not
        re-open them. A standing schedule that a stale dated row could silently override would
        not be a standing schedule.

    ``weekday`` is Python's own: 0 = Monday … 6 = Sunday, matching ``date.weekday()``, and
    read from the **school's** local date rather than UTC — the desk keeps Tashkent hours and
    a UTC weekday flips five hours early.

    ``end_hour`` is EXCLUSIVE, so 8→18 means the last session starts at 17:00 and the desk
    closes at 18:00. That matches ``CALENDAR_CLOSE_HOUR`` and the ``range()`` the calendar
    already builds, which is the only reason to prefer it over an inclusive end: one
    convention, not two that have to be reconciled at every call site.

    **No rows at all means "never configured", and that keeps the old behaviour** — open every
    day, 08:00–18:00. A teacher nobody has set up must not silently vanish from the students'
    calendar the day this ships. But once a teacher has *any* row, a weekday with no row means
    **not working**: a half-written schedule fails closed, because a student turning up to an
    empty desk is a worse outcome than a bookable hour going unused. The admin UI writes all
    seven rows in one save, so that state is not one anybody should reach by hand.
    """

    MONDAY = 0
    SUNDAY = 6
    WEEKDAY_CHOICES = [
        (0, "Monday"), (1, "Tuesday"), (2, "Wednesday"), (3, "Thursday"),
        (4, "Friday"), (5, "Saturday"), (6, "Sunday"),
    ]

    support_teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="support_working_hours",
    )
    weekday = models.PositiveSmallIntegerField(choices=WEEKDAY_CHOICES, db_index=True)
    is_working = models.BooleanField(default=True)
    #: Kept when ``is_working`` is False rather than nulled, so switching a day back on
    #: restores the hours the teacher last chose instead of resetting them to the default.
    start_hour = models.PositiveSmallIntegerField(default=8)
    end_hour = models.PositiveSmallIntegerField(default=18, help_text="Exclusive.")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "support_working_hours"
        ordering = ["support_teacher_id", "weekday"]
        verbose_name_plural = "support working hours"
        constraints = [
            models.UniqueConstraint(
                fields=["support_teacher", "weekday"],
                name="uniq_support_working_day_per_teacher",
            ),
            models.CheckConstraint(
                condition=models.Q(end_hour__gt=models.F("start_hour")),
                name="support_working_hours_end_after_start",
            ),
            # 0–24 on both ends. A 25th hour is not a school day, and the calendar's
            # `range(start, end)` would simply produce hours no date can hold.
            models.CheckConstraint(
                condition=models.Q(start_hour__gte=0, start_hour__lte=23),
                name="support_working_hours_start_in_day",
            ),
            models.CheckConstraint(
                condition=models.Q(end_hour__gte=1, end_hour__lte=24),
                name="support_working_hours_end_in_day",
            ),
        ]

    def __str__(self) -> str:
        if not self.is_working:
            return f"{self.support_teacher_id} {self.get_weekday_display()}: off"
        return (
            f"{self.support_teacher_id} {self.get_weekday_display()}: "
            f"{self.start_hour:02d}:00–{self.end_hour:02d}:00"
        )


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
