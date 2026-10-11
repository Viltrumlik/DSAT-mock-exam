"""The school's support attendance rules (2026-10-11).

1. **Attended late** — counts as attended, earns no XP, and the student is told why.
2. **Not coming to a booked session** — warned the first time; two within any seven days
   pause support booking for a week, with every support teacher, from the day of the second
   missed session, and the sessions already booked inside that week are cancelled.
3. **The limit leak** — a student who has used their limit cannot be put in a session by
   anyone: an invitation is held to every limit a booking of your own is.

Sessions that have to have HAPPENED (to be late to, or not come to) are written straight to
the database in the past: ``book()`` rightly refuses a slot that has started.
"""

from __future__ import annotations

from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes import support as support_service
from classes.models import Classroom, ClassroomMembership
from classes.models_support import SupportAvailability, SupportBooking
from notifications import constants as n_const
from notifications.models import Notification
from rewards.constants import support_session_key
from rewards.models import PointAward

User = get_user_model()


class AttendanceFixture(TestCase):
    def setUp(self):
        # The bell row is what these tests read. Its push is handed to Celery on commit, and
        # running the commit callbacks (which the notifications need) would otherwise try a
        # broker that a test run does not have.
        for task in (
            "notifications.tasks.send_push_for_notification.delay",
            "notifications.tasks.send_apns_for_notifications.delay",
        ):
            patcher = mock.patch(task)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = APIClient()
        self.admin = User.objects.create_user("ar_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.support = User.objects.create_user(
            "ar_sup@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH,
            first_name="Sardor",
        )
        self.support2 = User.objects.create_user(
            "ar_sup2@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH
        )
        self.student = User.objects.create_user("ar_student@t.com", "secret123", first_name="Aziza")
        self.mate = User.objects.create_user("ar_mate@t.com", "secret123", first_name="Bobur")
        self.mate2 = User.objects.create_user("ar_mate2@t.com", "secret123", first_name="Dilnoza")

        self.classroom = Classroom.objects.create(
            name="Maths Rules", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        for user in (self.student, self.mate, self.mate2):
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=user, role=ClassroomMembership.ROLE_STUDENT
            )
        for teacher in (self.support, self.support2):
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=teacher, role=ClassroomMembership.ROLE_TA
            )
        self.today = timezone.localdate()

    # ── helpers ───────────────────────────────────────────────────────────────

    def day(self, offset: int):
        return self.today + timedelta(days=offset)

    def slot_at(self, offset: int, hour: int = 10, *, teacher=None, capacity: int = 1):
        start = support_service._hour_start(self.day(offset), hour)
        slot, _ = SupportAvailability.objects.get_or_create(
            support_teacher=teacher or self.support,
            starts_at=start,
            defaults={"ends_at": start + timedelta(hours=1), "capacity": capacity},
        )
        return slot

    def seat(self, student, offset: int, hour: int = 10, *, teacher=None, invited_by=None):
        """A BOOKED row, written directly — in the past when ``offset`` is negative."""
        return SupportBooking.objects.create(
            availability=self.slot_at(offset, hour, teacher=teacher, capacity=3),
            student=student, classroom=self.classroom,
            status=SupportBooking.STATUS_BOOKED, invited_by=invited_by,
        )

    def settle(self, booking, status):
        with self.captureOnCommitCallbacks(execute=True):
            return support_service.settle(booking, status, actor=self.support)

    def miss(self, student, offset: int, hour: int = 10, **extra):
        return self.settle(self.seat(student, offset, hour, **extra), SupportBooking.STATUS_NO_SHOW)

    def told(self, user):
        return list(
            Notification.objects.filter(
                recipient=user, event=n_const.EVENT_SUPPORT_ATTENDANCE
            ).order_by("id")
        )

    def award(self, booking):
        return PointAward.objects.filter(idempotency_key=support_session_key(booking.id)).first()


# ── 1. Attended late ──────────────────────────────────────────────────────────


