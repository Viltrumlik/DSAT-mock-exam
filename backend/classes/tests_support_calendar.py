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


class PublishedBlockTests(SupportFixture):
    """A teacher's published row governs every hour it COVERS, not just the hour it starts on.

    Keying the calendar on the exact hour instant meant a 14:00–17:00 block only ever matched
    14:00. Withdrawing it left 15:00 and 16:00 open and bookable — a seat inside an afternoon
    the teacher had just closed.
    """

    def setUp(self):
        super().setUp()
        self.tomorrow = timezone.localdate() + timedelta(days=1)

    def _block(self, from_hour, to_hour, **kw):
        start = support_service._hour_start(self.tomorrow, from_hour)
        return SupportAvailability.objects.create(
            support_teacher=self.support, starts_at=start,
            ends_at=support_service._hour_start(self.tomorrow, to_hour), **kw,
        )

    def _states_tomorrow(self):
        entry = support_service.open_calendar_for(self.student)[0]
        return {
            timezone.localtime(h["starts_at"]).hour: h["state"]
            for h in _hours(entry, 1)
        }

    def test_a_withdrawn_afternoon_closes_every_hour_it_covers(self):
        self._block(14, 17, is_cancelled=True)
        states = self._states_tomorrow()
        self.assertEqual([states[14], states[15], states[16]], ["closed"] * 3)
        self.assertEqual(states[13], "open")   # untouched either side
        self.assertEqual(states[17], "open")

    def test_a_student_cannot_book_inside_a_withdrawn_block(self):
        self._block(14, 17, is_cancelled=True)
        hour = support_service._hour_start(self.tomorrow, 15)
        with self.assertRaises(ValidationError):
            support_service.book_at(self.student, self.support, hour)
        # And no row was minted to paper over it.
        self.assertFalse(
            SupportAvailability.objects.filter(support_teacher=self.support, starts_at=hour).exists()
        )

    def test_a_group_block_carries_its_seats_across_every_hour(self):
        self._block(10, 12, capacity=4, note="Algebra clinic")
        states = self._states_tomorrow()
        self.assertEqual([states[10], states[11]], ["open", "open"])
        entry = support_service.open_calendar_for(self.student)[0]
        eleven = next(
            h for h in _hours(entry, 1) if timezone.localtime(h["starts_at"]).hour == 11
        )
        self.assertEqual((eleven["capacity"], eleven["note"]), (4, "Algebra clinic"))

    def test_an_off_the_hour_block_is_not_invisible(self):
        start = support_service._hour_start(self.tomorrow, 9) + timedelta(minutes=30)
        SupportAvailability.objects.create(
            support_teacher=self.support, starts_at=start,
            ends_at=start + timedelta(hours=1), is_cancelled=True,
        )
        states = self._states_tomorrow()
        # 09:30–10:30 overlaps both the 09:00 and the 10:00 hour.
        self.assertEqual([states[9], states[10]], ["closed", "closed"])

    def test_booking_an_hour_inside_an_open_block_joins_that_block(self):
        block = self._block(14, 17, capacity=2)
        hour = support_service._hour_start(self.tomorrow, 15)
        booking = support_service.book_at(self.student, self.support, hour)
        # It joins the teacher's block rather than minting a rival row for the same time.
        self.assertEqual(booking.availability_id, block.id)
        self.assertEqual(
            SupportAvailability.objects.filter(support_teacher=self.support).count(), 2
        )  # the block + the fixture's own slot


class MaterialisationIsTransactionalTests(SupportFixture):
    """A refused booking must not leave an availability row the teacher never published."""

    def setUp(self):
        super().setUp()
        self.tomorrow = timezone.localdate() + timedelta(days=1)

    def test_an_hour_that_has_already_started_mints_nothing(self):
        hour = support_service._hour_start(timezone.localdate(), 9)
        with self.assertRaises(ValidationError):
            support_service.slot_for(self.support, hour, now=hour + timedelta(minutes=5))
        self.assertFalse(SupportAvailability.objects.filter(starts_at=hour).exists())

    def test_a_refused_booking_rolls_the_row_back(self):
        from classes.models import ClassroomMembership

        peer = type(self.student).objects.create_user("sb_peer2@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=peer, role=ClassroomMembership.ROLE_STUDENT
        )
        hour = support_service._hour_start(self.tomorrow, 12)
        support_service.book_at(peer, self.support, hour)          # takes the only seat
        with self.assertRaises(ValidationError):
            support_service.book_at(self.student, self.support, hour)
        # The peer's row survives; the refusal added nothing.
        self.assertEqual(
            SupportAvailability.objects.filter(support_teacher=self.support, starts_at=hour).count(), 1
        )

    def test_a_wrong_classroom_leaves_nothing_behind(self):
        hour = support_service._hour_start(self.tomorrow, 13)
        with self.assertRaises(ValidationError):
            support_service.book_at(
                self.student, self.support, hour, classroom=self.other_classroom
            )
        self.assertFalse(
            SupportAvailability.objects.filter(support_teacher=self.support, starts_at=hour).exists()
        )


