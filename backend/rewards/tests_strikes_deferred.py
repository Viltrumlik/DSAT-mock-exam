"""``strikes.deferred()`` — for a bulk rewrite of registers (the lc-up history import).

Inside the block a register change only notes the student; on leaving it each noted student is
recomputed once, and a streak that resets says so in the ledger but not in the bell: months of old
lessons copied in one go must not send a student a stack of "your streak starts again" notices.
"""

from __future__ import annotations

from datetime import timedelta
from unittest import mock

from classes.models_attendance import AttendanceRecord, AttendanceSession
from rewards import strikes
from rewards.models import StrikeTransaction, StudentStrike
from rewards.tests_notifications_rewards import StrikeResetFixture, _strike_notes


class DeferredStrikesTests(StrikeResetFixture):
    def mark_in_block(self, *statuses):
        for status in statuses:
            session = AttendanceSession.objects.create(
                classroom=self.classroom, date=self.day + timedelta(days=self._next_day),
                status=AttendanceSession.STATUS_FINALIZED, created_by=self.teacher,
            )
            self._next_day += 1
            AttendanceRecord.objects.create(session=session, student=self.student, status=status, marked_by=self.teacher)

    def streak(self):
        return StudentStrike.objects.get(student=self.student).current_streak

    def test_a_reset_inside_the_block_is_ledgered_but_not_announced(self):
        self._attend("PRESENT", "PRESENT")
        with self.captureOnCommitCallbacks(execute=True):
            with strikes.deferred():
                self.mark_in_block("ABSENT")
                self.assertEqual(self.streak(), 2)  # nothing recomputed yet
        self.assertEqual(self.streak(), 0)
        self.assertTrue(StrikeTransaction.objects.filter(student=self.student, kind=StrikeTransaction.KIND_RESET).exists())
        self.assertFalse(_strike_notes(self.student).exists())

    def test_each_student_is_recomputed_once_on_leaving(self):
        with mock.patch.object(strikes, "recompute", wraps=strikes.recompute) as recompute:
            with strikes.deferred():
                self.mark_in_block("PRESENT", "PRESENT", "LATE")
                self.assertEqual(recompute.call_count, 0)
        self.assertEqual(recompute.call_count, 1)
        self.assertEqual(self.streak(), 3)

    def test_a_student_can_be_noted_by_hand(self):
        # A deleted mark fires no strike hook; the importer notes those students itself.
        self._attend("PRESENT")
        with mock.patch.object(strikes, "recompute", wraps=strikes.recompute) as recompute:
            with strikes.deferred() as pending:
                pending.add(self.student.pk)
        self.assertEqual(recompute.call_count, 1)

    def test_outside_the_block_a_reset_is_still_announced(self):
        self._attend("PRESENT", "PRESENT")
        self._attend("ABSENT")
        self.assertEqual(_strike_notes(self.student).count(), 1)