class AttendedLateTests(AttendanceFixture):
    def test_late_is_attended_but_earns_nothing(self):
        booking = self.settle(self.seat(self.student, -1), SupportBooking.STATUS_LATE)

        self.assertEqual(booking.status, SupportBooking.STATUS_LATE)
        self.assertIn(booking.status, SupportBooking.ATTENDED_STATUSES)
        row = self.award(booking)
        self.assertTrue(row is None or (row.points, row.xp) == (0, 0))

    def test_correcting_held_to_late_takes_the_xp_back_too(self):
        """``revoke`` and not ``award(points=0)``: XP is a high-water mark in ``award``, so a
        zero-point award would have left the HELD session's XP on the leaderboard."""
        booking = self.settle(self.seat(self.student, -1), SupportBooking.STATUS_HELD)
        self.assertGreater(self.award(booking).xp, 0)

        self.settle(booking, SupportBooking.STATUS_LATE)

        row = self.award(booking)
        self.assertEqual((row.points, row.xp), (0, 0))

    def test_a_late_classmate_still_counts_towards_the_group(self):
        """The on-time student keeps the pair rate. Docking them for somebody else's lateness
        would punish the one who did it right."""
        on_time = self.seat(self.student, -1)
        late = SupportBooking.objects.create(
            availability=on_time.availability, student=self.mate, classroom=self.classroom,
            status=SupportBooking.STATUS_BOOKED,
        )
        self.settle(on_time, SupportBooking.STATUS_HELD)
        solo = self.award(on_time).points
        self.settle(late, SupportBooking.STATUS_LATE)

        self.assertGreater(self.award(on_time).points, solo)
        row = self.award(late)
        self.assertTrue(row is None or (row.points, row.xp) == (0, 0))

    def test_the_student_is_told_why_there_is_no_xp_once(self):
        booking = self.settle(self.seat(self.student, -1), SupportBooking.STATUS_LATE)
        self.settle(booking, SupportBooking.STATUS_LATE)  # re-pressed to save a note

        notes = self.told(self.student)
        self.assertEqual(len(notes), 1)
        self.assertIn("late", notes[0].title.lower())
        self.assertIn("no XP", notes[0].title)
        self.assertEqual(notes[0].category, n_const.CATEGORY_SUPPORT)
        self.assertEqual(notes[0].link_url, "/support")

    def test_late_cannot_be_recorded_before_the_session_starts(self):
        upcoming = self.seat(self.student, 5)
        with self.assertRaises(ValidationError):
            support_service.settle(upcoming, SupportBooking.STATUS_LATE, actor=self.support)

    def test_a_late_session_is_the_teachers_record(self):
        booking = self.settle(self.seat(self.student, -1), SupportBooking.STATUS_LATE)
        with self.assertRaises(ValidationError):
            support_service.cancel(booking, actor=self.student, reason="oops")

    def test_a_late_session_may_be_rated(self):
        booking = self.settle(self.seat(self.student, -1), SupportBooking.STATUS_LATE)
        rated = support_service.rate(booking, 4)
        self.assertEqual(rated.rating, 4)

    def test_a_late_arrival_is_never_a_no_show(self):
        for offset in (-3, -1):
            self.settle(self.seat(self.student, offset), SupportBooking.STATUS_LATE)
        self.assertIsNone(support_service.booking_pause_for(self.student))
        self.assertIsNone(support_service.no_show_warning_for(self.student))

    def test_the_teacher_can_press_late_through_the_api(self):
        booking = self.seat(self.student, -1)
        self.client.force_authenticate(self.support)
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client.post(
                f"/api/classes/support/bookings/{booking.id}/settle/",
                {"status": "late"}, format="json",
            )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["status"], "LATE")


# ── 2. Not coming to a booked session ─────────────────────────────────────────


