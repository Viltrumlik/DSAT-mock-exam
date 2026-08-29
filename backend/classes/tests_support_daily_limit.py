"""One support session a day, per student.

The school's rule as given: "a student may book a support teacher once a day; booking more
than once must be impossible." That is a statement about the DESK'S day, not about the
student's clicking — so it is counted on the hour the session falls on, unlike the withdrawn
weekly cap, which counted on ``booked_at``. Booking Monday and Tuesday in one sitting is two
days and breaks nothing; taking 10:00 and 11:00 on Thursday is what this stops.

Three places have to agree, and a disagreement between any two of them is the bug:

  * ``book`` / ``book_at`` — the refusal itself;
  * ``invite_member`` — a seat somebody else claimed on your behalf still lands on your day;
  * ``open_calendar_for`` — the day is greyed out *before* the student picks an hour on it.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from access import constants as acc_const
from classes import support as support_service
from classes.models import Classroom, ClassroomMembership
from classes.models_support import SupportBooking

User = get_user_model()


class DailyLimitBase(TestCase):
    def setUp(self):
        self.support = User.objects.create_user(
            username="dl_sup", email="dl_sup@example.com", password="x",
            role=acc_const.ROLE_SUPPORT_TEACHER, subject="both",
        )
        self.student = User.objects.create_user(
            username="dl_stu", email="dl_stu@example.com", password="x",
            role=acc_const.ROLE_STUDENT,
        )
        self.owner = User.objects.create_user(
            username="dl_own", email="dl_own@example.com", password="x",
            role=acc_const.ROLE_ADMIN,
        )
        self.classroom = Classroom.objects.create(
            name="Daily", subject=Classroom.SUBJECT_MATH, created_by=self.owner,
            lesson_days=Classroom.DAYS_ODD, lesson_time="09:00",
        )
        for user, role in (
            (self.student, ClassroomMembership.ROLE_STUDENT),
            (self.support, ClassroomMembership.ROLE_TA),
        ):
            ClassroomMembership.objects.create(classroom=self.classroom, user=user, role=role)

        # Tomorrow, so nothing under test is refused merely for being in the past.
        self.day = timezone.localdate() + timedelta(days=1)

    def hour(self, hour: int, *, day=None):
        return support_service._hour_start(day or self.day, hour)

    def book(self, hour: int, *, day=None, student=None):
        return support_service.book_at(
            student or self.student, self.support, self.hour(hour, day=day)
        )


class BookingDailyLimitTests(DailyLimitBase):
    def test_one_a_day_is_allowed(self):
        booking = self.book(10)
        self.assertEqual(booking.status, SupportBooking.STATUS_BOOKED)

    def test_a_second_hour_on_the_same_day_is_refused(self):
        self.book(10)
        with self.assertRaises(ValidationError) as caught:
            self.book(11)
        self.assertIn("that day", str(caught.exception).lower())

    def test_the_refusal_says_what_to_do_instead(self):
        self.book(10)
        with self.assertRaises(ValidationError) as caught:
            self.book(11)
        message = str(caught.exception).lower()
        self.assertIn("one session a day", message)

    def test_the_next_day_is_free(self):
        """The limit is per day. It must not read as a second weekly cap."""
        self.book(10)
        booking = self.book(10, day=self.day + timedelta(days=1))
        self.assertEqual(booking.status, SupportBooking.STATUS_BOOKED)

    def test_cancelling_gives_the_day_back(self):
        """Giving a seat back is the behaviour the limits exist to encourage; charging for
        it would punish exactly the student who did the right thing."""
        booking = self.book(10)
        support_service.cancel(booking, actor=self.student, reason="can't make it")
        again = self.book(11)
        self.assertEqual(again.status, SupportBooking.STATUS_BOOKED)

    def test_rebooking_the_very_same_hour_is_not_blocked_by_its_own_row(self):
        """Re-booking reuses the row, so counting it would make the student's own cancelled
        seat block them from retaking it."""
        booking = self.book(10)
        support_service.cancel(booking, actor=self.student, reason="changed my mind")
        again = self.book(10)
        self.assertEqual(again.pk, booking.pk)
        self.assertEqual(again.status, SupportBooking.STATUS_BOOKED)


class AllowanceTests(DailyLimitBase):
    def test_the_allowance_names_the_limit_and_the_days_spent(self):
        """The calendar has to be able to grey a day out before the student picks an hour."""
        self.book(10)
        allowance = support_service.booking_allowance(self.student)
        self.assertEqual(allowance["max_per_day"], support_service.MAX_BOOKINGS_PER_DAY)
        self.assertIn(self.day.isoformat(), allowance["taken_days"])

    def test_a_day_with_nothing_on_it_is_not_listed(self):
        allowance = support_service.booking_allowance(self.student)
        self.assertEqual(allowance["taken_days"], [])


class CalendarTests(DailyLimitBase):
    def hours_for(self, day):
        calendar = support_service.open_calendar_for(self.student)
        teacher = next(t for t in calendar if t["teacher"].id == self.support.id)
        return next(d["hours"] for d in teacher["days"] if d["date"] == day)

    def test_a_spent_day_reads_as_spent_rather_than_as_full(self):
        """A day rendered as a mixture of "he's not in" and "full" hides the one reason that
        actually applies to this student."""
        self.book(10)
        hours = self.hours_for(self.day)
        booked = [h for h in hours if h["state"] == "mine"]
        self.assertEqual(len(booked), 1)
        self.assertTrue(
            any(h["state"] == "day_taken" for h in hours),
            "the rest of a spent day should say why it is shut",
        )

    def test_an_untouched_day_is_unaffected(self):
        other = self.day + timedelta(days=1)
        self.book(10)
        self.assertFalse(any(h["state"] == "day_taken" for h in self.hours_for(other)))


class InviteDailyLimitTests(DailyLimitBase):
    def setUp(self):
        super().setUp()
        self.classmate = User.objects.create_user(
            username="dl_mate", email="dl_mate@example.com", password="x",
            role=acc_const.ROLE_STUDENT,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.classmate,
            role=ClassroomMembership.ROLE_STUDENT,
        )

    def test_a_classmate_who_already_has_that_day_cannot_be_added(self):
        """A seat somebody else claimed on your behalf still lands on your afternoon."""
        support_service.book_at(self.classmate, self.support, self.hour(9))
        mine = self.book(11)
        with self.assertRaises(ValidationError) as caught:
            support_service.invite_member(mine, self.classmate, actor=self.student)
        self.assertIn("that day", str(caught.exception).lower())

    def test_a_free_classmate_can_still_be_added(self):
        mine = self.book(11)
        seat = support_service.invite_member(mine, self.classmate, actor=self.student)
        self.assertEqual(seat.student_id, self.classmate.id)
        self.assertEqual(seat.status, SupportBooking.STATUS_BOOKED)
