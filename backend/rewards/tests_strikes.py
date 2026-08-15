"""Strikes: present or late keeps the run, anything else wipes it.

The rule is one sentence, but three things about it are easy to get wrong and each has a test
here: EXCUSED breaks the streak (unlike everywhere else on the platform), spending must not
change the streak the student is shown, and a correction made after finalize has to be
absorbed without the counter having to know how to unwind.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase

from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from rewards import strikes
from rewards.models import StrikeTransaction

User = get_user_model()


class StrikeFixture(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user("st_teacher@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Strike class", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        self.student = User.objects.create_user("st_student@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        )
        self.day = date(2026, 8, 1)
        self._next_day = 0

    def _attend(self, *statuses):
        """Mark a run of lessons, one per day, each on a finalized register.

        Days advance across calls rather than restarting — a classroom may hold only one
        session per date, and successive calls are meant to read as "then these lessons".
        """
        for status in statuses:
            session = AttendanceSession.objects.create(
                classroom=self.classroom, date=self.day + timedelta(days=self._next_day),
                status=AttendanceSession.STATUS_FINALIZED, created_by=self.teacher,
            )
            self._next_day += 1
            AttendanceRecord.objects.create(
                session=session, student=self.student, status=status, marked_by=self.teacher
            )
        return strikes.state(self.student)


class StreakRuleTests(StrikeFixture):
    def test_present_builds_a_streak(self):
        state = self._attend("PRESENT", "PRESENT", "PRESENT")
        self.assertEqual(state["current_streak"], 3)
        self.assertEqual(state["strikes"], 3)

    def test_late_still_counts(self):
        """Being late is still turning up — the school's rule, verbatim."""
        state = self._attend("PRESENT", "LATE", "PRESENT")
        self.assertEqual(state["current_streak"], 3)

    def test_absent_wipes_it(self):
        state = self._attend("PRESENT", "PRESENT", "ABSENT")
        self.assertEqual(state["current_streak"], 0)
        self.assertEqual(state["strikes"], 0)

    def test_excused_wipes_it_too(self):
        """Unlike attendance *scoring*, which drops EXCUSED from the denominator entirely.

        Pinned because it is the one place the platform treats EXCUSED harshly, and it is
        deliberate: the school asked for "present or late, otherwise it resets".
        """
        state = self._attend("PRESENT", "PRESENT", "EXCUSED")
        self.assertEqual(state["current_streak"], 0)

    def test_the_streak_rebuilds_after_a_break(self):
        state = self._attend("PRESENT", "ABSENT", "PRESENT", "PRESENT")
        self.assertEqual(state["current_streak"], 2)

    def test_the_best_streak_survives_the_break(self):
        state = self._attend("PRESENT", "PRESENT", "PRESENT", "ABSENT", "PRESENT")
        self.assertEqual(state["current_streak"], 1)
        self.assertEqual(state["best_streak"], 3)

    def test_an_unfinalized_register_banks_nothing(self):
        """A teacher toggles P/A/L/E while marking. A streak that moved on each toggle would
        break and rebuild itself under their cursor."""
        session = AttendanceSession.objects.create(
            classroom=self.classroom, date=self.day,
            status=AttendanceSession.STATUS_OPEN, created_by=self.teacher,
        )
        AttendanceRecord.objects.create(
            session=session, student=self.student, status="PRESENT", marked_by=self.teacher
        )
        self.assertEqual(strikes.state(self.student)["current_streak"], 0)

    def test_a_correction_after_finalize_is_absorbed(self):
        """The reason the streak is re-derived rather than incremented: a mark can change
        days later, and the counter must not have to know how to unwind."""
        self._attend("PRESENT", "PRESENT", "PRESENT")
        record = AttendanceRecord.objects.order_by("session__date")[1]
        record.status = "ABSENT"
        record.save()

        self.assertEqual(strikes.state(self.student)["current_streak"], 1)

    def test_a_reset_that_costs_nothing_writes_no_row(self):
        self._attend("ABSENT")
        self.assertEqual(StrikeTransaction.objects.count(), 0)

    def test_a_reset_that_costs_something_is_recorded(self):
        """A student who loses nine strikes to one missed lesson will ask what happened."""
        self._attend("PRESENT", "PRESENT")
        self._attend("ABSENT")   # continues the run of days

        row = StrikeTransaction.objects.get(kind=StrikeTransaction.KIND_RESET)
        self.assertEqual(row.amount, -2)
        self.assertEqual(row.balance_after, 0)


