"""Cancellation reasons, booking limits, and session ratings.

Three rules the school asked for, and the seams where each could go wrong:

- a cancelled seat costs the teacher an hour and another student the chance to take it, so
  the reason is asked for and shown;
- the desk is finite, so one student cannot hold or churn through the whole week;
- the student gets to say how the hour went, and saying so must never touch their points.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes import support as support_service
from classes.models import Classroom, ClassroomMembership
from classes.models_support import SupportAvailability, SupportBooking

User = get_user_model()


class SupportV2Fixture(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("v2_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.support = User.objects.create_user(
            "v2_sup@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH
        )
        self.student = User.objects.create_user("v2_student@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Maths V2", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.support, role=ClassroomMembership.ROLE_TA
        )
        self._day = support_service.CALENDAR_DAYS + 3

    def make_slot(self, *, teacher=None, capacity=1):
        """A future slot at 9am, each call its own DAY, well past the calendar window so the
        fixture never collides with a real calendar hour.

        A day apiece, not an hour apiece: MAX_BOOKINGS_PER_DAY is 1, so a fixture that hands
        out two hours on one afternoon cannot book both — every test that takes more than one
        seat would die on the per-day refusal rather than on the thing it is testing. (It
        did: seven of them, from the day the per-day cap landed until this was fixed.)
        """
        self._day += 1
        start = support_service._hour_start(
            timezone.localdate() + timedelta(days=self._day), 9
        )
        return SupportAvailability.objects.create(
            support_teacher=teacher or self.support, starts_at=start,
            ends_at=start + timedelta(hours=1), capacity=capacity,
        )

    def book(self):
        return support_service.book(self.student, self.make_slot())

    def held(self):
        """A booking the teacher has marked attended — the only kind that can be rated."""
        booking = self.book()
        return support_service.settle(
            booking, SupportBooking.STATUS_HELD, actor=self.support
        )


class CancellationReasonTests(SupportV2Fixture):
    def test_the_reason_is_recorded_on_the_booking(self):
        booking = self.book()
        support_service.cancel(booking, actor=self.student, reason="I have a lesson clash")
        booking.refresh_from_db()
        self.assertEqual(booking.status, SupportBooking.STATUS_CANCELLED)
        self.assertEqual(booking.cancel_reason, "I have a lesson clash")
        self.assertEqual(booking.cancelled_by_id, self.student.id)
        self.assertIsNotNone(booking.cancelled_at)

    def test_cancelling_is_not_settling(self):
        """settled_by used to be set by cancel(), which made "who ended this" ambiguous on a
        row that was later re-booked and settled for real."""
        booking = self.book()
        support_service.cancel(booking, actor=self.student, reason="Unwell")
        booking.refresh_from_db()
        self.assertIsNone(booking.settled_at)
        self.assertIsNone(booking.settled_by_id)

    def test_the_teacher_sees_it_in_the_diary(self):
        booking = self.book()
        support_service.cancel(booking, actor=self.student, reason="Sorted it myself")
        self.client.force_authenticate(self.support)
        # bookings_for_teacher hides cancelled rows from the "who is coming" list, so the
        # reason is read off the booking the student still owns.
        self.client.force_authenticate(self.student)
        body = self.client.get("/api/classes/support/bookings/").json()
        row = next(b for b in body["bookings"] if b["id"] == booking.id)
        self.assertEqual(row["cancel_reason"], "Sorted it myself")

    def test_a_student_must_give_one(self):
        booking = self.book()
        self.client.force_authenticate(self.student)
        r = self.client.delete(f"/api/classes/support/bookings/{booking.id}/", format="json")
        self.assertEqual(r.status_code, 400)
        booking.refresh_from_db()
        # Refused, not silently cancelled without a reason.
        self.assertEqual(booking.status, SupportBooking.STATUS_BOOKED)

    def test_a_student_giving_one_succeeds(self):
        booking = self.book()
        self.client.force_authenticate(self.student)
        r = self.client.delete(
            f"/api/classes/support/bookings/{booking.id}/",
            {"reason": "I'm unwell"}, format="json",
        )
        self.assertEqual(r.status_code, 200)
        booking.refresh_from_db()
        self.assertEqual(booking.cancel_reason, "I'm unwell")

    def test_the_teacher_may_cancel_without_one(self):
        # The teacher cancelling is usually withdrawing the hour; the reason is owed the
        # other way round.
        booking = self.book()
        self.client.force_authenticate(self.support)
        r = self.client.delete(f"/api/classes/support/bookings/{booking.id}/", format="json")
        self.assertEqual(r.status_code, 200)

    def test_withdrawing_an_hour_tells_the_student_why(self):
        booking = self.book()
        self.client.force_authenticate(self.support)
        r = self.client.post(
            "/api/classes/support/hours/close/",
            {"starts_at": booking.availability.starts_at.isoformat()}, format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["bookings_cancelled"], 1)
        booking.refresh_from_db()
        self.assertEqual(booking.status, SupportBooking.STATUS_CANCELLED)
        self.assertIn("withdrew", booking.cancel_reason)

    def test_rebooking_clears_the_old_reason(self):
        """A live booking labelled with why it was called off would be nonsense."""
        booking = self.book()
        slot = booking.availability
        support_service.cancel(booking, actor=self.student, reason="Clash")
        again = support_service.book(self.student, slot)
        self.assertEqual(again.pk, booking.pk)  # the row is reused, so the reward key holds
        self.assertEqual(again.cancel_reason, "")
        self.assertIsNone(again.cancelled_at)
        self.assertIsNone(again.cancelled_by_id)


class BookingLimitTests(SupportV2Fixture):
    def test_a_student_may_hold_up_to_the_upcoming_limit(self):
        for _ in range(support_service.MAX_UPCOMING_BOOKINGS):
            self.book()
        allowance = support_service.booking_allowance(self.student)
        self.assertEqual(allowance["upcoming"], support_service.MAX_UPCOMING_BOOKINGS)
        self.assertFalse(allowance["can_book"])

    def test_one_more_is_refused_with_a_readable_reason(self):
        for _ in range(support_service.MAX_UPCOMING_BOOKINGS):
            self.book()
        with self.assertRaises(ValidationError) as caught:
            self.book()
        self.assertIn("already have", "; ".join(caught.exception.messages))

    def test_cancelling_gives_the_allowance_back(self):
        """Charging for a returned seat would punish the student who did the right thing."""
        first = self.book()
        for _ in range(support_service.MAX_UPCOMING_BOOKINGS - 1):
            self.book()
        support_service.cancel(first, actor=self.student, reason="Clash")
        self.assertTrue(support_service.booking_allowance(self.student)["can_book"])

    def test_attending_a_session_gives_the_allowance_straight_back(self):
        """A session that has been HELD is behind the student, so it holds nothing.

        This is the behaviour the withdrawn weekly cap took away: it charged for the
        attended hour too, so three good sessions locked a student out for the rest of the
        week while they were holding nothing at all.
        """
        held = self.held()
        self.assertEqual(held.status, SupportBooking.STATUS_HELD)
        allowance = support_service.booking_allowance(self.student)
        self.assertEqual(allowance["upcoming"], 0)
        self.assertTrue(allowance["can_book"])

    def test_there_is_no_weekly_cap(self):
        """Attending many sessions in one week is exactly the use the desk is for."""
        for _ in range(6):
            self.held()
        allowance = support_service.booking_allowance(self.student)
        self.assertEqual(allowance["upcoming"], 0)
        self.assertTrue(allowance["can_book"])
        self.assertNotIn("max_per_week", allowance)
        self.book()  # does not raise

    def test_a_cancelled_booking_costs_nothing(self):
        for _ in range(4):
            support_service.cancel(self.book(), actor=self.student, reason="Clash")
        self.assertTrue(support_service.booking_allowance(self.student)["can_book"])

    def test_the_limit_is_one_students_own(self):
        classmate = User.objects.create_user("v2_mate@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=classmate, role=ClassroomMembership.ROLE_STUDENT
        )
        for _ in range(support_service.MAX_UPCOMING_BOOKINGS):
            self.book()
        # The classmate is untouched by how much the first student has booked.
        self.assertTrue(support_service.booking_allowance(classmate)["can_book"])

    def test_the_calendar_reports_the_allowance(self):
        # Sent with the calendar so the student sees the limit before picking an hour, not
        # as a refusal afterwards.
        self.book()
        self.client.force_authenticate(self.student)
        body = self.client.get("/api/classes/support/calendar/").json()
        self.assertEqual(body["allowance"]["upcoming"], 1)
        self.assertEqual(body["allowance"]["max_upcoming"], support_service.MAX_UPCOMING_BOOKINGS)
        self.assertTrue(body["allowance"]["can_book"])

    def test_the_endpoint_refuses_over_the_limit(self):
        for _ in range(support_service.MAX_UPCOMING_BOOKINGS):
            self.book()
        slot = self.make_slot()
        self.client.force_authenticate(self.student)
        r = self.client.post(
            "/api/classes/support/bookings/", {"availability_id": slot.id}, format="json"
        )
        self.assertEqual(r.status_code, 400)


class SessionRatingTests(SupportV2Fixture):
    def test_a_held_session_can_be_rated(self):
        booking = self.held()
        support_service.rate(booking, 4, comment="Cleared up inference questions")
        booking.refresh_from_db()
        self.assertEqual(booking.rating, 4)
        self.assertEqual(booking.rating_comment, "Cleared up inference questions")
        self.assertIsNotNone(booking.rated_at)

    def test_a_session_that_has_not_happened_cannot_be_rated(self):
        with self.assertRaises(ValidationError):
            support_service.rate(self.book(), 5)

    def test_a_cancelled_session_cannot_be_rated(self):
        booking = self.book()
        support_service.cancel(booking, actor=self.student, reason="Clash")
        with self.assertRaises(ValidationError):
            support_service.rate(booking, 5)

    def test_the_scale_is_one_to_five(self):
        booking = self.held()
        for bad in (0, 6, -1, "great", None):
            with self.subTest(rating=bad):
                with self.assertRaises(ValidationError):
                    support_service.rate(booking, bad)

    def test_re_rating_overwrites(self):
        """A student who misclicks 1 is not stuck with it."""
        booking = self.held()
        support_service.rate(booking, 1)
        support_service.rate(booking, 5, comment="Meant to press five")
        booking.refresh_from_db()
        self.assertEqual(booking.rating, 5)
        self.assertEqual(booking.rating_comment, "Meant to press five")

    def test_only_the_student_may_rate(self):
        booking = self.held()
        self.client.force_authenticate(self.support)
        r = self.client.post(
            f"/api/classes/support/bookings/{booking.id}/rate/", {"rating": 5}, format="json"
        )
        # A review the teacher can write is not a review.
        self.assertEqual(r.status_code, 403)
        booking.refresh_from_db()
        self.assertIsNone(booking.rating)

    def test_the_student_may_rate_through_the_api(self):
        booking = self.held()
        self.client.force_authenticate(self.student)
        r = self.client.post(
            f"/api/classes/support/bookings/{booking.id}/rate/",
            {"rating": 5, "comment": "Really helped"}, format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["rating"], 5)

    def test_rating_does_not_touch_points(self):
        """Settling as HELD is what pays. Making the money depend on the review would put
        the teacher's interest against the student's honesty."""
        from rewards.services import balance

        booking = self.held()
        before = balance(self.student)
        support_service.rate(booking, 1, comment="Not useful")
        self.assertEqual(balance(self.student), before)
        booking.refresh_from_db()
        self.assertEqual(booking.status, SupportBooking.STATUS_HELD)

    def test_the_teacher_sees_the_average(self):
        for value in (5, 3):
            support_service.rate(self.held(), value)
        summary = support_service.rating_summary(self.support)
        self.assertEqual(summary["count"], 2)
        self.assertEqual(summary["average"], 4.0)

    def test_the_average_is_none_before_anyone_rates(self):
        self.held()
        summary = support_service.rating_summary(self.support)
        self.assertIsNone(summary["average"])
        self.assertEqual(summary["count"], 0)


class TeacherNoteTests(SupportV2Fixture):
    def test_settling_records_what_was_covered(self):
        booking = self.book()
        support_service.settle(
            booking, SupportBooking.STATUS_HELD, actor=self.support,
            teacher_note="Went through Module 2 timing",
        )
        booking.refresh_from_db()
        self.assertEqual(booking.teacher_note, "Went through Module 2 timing")

    def test_re_settling_without_a_note_keeps_the_old_one(self):
        """Fixing a mis-clicked outcome must not silently wipe what the teacher wrote."""
        booking = self.book()
        support_service.settle(
            booking, SupportBooking.STATUS_HELD, actor=self.support, teacher_note="Inference",
        )
        support_service.settle(booking, SupportBooking.STATUS_NO_SHOW, actor=self.support)
        booking.refresh_from_db()
        self.assertEqual(booking.teacher_note, "Inference")
        self.assertEqual(booking.status, SupportBooking.STATUS_NO_SHOW)

    def test_the_student_sees_it(self):
        booking = self.book()
        support_service.settle(
            booking, SupportBooking.STATUS_HELD, actor=self.support, teacher_note="Timing drills",
        )
        self.client.force_authenticate(self.student)
        body = self.client.get("/api/classes/support/bookings/").json()
        row = next(b for b in body["bookings"] if b["id"] == booking.id)
        self.assertEqual(row["teacher_note"], "Timing drills")


class TeacherCalendarTests(SupportV2Fixture):
    def url(self):
        return "/api/classes/support/my-calendar/"

    def test_a_support_teacher_sees_their_week(self):
        self.client.force_authenticate(self.support)
        body = self.client.get(self.url()).json()
        self.assertEqual(len(body["days_out"]), support_service.CALENDAR_DAYS)
        hours_per_day = support_service.CALENDAR_CLOSE_HOUR - support_service.CALENDAR_OPEN_HOUR
        self.assertEqual(len(body["days_out"][0]["hours"]), hours_per_day)

    def test_a_student_cannot(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(self.url()).status_code, 403)

    def test_a_booked_hour_names_who_is_coming(self):
        # Booked inside the calendar window so it lands on the grid; the fixture's own slots
        # are deliberately outside it.
        starts_at = support_service._hour_start(
            timezone.localdate() + timedelta(days=1), support_service.CALENDAR_OPEN_HOUR + 1
        )
        support_service.book_at(self.student, self.support, starts_at, topic="Inference")

        self.client.force_authenticate(self.support)
        body = self.client.get(self.url()).json()
        hours = [h for d in body["days_out"] for h in d["hours"] if h["state"] == "booked"]
        self.assertEqual(len(hours), 1)
        self.assertEqual(hours[0]["bookings"][0]["student_id"], self.student.id)
        self.assertEqual(hours[0]["bookings"][0]["topic"], "Inference")

    def test_a_withdrawn_hour_reads_closed_and_can_be_re_opened(self):
        starts_at = support_service._hour_start(
            timezone.localdate() + timedelta(days=1), support_service.CALENDAR_OPEN_HOUR + 2
        )
        self.client.force_authenticate(self.support)
        self.client.post(
            "/api/classes/support/hours/close/", {"starts_at": starts_at.isoformat()}, format="json"
        )
        body = self.client.get(self.url()).json()
        closed = [h for d in body["days_out"] for h in d["hours"] if h["state"] == "closed"]
        self.assertEqual(len(closed), 1)

        self.client.post(
            "/api/classes/support/hours/open/", {"starts_at": starts_at.isoformat()}, format="json"
        )
        body = self.client.get(self.url()).json()
        self.assertEqual(
            [h for d in body["days_out"] for h in d["hours"] if h["state"] == "closed"], []
        )

    def test_a_withdrawn_hour_is_no_longer_bookable_by_a_student(self):
        """The state the teacher set has to reach the student's calendar, not just their own."""
        starts_at = support_service._hour_start(
            timezone.localdate() + timedelta(days=1), support_service.CALENDAR_OPEN_HOUR + 3
        )
        self.client.force_authenticate(self.support)
        self.client.post(
            "/api/classes/support/hours/close/", {"starts_at": starts_at.isoformat()}, format="json"
        )
        with self.assertRaises(ValidationError):
            support_service.book_at(self.student, self.support, starts_at)

    def test_an_off_the_hour_time_is_refused(self):
        self.client.force_authenticate(self.support)
        odd = support_service._hour_start(
            timezone.localdate() + timedelta(days=1), 10
        ) + timedelta(minutes=17)
        r = self.client.post(
            "/api/classes/support/hours/close/", {"starts_at": odd.isoformat()}, format="json"
        )
        self.assertEqual(r.status_code, 400)

    def test_an_unknown_action_is_refused(self):
        self.client.force_authenticate(self.support)
        starts_at = support_service._hour_start(timezone.localdate() + timedelta(days=1), 10)
        r = self.client.post(
            "/api/classes/support/hours/destroy/", {"starts_at": starts_at.isoformat()}, format="json"
        )
        self.assertEqual(r.status_code, 400)
