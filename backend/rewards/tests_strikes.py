"""Strikes: present or late keeps the run, anything else wipes it.

The rule is one sentence, but four things about it are easy to get wrong and each has a test
here: EXCUSED breaks the streak (unlike everywhere else on the platform), spending must not
change the streak the student is shown, a correction made after finalize has to be absorbed
without the counter having to know how to unwind — and **the streak still waits for FINALIZE
even though points no longer do**.

That last one is the whole of :class:`TheFinalizeGateTests`. The reward overhaul moved
attendance *points* to save-time (OVERHAUL §6) and deliberately left strikes where they were,
so the two now disagree about when a lesson counts. It is a decision, not an oversight:
``strikes.recompute`` re-derives a student's entire history, zeroes ``spent_in_streak`` and
writes a student-visible ``KIND_RESET`` row, so running it on every P/A/L/E toggle would break
and rebuild a streak — and spend and refund a shop balance — under the teacher's cursor. An
idempotent per-record award survives that treatment; a re-derived history does not.
"""

from __future__ import annotations

import unittest
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase

from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from rewards import strikes
from rewards.models import StrikeTransaction
from rewards.services import balance, xp_balance

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

    def _open_session(self):
        """The next lesson, left as a draft register — a teacher part-way through marking.

        Shares ``_next_day`` with :meth:`_attend` so a draft lesson can follow a finalized run
        without colliding with the one-session-per-date constraint.
        """
        session = AttendanceSession.objects.create(
            classroom=self.classroom, date=self.day + timedelta(days=self._next_day),
            status=AttendanceSession.STATUS_OPEN, created_by=self.teacher,
        )
        self._next_day += 1
        return session

    def _mark(self, session, status):
        return AttendanceRecord.objects.create(
            session=session, student=self.student, status=status, marked_by=self.teacher
        )


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

    def test_an_unfinalized_register_does_not_move_the_streak(self):
        """A teacher toggles P/A/L/E while marking. A streak that moved on each toggle would
        break and rebuild itself under their cursor.

        Note the name: the register does not bank a *streak*. It does now bank points — see
        :class:`TheFinalizeGateTests`.
        """
        self._mark(self._open_session(), "PRESENT")
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


class TheFinalizeGateTests(StrikeFixture):
    """Points pay on save; the streak still waits for finalize.

    Every test here asserts BOTH numbers off the same register, because the interesting failure
    is not "the streak is wrong" — it is "the streak followed the points".

    The gate is stated **twice** in the source and the two are not equally load-bearing.
    ``strikes.sync_from_attendance`` and ``hooks.sync_attendance_strikes`` decline to *call*
    ``recompute`` on a draft; ``strikes._attended_history`` declines to *count* a draft even
    when it is called. Only the second is a rule — drop the first alone and nothing observable
    moves, because a recompute driven off a FINALIZED-filtered history is idempotent whatever
    woke it. So the last two tests here force a recompute by hand rather than going through a
    hook, which is what pins the filter that matters and what a backfill, the nightly
    ensure-sessions job or any future caller would do anyway.
    """

    def test_a_draft_register_pays_points_and_starts_no_streak(self):
        self._mark(self._open_session(), "PRESENT")

        self.assertEqual(balance(self.student), 5)
        self.assertEqual(strikes.state(self.student)["current_streak"], 0)
        self.assertEqual(strikes.state(self.student)["strikes"], 0)

    def test_finalizing_is_what_starts_the_streak_and_does_not_pay_again(self):
        session = self._open_session()
        self._mark(session, "PRESENT")

        session.status = AttendanceSession.STATUS_FINALIZED
        session.save(update_fields=["status"])

        self.assertEqual(strikes.state(self.student)["current_streak"], 1)
        self.assertEqual(balance(self.student), 5)   # settled once, on save; not twice

    def test_toggling_a_draft_register_moves_the_points_and_never_the_streak(self):
        """The cost the gate is paying for. An award is idempotent on its own record, so the
        points can follow every keystroke harmlessly. A recompute cannot: it would zero
        ``spent_in_streak`` and write a student-visible reset row on each toggle.
        """
        record = self._mark(self._open_session(), "PRESENT")
        for status in ("ABSENT", "PRESENT", "LATE", "PRESENT"):
            record.status = status
            record.save(update_fields=["status"])

        self.assertEqual(balance(self.student), 5)
        self.assertEqual(strikes.state(self.student)["current_streak"], 0)
        self.assertEqual(StrikeTransaction.objects.count(), 0)

    def test_a_draft_lesson_at_the_end_of_a_run_does_not_extend_it(self):
        self._attend("PRESENT", "PRESENT")
        self._mark(self._open_session(), "PRESENT")

        # Three lessons marked present, three lessons paid…
        self.assertEqual(balance(self.student), 15)
        # …and two of them counted, because only two registers are closed.
        self.assertEqual(strikes.state(self.student)["current_streak"], 2)

    def test_a_correction_on_a_draft_register_cannot_break_a_finished_run(self):
        """The dangerous direction. Points are taken back the moment the mark changes; the
        streak built from earlier finalized lessons must not move at all."""
        self._attend("PRESENT", "PRESENT", "PRESENT")
        record = self._mark(self._open_session(), "PRESENT")
        self.assertEqual(balance(self.student), 20)

        record.status = "ABSENT"
        record.save(update_fields=["status"])

        self.assertEqual(balance(self.student), 15)
        self.assertEqual(strikes.state(self.student)["current_streak"], 3)
        self.assertEqual(StrikeTransaction.objects.count(), 0)

    def test_a_recompute_forced_on_a_draft_register_still_counts_nothing(self):
        """The gate where it is actually enforced, reached without a hook.

        Every test above declines the draft one step earlier — ``sync_from_attendance`` returns
        before ``recompute`` runs — so all of them would pass unchanged if
        ``_attended_history`` stopped filtering on ``STATUS_FINALIZED``. Calling ``recompute``
        directly is what makes that mutation fail, and it is not a contrived call: the points
        for this lesson are already banked, so any caller that re-derives a student's streak
        arrives here with a paid-but-unfinalized register in front of it.
        """
        self._mark(self._open_session(), "PRESENT")

        strikes.recompute(self.student)

        self.assertEqual(balance(self.student), 5)      # paid on save…
        self.assertEqual(strikes.state(self.student)["current_streak"], 0)   # …and not counted

    def test_a_forced_recompute_cannot_let_a_draft_absence_break_a_finished_run(self):
        """The direction that costs a student something.

        A teacher opens tomorrow's register, marks this student ABSENT before the lesson has
        happened, and something re-derives the streak. Three finalized lessons must survive it,
        and no student-visible ``KIND_RESET`` row may be written for a register nobody has
        closed.
        """
        self._attend("PRESENT", "PRESENT", "PRESENT")
        self._mark(self._open_session(), "ABSENT")

        strikes.recompute(self.student)

        self.assertEqual(strikes.state(self.student)["current_streak"], 3)
        self.assertEqual(strikes.state(self.student)["strikes"], 3)
        self.assertEqual(StrikeTransaction.objects.count(), 0)