class NoShowWarningAndPauseTests(AttendanceFixture):
    def test_the_first_miss_is_a_warning(self):
        self.miss(self.student, -1)

        self.assertIsNone(support_service.booking_pause_for(self.student))
        allowance = support_service.booking_allowance(self.student)
        self.assertEqual(allowance["warning_missed"], self.day(-1).isoformat())
        self.assertEqual(allowance["warning_until"], self.day(6).isoformat())
        self.assertIsNone(allowance["paused_until"])

        notes = self.told(self.student)
        self.assertEqual(len(notes), 1)
        self.assertIn("Warning", notes[0].title)
        self.assertIn(support_service._day_label(self.day(6)), notes[0].body)

    def test_a_second_miss_within_seven_days_pauses_booking_for_a_week(self):
        self.miss(self.student, -4)
        self.miss(self.student, -1)

        pause = support_service.booking_pause_for(self.student)
        self.assertEqual(pause["from"], self.day(-1))
        self.assertEqual(pause["until"], self.day(6))
        allowance = support_service.booking_allowance(self.student)
        self.assertEqual(allowance["paused_until"], self.day(6).isoformat())
        self.assertEqual(
            allowance["paused_missed"], [self.day(-4).isoformat(), self.day(-1).isoformat()]
        )
        self.assertIsNone(allowance["warning_until"])
        # Not folded into can_book — old app builds read that as "you have sessions booked".
        self.assertTrue(allowance["can_book"])

        titles = [n.title for n in self.told(self.student)]
        self.assertEqual(len(titles), 2)
        self.assertIn("Warning", titles[0])
        self.assertIn("paused", titles[1])

    def test_six_days_apart_is_within_a_week(self):
        self.miss(self.student, -7)
        self.miss(self.student, -1)
        self.assertIsNotNone(support_service.booking_pause_for(self.student))

    def test_seven_days_apart_is_not(self):
        self.miss(self.student, -8)
        self.miss(self.student, -1)
        self.assertIsNone(support_service.booking_pause_for(self.student))
        # …but the newer miss is a fresh warning.
        self.assertEqual(
            support_service.no_show_warning_for(self.student)["missed"], self.day(-1)
        )

    def test_the_pause_runs_from_the_day_of_the_missed_session(self):
        """Recorded days late, the pause is shortened, not moved — the school's choice."""
        self.miss(self.student, -8)
        self.miss(self.student, -5)

        pause = support_service.booking_pause_for(self.student)
        self.assertEqual(pause["until"], self.day(2))

    def test_a_pause_that_has_run_out_lets_the_student_book(self):
        self.miss(self.student, -12)
        self.miss(self.student, -8)
        self.assertIsNone(support_service.booking_pause_for(self.student))
        support_service.book(self.student, self.slot_at(2))  # does not raise

    def test_a_paused_student_cannot_book_with_any_teacher(self):
        self.miss(self.student, -3)
        self.miss(self.student, -1)

        for teacher in (self.support, self.support2):
            with self.assertRaises(ValidationError) as caught:
                support_service.book(self.student, self.slot_at(2, 11, teacher=teacher))
            message = "; ".join(caught.exception.messages)
            self.assertIn("paused", message)
            self.assertIn(support_service._day_label(self.day(6)), message)

    def test_the_pause_ends_as_its_last_day_begins(self):
        """`until` is the first day they may book again — "until that same day"."""
        self.miss(self.student, -7)
        self.miss(self.student, -6)
        self.assertEqual(support_service.booking_pause_for(self.student)["until"], self.day(1))

        first_minute_back = support_service._hour_start(self.day(1), 0) + timedelta(minutes=1)
        self.assertIsNone(
            support_service.booking_pause_for(self.student, now=first_minute_back)
        )

    def test_sessions_booked_inside_the_paused_week_are_cancelled(self):
        inside = self.seat(self.student, 3, 11)
        invited_inside = self.seat(self.student, 4, 12, invited_by=self.mate)
        after = self.seat(self.student, 6, 11)  # the day booking reopens

        self.miss(self.student, -3)
        self.miss(self.student, -1)

        for row in (inside, invited_inside):
            row.refresh_from_db()
            self.assertEqual(row.status, SupportBooking.STATUS_CANCELLED)
            self.assertTrue(row.cancel_reason.startswith("Cancelled automatically"))
        after.refresh_from_db()
        self.assertEqual(after.status, SupportBooking.STATUS_BOOKED)
        self.assertIn("2 booked sessions", self.told(self.student)[-1].body)

    def test_hours_on_the_calendar_read_paused(self):
        self.miss(self.student, -3)
        self.miss(self.student, -1)

        states = {
            hour["state"]
            for entry in support_service.open_calendar_for(self.student)
            for day in entry["days"]
            for hour in day["hours"]
        }
        self.assertIn("paused", states)
        self.assertNotIn("open", states)

    def test_a_seat_a_classmate_gave_them_does_not_count(self):
        """The rule is about booking and not coming — and counting invitations would let one
        student get another paused by inviting them to hours they never agreed to."""
        self.miss(self.student, -3, invited_by=self.mate)
        self.miss(self.student, -1, invited_by=self.mate)
        self.assertIsNone(support_service.booking_pause_for(self.student))
        self.assertIsNone(support_service.no_show_warning_for(self.student))
        self.assertEqual(self.told(self.student), [])

    def test_not_attended_cannot_be_recorded_before_the_session_starts(self):
        with self.assertRaises(ValidationError):
            support_service.settle(
                self.seat(self.student, 5), SupportBooking.STATUS_NO_SHOW, actor=self.support
            )

    def test_correcting_the_miss_lifts_the_pause(self):
        self.miss(self.student, -3)
        second = self.miss(self.student, -1)
        self.assertIsNotNone(support_service.booking_pause_for(self.student))

        self.settle(second, SupportBooking.STATUS_HELD)

        self.assertIsNone(support_service.booking_pause_for(self.student))
        self.assertEqual(self.told(self.student)[-1].title, "Support booking is open again")
        support_service.book(self.student, self.slot_at(2))  # does not raise

    def test_pressing_not_attended_again_warns_once(self):
        booking = self.miss(self.student, -1)
        self.settle(booking, SupportBooking.STATUS_NO_SHOW)
        self.assertEqual(len(self.told(self.student)), 1)

    def test_a_paused_student_cannot_be_invited(self):
        self.miss(self.student, -3)
        self.miss(self.student, -1)
        host = support_service.book(self.mate, self.slot_at(2))

        with self.assertRaises(ValidationError) as caught:
            support_service.invite_member(host, self.student, actor=self.mate)
        self.assertIn("can't be booked for support right now", "; ".join(caught.exception.messages))
        self.assertNotIn(self.student, support_service.invitable_classmates(host))

    def test_a_paused_student_cannot_invite(self):
        later_seat = self.seat(self.student, 8, 11)  # booked before the pause, after its week
        self.miss(self.student, -3)
        self.miss(self.student, -1)

        with self.assertRaises(ValidationError) as caught:
            support_service.invite_member(later_seat, self.mate, actor=self.student)
        self.assertIn("paused", "; ".join(caught.exception.messages))