class RepublishOverAStudentRowTests(SupportFixture):
    """Once students materialise rows, publishing over one must still apply the teacher's values."""

    def setUp(self):
        super().setUp()
        self.tomorrow = timezone.localdate() + timedelta(days=1)
        self.hour = support_service._hour_start(self.tomorrow, 10)

    def test_a_teacher_can_open_a_group_on_an_hour_a_student_already_booked(self):
        support_service.book_at(self.student, self.support, self.hour)
        self.client.force_authenticate(self.support)
        r = self.client.post("/api/classes/support/availability/", {
            "starts_at": self.hour.isoformat(),
            "ends_at": (self.hour + timedelta(hours=1)).isoformat(),
            "capacity": 4,
            "note": "Algebra clinic",
        }, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["capacity"], 4)
        slot = SupportAvailability.objects.get(support_teacher=self.support, starts_at=self.hour)
        self.assertEqual((slot.capacity, slot.note), (4, "Algebra clinic"))
        # The student who already booked keeps their seat; three more are now free.
        self.assertEqual(slot.seats_left, 3)


class TheLastThingPublishedGovernsTheHourTests(SupportFixture):
    """A second publication over an hour must take effect, not lose to the first.

    The write path keys on the exact ``starts_at``, so narrowing part of a wider block makes a
    *second* row rather than editing the first. While the calendar picked the earliest-starting
    overlap, that second row governed nothing: the teacher's edit vanished with a 201 and no
    error, and the student kept seeing the old figure.
    """

    def setUp(self):
        super().setUp()
        self.tomorrow = timezone.localdate() + timedelta(days=1)

    def _publish(self, hour_from, hour_to, **body):
        self.client.force_authenticate(self.support)
        return self.client.post("/api/classes/support/availability/", {
            "starts_at": support_service._hour_start(self.tomorrow, hour_from).isoformat(),
            "ends_at": support_service._hour_start(self.tomorrow, hour_to).isoformat(),
            **body,
        }, format="json")

    def _cell(self, hour):
        entry = support_service.open_calendar_for(self.student)[0]
        day = next(d for d in entry["days"] if d["date"] == self.tomorrow)
        return next(
            h for h in day["hours"] if timezone.localtime(h["starts_at"]).hour == hour
        )

    def test_narrowing_one_hour_of_a_block_beats_the_block(self):
        self._publish(14, 17, capacity=5, note="Open clinic")
        self._publish(15, 16, capacity=2, note="Small group")

        self.assertEqual(self._cell(15)["capacity"], 2)
        self.assertEqual(self._cell(15)["note"], "Small group")
        # The hours the narrower row does not cover still answer to the block.
        self.assertEqual(self._cell(14)["capacity"], 5)
        self.assertEqual(self._cell(16)["capacity"], 5)

    def test_a_withdrawal_anywhere_in_the_hour_still_closes_it(self):
        self._publish(14, 17, capacity=5)
        slot = SupportAvailability.objects.get(
            support_teacher=self.support,
            starts_at=support_service._hour_start(self.tomorrow, 14),
        )
        slot.is_cancelled = True
        slot.save(update_fields=["is_cancelled"])
        self._publish(15, 16, capacity=2)

        # Newest-wins applies among publications only — a blocked hour stays blocked, which is
        # the safe direction when the two rows disagree.
        self.assertEqual(self._cell(15)["state"], "closed")