class DeletingALessonTests(StrikeFixture):
    """The new ``post_delete`` receivers reach the ledger. They do not reach the streak.

    The overhaul added ``post_delete`` for ``AttendanceRecord`` and ``AttendanceSession``
    (``hooks.py``) because save-time payment made a deleted register a source of points nothing
    could take back. Those receivers call ``revoke`` and nothing else, so after a delete the two
    counters derived from the same register disagree about which lessons exist:
    ``strikes.state`` reads a stored ``StudentStrike`` row, and only ``strikes.recompute`` — run
    from a FINALIZED *save* — ever re-derives it.

    The first test below is the measurement, and it passes: it records the disagreement rather
    than asserting it is right. The second states the rule that ought to hold and is marked
    expected-failure, because deciding what a deleted lesson does to a streak is a product call
    nobody has made. It is not a stale expectation — nothing in OVERHAUL.md covers deletes at
    all, and §6's "strikes stay FINALIZED-gated" is about *toggling* a register, not about
    destroying one.
    """

    def test_deleting_a_lesson_takes_the_points_and_leaves_the_streak_standing(self):
        """MEASURED, not endorsed. Three lessons attended, one register deleted: the ledger
        drops to two lessons' worth and the streak still says three."""
        self._attend("PRESENT", "PRESENT", "PRESENT")
        self.assertEqual((balance(self.student), xp_balance(self.student)), (15, 15))
        self.assertEqual(strikes.state(self.student)["current_streak"], 3)

        AttendanceSession.objects.order_by("-date").first().delete()

        # The reward half reconciles — that is the receiver working.
        self.assertEqual((balance(self.student), xp_balance(self.student)), (10, 10))
        self.assertEqual(AttendanceRecord.objects.filter(student=self.student).count(), 2)
        # The strike half does not. Both numbers come off the same two rows.
        self.assertEqual(strikes.state(self.student)["current_streak"], 3)
        self.assertEqual(strikes.state(self.student)["strikes"], 3)

    @unittest.expectedFailure
    def test_a_streak_should_not_outlive_the_register_it_was_derived_from(self):
        """The rule this ought to obey, left failing on purpose.

        A strike is spendable. ``strikes.spend`` deliberately does not recompute first, so
        between the delete and the next finalize a student can buy something with a lesson that
        no longer exists — and the reverse is worse: deleting the ABSENT register that broke a
        run leaves the student punished for a lesson the school has erased. It self-heals the
        next time any session of theirs is finalized, so this is a staleness window rather than
        permanent corruption, which is why it is recorded here instead of being patched into a
        test file.

        The fix is one line in each ``post_delete`` receiver — the same ``strikes.recompute``
        the finalize path already calls. A delete is not the P/A/L/E toggle §6 protects the
        streak from; it happens once, from a staff action, not on every keystroke.
        """
        self._attend("PRESENT", "PRESENT", "PRESENT")
        AttendanceSession.objects.order_by("-date").first().delete()

        self.assertEqual(strikes.state(self.student)["current_streak"], 2)

    @unittest.expectedFailure
    def test_erasing_the_absence_should_give_the_run_back(self):
        """The punishing direction of the same gap: the lesson that broke the run is deleted,
        and the student stays reset against a register that now reads PRESENT, PRESENT."""
        self._attend("PRESENT", "PRESENT")
        self._attend("ABSENT")
        self.assertEqual(strikes.state(self.student)["current_streak"], 0)

        AttendanceSession.objects.order_by("-date").first().delete()

        self.assertEqual(strikes.state(self.student)["current_streak"], 2)


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