class SpendingTests(StrikeFixture):
    def test_spending_lowers_the_balance_and_not_the_streak(self):
        """The number on a student's profile is their attendance, not their shopping."""
        self._attend("PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT")

        strikes.spend(self.student, 2, reference="Notebook")
        state = strikes.state(self.student)

        self.assertEqual(state["strikes"], 3)
        self.assertEqual(state["current_streak"], 5)

    def test_spending_more_than_the_balance_is_refused(self):
        self._attend("PRESENT", "PRESENT")
        with self.assertRaises(ValidationError):
            strikes.spend(self.student, 5, reference="Bicycle")

    def test_a_student_with_no_record_cannot_spend(self):
        stranger = User.objects.create_user("st_stranger@t.com", "secret123")
        with self.assertRaises(ValidationError):
            strikes.spend(stranger, 1, reference="Anything")

    def test_a_break_wipes_the_balance_and_the_spend_together(self):
        """Use-it-or-lose-it, and no debt carried across the break: a student must not come
        back from an absence owing the shop three lessons' attendance."""
        self._attend("PRESENT", "PRESENT", "PRESENT")
        strikes.spend(self.student, 2, reference="Pen")
        self._attend("ABSENT")
        self._attend("PRESENT", "PRESENT")

        state = strikes.state(self.student)
        self.assertEqual(state["current_streak"], 2)
        self.assertEqual(state["strikes"], 2)      # not 0, and not -1

    def test_a_streak_shrinking_below_what_was_spent_floors_at_zero(self):
        """A teacher corrects one PRESENT in the middle of a run. The spend now exceeds the
        streak — it must clamp, not carry an invisible overdraft into the next lessons."""
        self._attend("PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT")
        strikes.spend(self.student, 4, reference="Big prize")

        record = AttendanceRecord.objects.order_by("session__date")[3]
        record.status = "ABSENT"
        record.save()

        state = strikes.state(self.student)
        self.assertEqual(state["current_streak"], 1)
        self.assertEqual(state["strikes"], 0)

        # And the next lesson attended is worth a full strike, not swallowed by the old spend.
        self._attend("PRESENT")
        self.assertEqual(strikes.state(self.student)["strikes"], 1)

    def test_a_refund_lands_when_the_streak_survived(self):
        self._attend("PRESENT", "PRESENT", "PRESENT")
        strikes.spend(self.student, 2, reference="Mug")

        strikes.refund(self.student, 2, reference="Cancelled")

        self.assertEqual(strikes.state(self.student)["strikes"], 3)

    def test_a_refund_after_a_reset_gives_nothing_back(self):
        """Inventing strikes the student's attendance no longer supports would make the
        streak a lie, which is the one thing it cannot be."""
        self._attend("PRESENT", "PRESENT", "PRESENT")
        strikes.spend(self.student, 2, reference="Mug")
        self._attend("ABSENT")

        self.assertIsNone(strikes.refund(self.student, 2, reference="Cancelled"))
        self.assertEqual(strikes.state(self.student)["strikes"], 0)


class PureComputationTests(TestCase):
    """`compute_streak` is pure, so the awkward shapes are cheap to state here."""

    def test_an_empty_history_is_zero(self):
        self.assertEqual(strikes.compute_streak([]), (0, 0, None))

    def test_it_counts_the_tail_not_the_longest_run(self):
        history = [
            (date(2026, 8, 1), "PRESENT"),
            (date(2026, 8, 2), "PRESENT"),
            (date(2026, 8, 3), "PRESENT"),
            (date(2026, 8, 4), "ABSENT"),
            (date(2026, 8, 5), "PRESENT"),
        ]
        current, best, last = strikes.compute_streak(history)
        self.assertEqual((current, best), (1, 3))
        self.assertEqual(last, date(2026, 8, 5))