# ── 3. The limit leak ─────────────────────────────────────────────────────────


class InvitationsRespectEveryLimitTests(AttendanceFixture):
    def test_the_owners_chain_is_refused(self):
        """What students did: fill your own allowance, then get a classmate to invite you
        into a third hour."""
        support_service.book(self.student, self.slot_at(1))
        support_service.book(self.student, self.slot_at(2))
        host = support_service.book(self.mate, self.slot_at(3))

        with self.assertRaises(ValidationError) as caught:
            support_service.invite_member(host, self.student, actor=self.mate)
        message = "; ".join(caught.exception.messages)
        self.assertIn("Aziza", message)
        self.assertIn("2 support sessions booked", message)
        self.assertFalse(
            SupportBooking.objects.filter(
                student=self.student, availability=host.availability
            ).exists()
        )

    def test_an_invited_seat_uses_up_the_invitees_day(self):
        host = support_service.book(self.student, self.slot_at(1, 10))
        support_service.invite_member(host, self.mate, actor=self.student)

        with self.assertRaises(ValidationError) as caught:
            support_service.book(self.mate, self.slot_at(1, 14, teacher=self.support2))
        self.assertIn("that day", "; ".join(caught.exception.messages))

    def test_an_invited_seat_uses_up_the_invitees_upcoming_allowance(self):
        host1 = support_service.book(self.student, self.slot_at(1))
        host2 = support_service.book(self.student, self.slot_at(2))
        support_service.invite_member(host1, self.mate, actor=self.student)
        support_service.invite_member(host2, self.mate, actor=self.student)

        with self.assertRaises(ValidationError):
            support_service.book(self.mate, self.slot_at(3, teacher=self.support2))

    def test_the_picker_does_not_offer_students_who_would_be_refused(self):
        support_service.book(self.mate, self.slot_at(1, 9, teacher=self.support2))  # mate's day
        host = support_service.book(self.student, self.slot_at(1, 10))

        offered = support_service.invitable_classmates(host)
        self.assertNotIn(self.mate, offered)
        self.assertIn(self.mate2, offered)

    def test_the_picker_drops_a_classmate_at_the_upcoming_limit(self):
        support_service.book(self.mate, self.slot_at(2, 9, teacher=self.support2))
        support_service.book(self.mate, self.slot_at(3, 9, teacher=self.support2))
        host = support_service.book(self.student, self.slot_at(1, 10))
        self.assertNotIn(self.mate, support_service.invitable_classmates(host))

    def test_a_held_session_in_the_past_does_not_block_an_invitation(self):
        """The upcoming limit is about what a student HOLDS. A session they attended is
        behind them and holds nothing."""
        self.settle(self.seat(self.mate, -1), SupportBooking.STATUS_HELD)
        host = support_service.book(self.student, self.slot_at(1))
        guest = support_service.invite_member(host, self.mate, actor=self.student)
        self.assertEqual(guest.status, SupportBooking.STATUS_BOOKED)

    def test_a_student_cannot_cancel_a_session_that_has_started(self):
        """Cancelling a started session gave the day back — attend at 09:00, cancel, book
        again at 14:00."""
        started = self.seat(self.student, -1)
        self.client.force_authenticate(self.student)
        resp = self.client.delete(
            f"/api/classes/support/bookings/{started.id}/", {"reason": "done"}, format="json"
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        started.refresh_from_db()
        self.assertEqual(started.status, SupportBooking.STATUS_BOOKED)

    def test_the_teacher_can_still_withdraw_a_started_booking(self):
        started = self.seat(self.student, -1)
        self.client.force_authenticate(self.support)
        resp = self.client.delete(f"/api/classes/support/bookings/{started.id}/", format="json")
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_booking_a_seat_yourself_clears_who_invited_you(self):
        """Otherwise a missed session on a re-taken seat would be exempt from the no-show rule."""
        host = support_service.book(self.mate, self.slot_at(1))
        guest = support_service.invite_member(host, self.student, actor=self.mate)
        support_service.cancel(guest, actor=self.student, reason="clash")

        mine = support_service.book(self.student, host.availability)

        self.assertEqual(mine.pk, guest.pk)
        self.assertIsNone(mine.invited_by_id)
