"""The open support calendar.

The school's rule: a student sees the support teacher assigned to their own classroom, the
next four days, every hour from 08:00 to 18:00 that is still free — and books from there.

The load-bearing change these hold is that **an hour is free unless something says otherwise**.
Before, a teacher had to publish each slot by hand, so a teacher who published nothing showed
a student an empty page that read as "no help available".
"""

from __future__ import annotations

from datetime import timedelta

from django.core.exceptions import ValidationError
from django.utils import timezone

from classes import support as support_service
from classes.models_support import SupportAvailability, SupportBooking

from .tests_support_booking import SupportFixture


def _hours(entry, day_index=0):
    return entry["days"][day_index]["hours"]


def _states(entry, day_index=0):
    return [h["state"] for h in _hours(entry, day_index)]


class CalendarShapeTests(SupportFixture):
    def test_it_covers_four_days_of_school_hours(self):
        entry = support_service.open_calendar_for(self.student)[0]
        self.assertEqual(len(entry["days"]), 4)
        for day in entry["days"]:
            self.assertEqual(len(day["hours"]), 10)  # 08:00 … 17:00
        first = timezone.localtime(entry["days"][0]["hours"][0]["starts_at"])
        last = timezone.localtime(entry["days"][0]["hours"][-1]["starts_at"])
        self.assertEqual(first.hour, 8)
        self.assertEqual(last.hour, 17)

    def test_the_days_run_from_today(self):
        entry = support_service.open_calendar_for(self.student)[0]
        today = timezone.localdate()
        self.assertEqual(
            [d["date"] for d in entry["days"]],
            [today + timedelta(days=i) for i in range(4)],
        )

    def test_an_hour_is_free_without_the_teacher_publishing_anything(self):
        SupportAvailability.objects.all().delete()
        # Read from noon so today's morning is unambiguously behind us.
        now = support_service._hour_start(timezone.localdate(), 12)
        entry = support_service.open_calendar_for(self.student, now=now)[0]
        self.assertEqual(_states(entry, 1), ["open"] * 10)  # tomorrow, wide open
        self.assertIsNone(_hours(entry, 1)[0]["availability_id"])

    def test_hours_that_have_gone_by_are_reported_as_past(self):
        now = support_service._hour_start(timezone.localdate(), 12)
        entry = support_service.open_calendar_for(self.student, now=now)[0]
        # 08:00–12:00 have started; 13:00 onwards have not.
        self.assertEqual(_states(entry)[:5], ["past"] * 5)
        self.assertEqual(_states(entry)[5:], ["open"] * 5)


class CalendarEligibilityTests(SupportFixture):
    def test_only_a_teacher_assigned_to_my_class_appears(self):
        calendar = support_service.open_calendar_for(self.student)
        self.assertEqual([e["teacher"].id for e in calendar], [self.support.id])

    def test_a_student_in_no_class_gets_an_empty_calendar(self):
        self.assertEqual(support_service.open_calendar_for(self.outsider), [])

    def test_the_calendar_names_the_class_we_share(self):
        entry = support_service.open_calendar_for(self.student)[0]
        self.assertEqual([c.id for c in entry["classrooms"]], [self.classroom.id])

    def test_leaving_the_class_empties_the_calendar(self):
        from classes.models import ClassroomMembership

        ClassroomMembership.objects.filter(user=self.student).update(
            status=ClassroomMembership.STATUS_REMOVED
        )
        self.assertEqual(support_service.open_calendar_for(self.student), [])


class CalendarStateTests(SupportFixture):
    def setUp(self):
        super().setUp()
        # Tomorrow at 10:00 is always inside the window and always still ahead.
        self.hour = support_service._hour_start(timezone.localdate() + timedelta(days=1), 10)

    def _cell(self, student=None):
        entry = support_service.open_calendar_for(student or self.student)[0]
        return next(h for h in _hours(entry, 1) if h["starts_at"] == self.hour)

    def test_my_own_booking_is_marked_as_mine(self):
        slot = support_service.slot_for(self.support, self.hour)
        booking = support_service.book(self.student, slot)
        cell = self._cell()
        self.assertEqual(cell["state"], "mine")
        self.assertEqual(cell["booking_id"], booking.id)

    def test_someone_else_taking_the_last_seat_makes_the_hour_full(self):
        from classes.models import ClassroomMembership

        peer = type(self.student).objects.create_user("sb_peer@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=peer, role=ClassroomMembership.ROLE_STUDENT
        )
        slot = support_service.slot_for(self.support, self.hour)
        support_service.book(peer, slot)
        self.assertEqual(self._cell()["state"], "full")

    def test_a_withdrawn_hour_is_closed_rather_than_hidden(self):
        slot = support_service.slot_for(self.support, self.hour)
        slot.is_cancelled = True
        slot.save(update_fields=["is_cancelled"])
        cell = self._cell()
        self.assertEqual(cell["state"], "closed")

    def test_a_group_slot_shows_the_seats_the_teacher_opened(self):
        SupportAvailability.objects.create(
            support_teacher=self.support, starts_at=self.hour,
            ends_at=self.hour + timedelta(hours=1), capacity=4, note="Algebra clinic",
        )
        cell = self._cell()
        self.assertEqual((cell["capacity"], cell["seats_left"]), (4, 4))
        self.assertEqual(cell["note"], "Algebra clinic")

    def test_cancelling_puts_the_hour_back_on_the_calendar(self):
        slot = support_service.slot_for(self.support, self.hour)
        booking = support_service.book(self.student, slot)
        support_service.cancel(booking)
        self.assertEqual(self._cell()["state"], "open")