class TheMembershipAndTheAccountMustAgreeTests(SupportFixture):
    """A classroom TA membership alone does not make a support desk.

    There are two doors onto ROLE_TA and only one checks the account role: the roster's
    "Make TA" button promotes any member. Opt-out hours would otherwise advertise a plain
    student — or a teacher who cannot open the diary — as bookable 08:00–18:00.
    """

    def setUp(self):
        super().setUp()
        self.tomorrow = timezone.localdate() + timedelta(days=1)

    def _make_ta(self, user):
        from classes.models import ClassroomMembership

        return ClassroomMembership.objects.create(
            classroom=self.classroom, user=user, role=ClassroomMembership.ROLE_TA
        )

    def test_a_student_promoted_to_ta_is_not_a_bookable_desk(self):
        from access import constants as C

        impostor = type(self.student).objects.create_user("sb_ta_student@t.com", "secret123")
        self.assertEqual(getattr(impostor, "role", None), C.ROLE_STUDENT)
        self._make_ta(impostor)
        self.assertNotIn(impostor.id, support_service.bookable_support_teacher_ids(self.student))
        self.assertNotIn(
            impostor.id,
            [e["teacher"].id for e in support_service.open_calendar_for(self.student)],
        )

    def test_a_teacher_promoted_to_ta_is_not_a_bookable_desk(self):
        from access import constants as C

        teacher = type(self.student).objects.create_user(
            "sb_ta_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self._make_ta(teacher)
        # They cannot open the diary or withdraw hours, so publishing them as a desk would
        # send students to an appointment nobody is going to attend.
        self.assertNotIn(teacher.id, support_service.bookable_support_teacher_ids(self.student))

    def test_the_api_refuses_to_book_a_promoted_student(self):
        impostor = type(self.student).objects.create_user("sb_ta_student2@t.com", "secret123")
        self._make_ta(impostor)
        self.client.force_authenticate(self.student)
        r = self.client.post("/api/classes/support/bookings/", {
            "support_teacher_id": impostor.id,
            "starts_at": support_service._hour_start(self.tomorrow, 11).isoformat(),
        }, format="json")
        self.assertEqual(r.status_code, 400)
        # And no availability row was minted in their name.
        self.assertFalse(SupportAvailability.objects.filter(support_teacher=impostor).exists())

    def test_a_real_support_teacher_is_unaffected(self):
        self.assertIn(self.support.id, support_service.bookable_support_teacher_ids(self.student))


class RepublishCannotOverbookTests(SupportFixture):
    """Republishing applies the teacher's values — but never below what is already booked."""

    def setUp(self):
        super().setUp()
        self.tomorrow = timezone.localdate() + timedelta(days=1)
        self.hour = support_service._hour_start(self.tomorrow, 10)
        self.slot = SupportAvailability.objects.create(
            support_teacher=self.support, starts_at=self.hour,
            ends_at=self.hour + timedelta(hours=3), capacity=4, note="Algebra clinic",
        )
        from classes.models import ClassroomMembership

        self.peers = []
        for i in range(3):
            peer = type(self.student).objects.create_user(f"sb_rp{i}@t.com", "secret123")
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=peer, role=ClassroomMembership.ROLE_STUDENT
            )
            support_service.book(peer, self.slot)
            self.peers.append(peer)

    def _publish(self, **body):
        self.client.force_authenticate(self.support)
        return self.client.post("/api/classes/support/availability/", {
            "starts_at": self.hour.isoformat(),
            "ends_at": (self.hour + timedelta(hours=1)).isoformat(),
            **body,
        }, format="json")

    def test_omitting_capacity_does_not_shrink_the_group(self):
        # `capacity` is optional; defaulting it to 1 here left three students overbooked on a
        # one-seat slot, with seats_left clamping to 0 so nothing ever showed it.
        r = self._publish(note="one to one")
        self.assertEqual(r.status_code, 200, r.content)
        self.slot.refresh_from_db()
        self.assertGreaterEqual(self.slot.capacity, 3)
        self.assertEqual(self.slot.note, "one to one")

    def test_shrinking_below_the_bookings_is_refused(self):
        r = self._publish(capacity=1)
        self.assertEqual(r.status_code, 400)
        self.assertIn("3 students already booked", r.json()["detail"])
        self.slot.refresh_from_db()
        self.assertEqual(self.slot.capacity, 4)   # untouched

    def test_growing_the_group_still_works(self):
        r = self._publish(capacity=6)
        self.assertEqual(r.status_code, 200, r.content)
        self.slot.refresh_from_db()
        self.assertEqual((self.slot.capacity, self.slot.seats_left), (6, 3))

    def test_shrinking_to_exactly_the_bookings_is_allowed(self):
        r = self._publish(capacity=3)
        self.assertEqual(r.status_code, 200, r.content)
        self.slot.refresh_from_db()
        self.assertEqual((self.slot.capacity, self.slot.seats_left), (3, 0))


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
