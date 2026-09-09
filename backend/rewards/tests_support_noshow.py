"""The support-hour rule that production has never run.

The school asked, on 2026-09-09: three students book one support hour, two turn up and one
does not — what does everybody earn? ``rewards.hooks.sync_support_booking`` already answers
it: the hour is priced on the students who were actually settled HELD, so the two who came
hold **15** each (the two-head rung), not the 20 that three attendees would pay, and the one
who did not come holds nothing.

**Production has never exercised this.** As of 2026-09-09 the desk has 33 HELD and 11 NO_SHOW
bookings all time, and the number of slots that have ever had BOTH is zero. Every no-show so
far has been alone in its hour, where the "who else turned up" arithmetic cannot be wrong
because there is nobody else. So the rule the school just asked about is, in the wild,
untested — and it is the rule that decides how much every student in a group is paid.

Three things are pinned here, and the second and third are where a naive implementation
breaks:

1. **Two held, one missed → 15 / 15 / 0.** The absentee does not pay their classmates a
   bonus for a seat they did not sit in.
2. **Settling the third later raises the first two.** A teacher settles one row at a time:
   the first HELD is momentarily a party of one and would freeze at 10 if the hook only ever
   priced the row in front of it. Every settle re-prices the WHOLE hour.
3. **Correcting one back to NO_SHOW walks the others back down.** The ladder has to run in
   both directions, or a mis-click permanently overpays a group.

The no-show's award is **revoked**, not merely absent: ``services.revoke`` zeroes points and
XP and writes an audit row, which is what makes a corrected settlement recoverable. A test
that only asserted "no points" would pass against a bug that left XP standing — the exact
failure the attendance rule was rewritten to close.

This suite must not be "fixed" by editing the hook. If it goes red, the hook has regressed.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from access import constants as C
from classes import support as support_service
from classes.models import Classroom, ClassroomMembership
from classes.models_support import SupportAvailability, SupportBooking
from rewards import constants
from rewards.models import PointAward, PointAwardAudit

User = get_user_model()

#: The school's live rule, verified on production 2026-09-09: base 10, +5 a head, capped at
#: three heads — 10 / 15 / 20 / 20. Named here so a failure reads as an amount, not a magic
#: number, and so the assertions below say *which rung* they mean.
ALONE, PAIR, TRIO = 10, 15, 20


class SupportGroupNoShowTests(TestCase):
    """One hour, three students, and every way the teacher can settle it."""

    def setUp(self):
        self.admin = User.objects.create_user("ns_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.support = User.objects.create_user(
            "ns_sup@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH
        )
        self.classroom = Classroom.objects.create(
            name="Maths No-show", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.support, role=ClassroomMembership.ROLE_TA
        )
        self.students = []
        for i in range(3):
            student = User.objects.create_user(f"ns_s{i}@t.com", "secret123")
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=student,
                role=ClassroomMembership.ROLE_STUDENT,
            )
            self.students.append(student)

        # One shared hour with room for all three. Written directly rather than through
        # ``support.book`` because the booking service caps a student at one session a day
        # and refuses an hour in the past — neither of which is what this suite is about.
        starts = timezone.now() + timedelta(days=3)
        self.slot = SupportAvailability.objects.create(
            support_teacher=self.support, starts_at=starts,
            ends_at=starts + timedelta(hours=1), capacity=3,
        )
        self.bookings = [
            SupportBooking.objects.create(
                availability=self.slot, student=student, classroom=self.classroom,
                topic="Quadratics",
            )
            for student in self.students
        ]

    # ── reading the ledger ────────────────────────────────────────────────────

    def award_for(self, booking) -> PointAward | None:
        return PointAward.objects.filter(
            idempotency_key=constants.support_session_key(booking.id)
        ).first()

    def points_for(self, booking) -> int:
        award = self.award_for(booking)
        return int(award.points) if award else 0

    def settle(self, booking, status):
        return support_service.settle(booking, status, actor=self.support)

    def assert_holds(self, booking, amount, *, who: str):
        award = self.award_for(booking)
        self.assertIsNotNone(award, f"{who} has no award row at all")
        self.assertEqual(int(award.points), amount, f"{who} should hold {amount} points")

    # ── 1. the school's own example ───────────────────────────────────────────

    def test_two_held_and_one_missed_pays_the_pair_rung_not_the_trio(self):
        """The question the school asked. Two turned up, so the hour is a pair: 15 each.

        The student who did not come is not counted as a head — otherwise a group could raise
        its own rate by booking classmates who never intended to attend.
        """
        self.settle(self.bookings[0], SupportBooking.STATUS_HELD)
        self.settle(self.bookings[1], SupportBooking.STATUS_HELD)
        self.settle(self.bookings[2], SupportBooking.STATUS_NO_SHOW)

        self.assert_holds(self.bookings[0], PAIR, who="the first student who attended")
        self.assert_holds(self.bookings[1], PAIR, who="the second student who attended")
        self.assertEqual(self.points_for(self.bookings[2]), 0)

    def test_the_no_show_is_revoked_not_merely_unpaid(self):
        """Zeroed, with its XP, and audited — not left standing and not silently absent.

        A settlement can move backwards, so the row has to be recoverable in both directions.
        Asserting only "no points" would pass against a bug that left the XP behind, which is
        precisely how a mis-marked register used to poison a leaderboard for ever.
        """
        # Held first, so there is a real award to take back: the interesting case is a
        # correction, not a booking that was never paid.
        self.settle(self.bookings[2], SupportBooking.STATUS_HELD)
        award = self.award_for(self.bookings[2])
        self.assertEqual(int(award.points), ALONE)

        self.settle(self.bookings[2], SupportBooking.STATUS_NO_SHOW)

        award.refresh_from_db()
        self.assertEqual(int(award.points), 0)
        self.assertEqual(int(award.xp), 0, "a withdrawn fact takes its XP with it")
        self.assertTrue(
            PointAwardAudit.objects.filter(award=award, new_points=0).exists(),
            "the revocation must leave a trail — 'why did my points drop?' is answered from "
            "the ledger or it is not answered",
        )

    def test_a_booking_never_settled_is_paid_nothing(self):
        """The backlog, from the ledger's side. Two students settled, the third left in
        BOOKED: they hold nothing, and the pair are priced as a pair."""
        self.settle(self.bookings[0], SupportBooking.STATUS_HELD)
        self.settle(self.bookings[1], SupportBooking.STATUS_HELD)

        self.assertEqual(self.bookings[2].status, SupportBooking.STATUS_BOOKED)
        self.assertEqual(self.points_for(self.bookings[2]), 0)
        self.assert_holds(self.bookings[0], PAIR, who="the first student")
        self.assert_holds(self.bookings[1], PAIR, who="the second student")

    # ── 2. the ladder climbs when the last row is settled ─────────────────────

    def test_settling_the_third_later_raises_all_three_to_twenty(self):
        """A teacher settles one row at a time.

        The first HELD is momentarily a party of one and is priced at 10; the second has to
        go back and raise it to 15; the third raises both to 20. A hook that only priced the
        row in front of it would leave the first student on 10 for ever.
        """
        self.settle(self.bookings[0], SupportBooking.STATUS_HELD)
        self.assert_holds(self.bookings[0], ALONE, who="the only student settled so far")

        self.settle(self.bookings[1], SupportBooking.STATUS_HELD)
        self.assert_holds(self.bookings[0], PAIR, who="the first student, now one of a pair")
        self.assert_holds(self.bookings[1], PAIR, who="the second student")

        self.settle(self.bookings[2], SupportBooking.STATUS_HELD)
        for i, booking in enumerate(self.bookings):
            self.assert_holds(booking, TRIO, who=f"student {i} in a group of three")

    # ── 3. and walks back down when one is corrected ──────────────────────────

    def test_correcting_one_to_no_show_walks_the_others_back_down_to_fifteen(self):
        """The mis-click, undone. Three HELD at 20 each; the teacher realises one of them
        never came, and the other two drop to the pair rung — not left holding a group rate
        for a group that was never there."""
        for booking in self.bookings:
            self.settle(booking, SupportBooking.STATUS_HELD)
        for i, booking in enumerate(self.bookings):
            self.assert_holds(booking, TRIO, who=f"student {i} before the correction")

        self.settle(self.bookings[2], SupportBooking.STATUS_NO_SHOW)

        self.assert_holds(self.bookings[0], PAIR, who="the first student after the correction")
        self.assert_holds(self.bookings[1], PAIR, who="the second student after the correction")
        self.assertEqual(self.points_for(self.bookings[2]), 0)

    def test_the_last_no_show_leaves_nobody_paid(self):
        """All three settled HELD, then all three corrected away. Nothing is stranded."""
        for booking in self.bookings:
            self.settle(booking, SupportBooking.STATUS_HELD)
        for booking in self.bookings:
            self.settle(booking, SupportBooking.STATUS_NO_SHOW)

        for booking in self.bookings:
            award = self.award_for(booking)
            self.assertIsNotNone(award)
            self.assertEqual(int(award.points), 0)
            self.assertEqual(int(award.xp), 0)

    def test_the_ladder_stops_at_three_heads(self):
        """A fourth attendee does not make it 25. Every invitation widens the hour by a seat
        with no ceiling of its own, so without the cap a student could bring nine friends and
        mint 55 points apiece for an hour that helps nobody."""
        fourth = User.objects.create_user("ns_s3@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=fourth, role=ClassroomMembership.ROLE_STUDENT
        )
        extra = SupportBooking.objects.create(
            availability=self.slot, student=fourth, classroom=self.classroom
        )
        for booking in [*self.bookings, extra]:
            self.settle(booking, SupportBooking.STATUS_HELD)

        for booking in [*self.bookings, extra]:
            self.assert_holds(booking, TRIO, who="a student in a group of four")

    def test_one_hour_does_not_re_price_another(self):
        """The fan-out is over siblings in the SAME slot. A busy Tuesday with two group
        hours must not have one hour's attendance raise the other hour's rate."""
        starts = self.slot.starts_at + timedelta(days=1)
        other = SupportAvailability.objects.create(
            support_teacher=self.support, starts_at=starts,
            ends_at=starts + timedelta(hours=1), capacity=3,
        )
        alone = SupportBooking.objects.create(
            availability=other, student=self.students[0], classroom=self.classroom
        )

        for booking in self.bookings:
            self.settle(booking, SupportBooking.STATUS_HELD)
        self.settle(alone, SupportBooking.STATUS_HELD)

        self.assert_holds(alone, ALONE, who="the student in the one-to-one hour")
        self.assert_holds(self.bookings[0], TRIO, who="the same student in the group hour")


class SupportLadderRuleTests(TestCase):
    """The ladder itself, so a failure upstairs can be read as arithmetic or as plumbing."""

    def test_the_schools_numbers(self):
        self.assertEqual(constants.support_session_points(10, 1), ALONE)
        self.assertEqual(constants.support_session_points(10, 2), PAIR)
        self.assertEqual(constants.support_session_points(10, 3), TRIO)
        self.assertEqual(constants.support_session_points(10, 4), TRIO)

    def test_nobody_attended_earns_nothing(self):
        self.assertEqual(constants.support_session_points(10, 0), 0)

    def test_the_published_ladder_matches_what_the_hook_pays(self):
        self.assertEqual(constants.support_session_ladder(10), [ALONE, PAIR, TRIO])
