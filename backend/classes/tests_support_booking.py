"""Support-teacher booking.

The school's rule, and the one these mostly exist to hold: **a student may only book a
support teacher assigned to a classroom that student is in.**
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
from rewards.models import PointAward
from rewards.services import balance

User = get_user_model()


class SupportFixture(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("sb_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.support = User.objects.create_user(
            "sb_sup@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH
        )
        self.other_support = User.objects.create_user(
            "sb_sup2@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH
        )
        self.student = User.objects.create_user("sb_student@t.com", "secret123")
        self.outsider = User.objects.create_user("sb_outsider@t.com", "secret123")

        self.classroom = Classroom.objects.create(
            name="Maths A", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        self.other_classroom = Classroom.objects.create(
            name="Maths B", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        # The student and the support teacher share Maths A.
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.support_membership = ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.support, role=ClassroomMembership.ROLE_TA
        )
        # `other_support` covers a class the student is NOT in.
        ClassroomMembership.objects.create(
            classroom=self.other_classroom, user=self.other_support, role=ClassroomMembership.ROLE_TA
        )
        # The outsider is in no class at all.

        self._slots_made = 0
        self.slot = self.make_slot(self.support)

    #: Deliberately **past the calendar's four-day window and on the hour**.
    #:
    #: This used to be ``timezone.now() + 24h``, which put a one-hour block at tomorrow's
    #: HH:MM inside the calendar every subclass reads. Since an hour is governed by any row
    #: *overlapping* it, a fixture slot at 09:39–10:39 quietly took charge of both 09:00 and
    #: 10:00 — so three calendar tests passed or failed on what time of day the suite ran.
    #: They passed locally at 10:23 and failed in CI at 09:39. Nothing here needs the slot to
    #: be inside the window: ``book`` only asks that it is in the future, and
    #: ``open_slots_for`` has no window bound at all.
    SLOT_DAYS_OUT = support_service.CALENDAR_DAYS + 3
    FIRST_SLOT_HOUR = 10

    def make_slot(self, teacher, *, capacity=1, hour=None):
        """A future slot outside the calendar window. Each call gets its own hour.

        ``uniq_support_slot_per_teacher_start`` forbids two rows for one teacher at one
        instant, and the old wall-clock start only cleared it by microseconds.
        """
        if hour is None:
            hour = self.FIRST_SLOT_HOUR + self._slots_made
            self._slots_made += 1
        start = support_service._hour_start(
            timezone.localdate() + timedelta(days=self.SLOT_DAYS_OUT), hour
        )
        return SupportAvailability.objects.create(
            support_teacher=teacher, starts_at=start,
            ends_at=start + timedelta(hours=1), capacity=capacity,
        )


class EligibilityTests(SupportFixture):
    def test_a_student_may_book_a_support_teacher_from_their_own_class(self):
        booking = support_service.book(self.student, self.slot)
        self.assertEqual(booking.status, SupportBooking.STATUS_BOOKED)
        self.assertEqual(booking.classroom_id, self.classroom.id)

    def test_a_student_may_not_book_a_support_teacher_from_another_class(self):
        foreign = self.make_slot(self.other_support)
        with self.assertRaises(ValidationError):
            support_service.book(self.student, foreign)

    def test_a_student_in_no_class_can_book_nothing(self):
        self.assertEqual(support_service.open_slots_for(self.outsider).count(), 0)
        with self.assertRaises(ValidationError):
            support_service.book(self.outsider, self.slot)

    def test_leaving_the_class_removes_the_entitlement_immediately(self):
        """Eligibility is computed live rather than snapshotted onto the booking — a snapshot
        would keep the door open until somebody noticed."""
        ClassroomMembership.objects.filter(
            classroom=self.classroom, user=self.student
        ).update(status=ClassroomMembership.STATUS_REMOVED)

        self.assertEqual(support_service.open_slots_for(self.student).count(), 0)
        with self.assertRaises(ValidationError):
            support_service.book(self.student, self.slot)

    def test_unassigning_the_support_teacher_removes_the_entitlement(self):
        self.support_membership.status = ClassroomMembership.STATUS_REMOVED
        self.support_membership.save(update_fields=["status"])

        self.assertEqual(support_service.open_slots_for(self.student).count(), 0)

    def test_the_slot_list_shows_only_entitled_teachers(self):
        self.make_slot(self.other_support)
        slots = list(support_service.open_slots_for(self.student))

        self.assertEqual([s.support_teacher_id for s in slots], [self.support.id])


class BookingMechanicsTests(SupportFixture):
    def test_a_full_slot_refuses_the_next_student(self):
        classmate = User.objects.create_user("sb_mate@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=classmate, role=ClassroomMembership.ROLE_STUDENT
        )
        support_service.book(self.student, self.slot)
        with self.assertRaises(ValidationError):
            support_service.book(classmate, self.slot)

    def test_capacity_above_one_admits_a_group(self):
        group = self.make_slot(self.support, capacity=2)
        classmate = User.objects.create_user("sb_mate2@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=classmate, role=ClassroomMembership.ROLE_STUDENT
        )
        support_service.book(self.student, group)
        support_service.book(classmate, group)
        self.assertEqual(group.seats_left, 0)

    def test_booking_the_same_slot_twice_is_refused(self):
        support_service.book(self.student, self.slot)
        with self.assertRaises(ValidationError):
            support_service.book(self.student, self.slot)

    def test_a_cancelled_slot_cannot_be_booked(self):
        self.slot.is_cancelled = True
        self.slot.save(update_fields=["is_cancelled"])
        with self.assertRaises(ValidationError):
            support_service.book(self.student, self.slot)

    def test_a_slot_that_has_started_cannot_be_booked(self):
        past = SupportAvailability.objects.create(
            support_teacher=self.support,
            starts_at=timezone.now() - timedelta(hours=2),
            ends_at=timezone.now() - timedelta(hours=1),
        )
        with self.assertRaises(ValidationError):
            support_service.book(self.student, past)

    def test_cancelling_gives_the_seat_back(self):
        booking = support_service.book(self.student, self.slot)
        support_service.cancel(booking)
        self.assertEqual(self.slot.seats_left, 1)

    def test_rebooking_after_cancelling_reuses_the_same_row(self):
        """The reward key is the booking id, so a second row would be a second award."""
        first = support_service.book(self.student, self.slot)
        support_service.cancel(first)
        again = support_service.book(self.student, self.slot)

        self.assertEqual(again.pk, first.pk)
        self.assertEqual(SupportBooking.objects.count(), 1)

    def test_a_settled_session_cannot_be_re_booked(self):
        """Re-booking reuses the row, so without this a student could erase a NO_SHOW — or
        overwrite a HELD and silently revoke their own points — just by pressing Book again."""
        booking = support_service.book(self.student, self.slot)
        support_service.settle(booking, SupportBooking.STATUS_NO_SHOW, actor=self.support)

        with self.assertRaises(ValidationError):
            support_service.book(self.student, self.slot)

        booking.refresh_from_db()
        self.assertEqual(booking.status, SupportBooking.STATUS_NO_SHOW)

    def test_re_booking_cannot_take_back_points_from_a_held_session(self):
        booking = support_service.book(self.student, self.slot)
        support_service.settle(booking, SupportBooking.STATUS_HELD, actor=self.support)
        self.assertEqual(balance(self.student), 10)

        with self.assertRaises(ValidationError):
            support_service.book(self.student, self.slot)

        self.assertEqual(balance(self.student), 10)

    def test_a_settled_session_cannot_be_cancelled(self):
        booking = support_service.book(self.student, self.slot)
        support_service.settle(booking, SupportBooking.STATUS_HELD, actor=self.support)
        with self.assertRaises(ValidationError):
            support_service.cancel(booking)


class RewardTests(SupportFixture):
    def test_booking_alone_earns_nothing(self):
        """Otherwise the calendar is the cheapest points on the platform."""
        support_service.book(self.student, self.slot)
        self.assertEqual(balance(self.student), 0)
        self.assertEqual(PointAward.objects.count(), 0)

    def test_a_session_confirmed_as_held_earns_ten(self):
        booking = support_service.book(self.student, self.slot)
        support_service.settle(booking, SupportBooking.STATUS_HELD, actor=self.support)

        self.assertEqual(balance(self.student), 10)

    def test_a_no_show_earns_nothing(self):
        booking = support_service.book(self.student, self.slot)
        support_service.settle(booking, SupportBooking.STATUS_NO_SHOW, actor=self.support)

        self.assertEqual(balance(self.student), 0)

    def test_correcting_held_to_no_show_takes_the_points_back(self):
        booking = support_service.book(self.student, self.slot)
        support_service.settle(booking, SupportBooking.STATUS_HELD, actor=self.support)
        self.assertEqual(balance(self.student), 10)

        support_service.settle(booking, SupportBooking.STATUS_NO_SHOW, actor=self.support)
        self.assertEqual(balance(self.student), 0)

    def test_settling_held_repeatedly_pays_once(self):
        booking = support_service.book(self.student, self.slot)
        for _ in range(3):
            support_service.settle(booking, SupportBooking.STATUS_HELD, actor=self.support)

        self.assertEqual(balance(self.student), 10)
        self.assertEqual(PointAward.objects.filter(student=self.student).count(), 1)

    def test_the_award_carries_the_classroom_it_was_booked_through(self):
        booking = support_service.book(self.student, self.slot)
        support_service.settle(booking, SupportBooking.STATUS_HELD, actor=self.support)

        award = PointAward.objects.get(student=self.student)
        self.assertEqual(award.classroom_id, self.classroom.id)
        self.assertEqual(award.source_type, "support_booking")


class ApiTests(SupportFixture):
    def test_a_student_cannot_settle_their_own_session(self):
        """Settling as HELD awards the student. Self-service would be the whole system."""
        booking = support_service.book(self.student, self.slot)
        self.client.force_authenticate(self.student)
        response = self.client.post(
            f"/api/classes/support/bookings/{booking.id}/settle/", {"status": "HELD"}, format="json"
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(balance(self.student), 0)

    def test_the_support_teacher_settles_through_the_api(self):
        booking = support_service.book(self.student, self.slot)
        self.client.force_authenticate(self.support)
        response = self.client.post(
            f"/api/classes/support/bookings/{booking.id}/settle/", {"status": "HELD"}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "HELD")
        self.assertEqual(balance(self.student), 10)

    def test_another_support_teacher_cannot_settle_someone_elses_session(self):
        booking = support_service.book(self.student, self.slot)
        self.client.force_authenticate(self.other_support)
        response = self.client.post(
            f"/api/classes/support/bookings/{booking.id}/settle/", {"status": "HELD"}, format="json"
        )

        self.assertEqual(response.status_code, 403)

    def test_a_student_books_through_the_api(self):
        self.client.force_authenticate(self.student)
        response = self.client.post(
            "/api/classes/support/bookings/",
            {"availability_id": self.slot.id, "topic": "Quadratics"}, format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["topic"], "Quadratics")
        self.assertEqual(response.json()["classroom_name"], "Maths A")

    def test_the_api_refuses_an_ineligible_booking_with_a_readable_reason(self):
        foreign = self.make_slot(self.other_support)
        self.client.force_authenticate(self.student)
        response = self.client.post(
            "/api/classes/support/bookings/", {"availability_id": foreign.id}, format="json"
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("assigned to one of your classes", response.json()["detail"])

    def test_the_slots_endpoint_lists_only_what_the_student_may_book(self):
        self.make_slot(self.other_support)
        self.client.force_authenticate(self.student)
        body = self.client.get("/api/classes/support/slots/").json()

        self.assertEqual(len(body["slots"]), 1)
        self.assertEqual(body["slots"][0]["support_teacher_id"], self.support.id)
        self.assertEqual(body["slots"][0]["seats_left"], 1)

    def test_withdrawing_a_slot_cancels_the_bookings_on_it(self):
        """A student must not keep a confirmed-looking appointment nobody will attend."""
        booking = support_service.book(self.student, self.slot)
        self.client.force_authenticate(self.support)
        response = self.client.delete(f"/api/classes/support/availability/{self.slot.id}/")

        self.assertEqual(response.status_code, 200)
        booking.refresh_from_db()
        self.assertEqual(booking.status, SupportBooking.STATUS_CANCELLED)

    def test_a_student_cannot_publish_availability(self):
        self.client.force_authenticate(self.student)
        start = timezone.now() + timedelta(days=1)
        response = self.client.post(
            "/api/classes/support/availability/",
            {"starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_a_wrong_method_on_a_detail_url_is_405_not_a_crash(self):
        """The detail routes take a URL kwarg the collection handlers do not accept, so
        without their own view a plausible client mistake reaches the handler and 500s."""
        booking = support_service.book(self.student, self.slot)
        self.client.force_authenticate(self.student)

        self.assertEqual(self.client.get(f"/api/classes/support/bookings/{booking.id}/").status_code, 405)
        self.assertEqual(self.client.get(f"/api/classes/support/availability/{self.slot.id}/").status_code, 405)

    def test_the_diary_shows_the_support_teacher_who_booked_them(self):
        support_service.book(self.student, self.slot)
        self.client.force_authenticate(self.support)
        body = self.client.get("/api/classes/support/diary/").json()

        self.assertEqual(len(body["bookings"]), 1)
        self.assertEqual(body["bookings"][0]["student_id"], self.student.id)