class SlotMaterialisationTests(SupportFixture):
    def setUp(self):
        super().setUp()
        self.tomorrow = timezone.localdate() + timedelta(days=1)

    def test_booking_a_free_hour_creates_the_row_it_needs(self):
        hour = support_service._hour_start(self.tomorrow, 9)
        self.assertFalse(SupportAvailability.objects.filter(starts_at=hour).exists())
        slot = support_service.slot_for(self.support, hour)
        self.assertEqual(slot.ends_at, hour + timedelta(hours=1))
        self.assertEqual(slot.capacity, 1)

    def test_asking_twice_reuses_the_same_row(self):
        hour = support_service._hour_start(self.tomorrow, 9)
        first = support_service.slot_for(self.support, hour)
        second = support_service.slot_for(self.support, hour)
        self.assertEqual(first.id, second.id)

    def test_an_hour_before_the_desk_opens_is_refused(self):
        with self.assertRaises(ValidationError):
            support_service.slot_for(self.support, support_service._hour_start(self.tomorrow, 7))

    def test_an_hour_after_the_desk_closes_is_refused(self):
        with self.assertRaises(ValidationError):
            support_service.slot_for(self.support, support_service._hour_start(self.tomorrow, 18))

    def test_a_day_beyond_the_window_is_refused(self):
        far = timezone.localdate() + timedelta(days=4)
        with self.assertRaises(ValidationError):
            support_service.slot_for(self.support, support_service._hour_start(far, 10))

    def test_a_half_past_start_is_refused(self):
        hour = support_service._hour_start(self.tomorrow, 10) + timedelta(minutes=30)
        with self.assertRaises(ValidationError):
            support_service.slot_for(self.support, hour)


class CalendarApiTests(SupportFixture):
    def setUp(self):
        super().setUp()
        self.tomorrow = timezone.localdate() + timedelta(days=1)

    def test_the_calendar_endpoint_serves_my_teacher_and_the_school_hours(self):
        self.client.force_authenticate(self.student)
        body = self.client.get("/api/classes/support/calendar/").json()
        self.assertEqual((body["open_hour"], body["close_hour"], body["days"]), (8, 18, 4))
        self.assertEqual(len(body["teachers"]), 1)
        self.assertEqual(body["teachers"][0]["id"], self.support.id)
        self.assertEqual(len(body["teachers"][0]["days"][0]["hours"]), 10)

    def test_a_student_books_an_hour_by_naming_it(self):
        self.client.force_authenticate(self.student)
        hour = support_service._hour_start(self.tomorrow, 11)
        r = self.client.post("/api/classes/support/bookings/", {
            "support_teacher_id": self.support.id,
            "starts_at": hour.isoformat(),
            "topic": "Quadratics",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["topic"], "Quadratics")
        booking = SupportBooking.objects.get(pk=r.json()["id"])
        self.assertEqual(booking.availability.starts_at, hour)
        # The class we share is attributed automatically — the reward ledger needs one.
        self.assertEqual(booking.classroom_id, self.classroom.id)

    def test_booking_a_teacher_who_is_not_mine_mints_nothing(self):
        self.client.force_authenticate(self.student)
        hour = support_service._hour_start(self.tomorrow, 11)
        r = self.client.post("/api/classes/support/bookings/", {
            "support_teacher_id": self.other_support.id,
            "starts_at": hour.isoformat(),
        }, format="json")
        self.assertEqual(r.status_code, 400)
        # The refusal must not leave an availability row behind: a rejected student who can
        # mint slots for any teacher on the platform is a write they were never entitled to.
        self.assertFalse(
            SupportAvailability.objects.filter(support_teacher=self.other_support).exists()
        )

    def test_booking_outside_school_hours_is_refused_with_a_readable_reason(self):
        self.client.force_authenticate(self.student)
        r = self.client.post("/api/classes/support/bookings/", {
            "support_teacher_id": self.support.id,
            "starts_at": support_service._hour_start(self.tomorrow, 20).isoformat(),
        }, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("08:00", r.json()["detail"])

    def test_a_missing_time_is_refused_rather_than_crashing(self):
        self.client.force_authenticate(self.student)
        r = self.client.post(
            "/api/classes/support/bookings/", {"support_teacher_id": self.support.id},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_publishing_a_slot_by_id_still_works(self):
        # The teacher's own publish → student books-by-id path is untouched.
        self.client.force_authenticate(self.student)
        r = self.client.post(
            "/api/classes/support/bookings/", {"availability_id": self.slot.id}, format="json"
        )
        self.assertEqual(r.status_code, 201, r.content)

    def test_an_outsider_gets_an_empty_calendar_rather_than_an_error(self):
        self.client.force_authenticate(self.outsider)
        r = self.client.get("/api/classes/support/calendar/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["teachers"], [])
