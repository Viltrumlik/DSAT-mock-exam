"""Rewards producers for the notification bell: REWARD_EARNED and STRIKE_LOST.

Two properties are load-bearing here, and neither is about whether a notification appears.

**The award producer must stay silent on a re-run.** ``rewards.services.award`` is re-entrant
by design — signal receivers fire it on every save of every source row and ``settle_due_homework``
replays it across every open bundle every ten minutes. It has three branches (created, no-op,
corrected) and only two of them are news. A notification on the no-op branch would put a bell in
front of every student with an open homework every ten minutes, for ever; that is a platform-wide
incident rather than a bug, so :class:`AwardIsSilentOnARerunTests` pins it at the mechanism, not
just at the row count. Counting rows alone is not enough: ``notify``'s 60-minute dedupe window
would collapse three sends into one row and the test would pass while the platform screamed. The
assertions therefore also count the ``on_commit`` callbacks actually scheduled.

**The strike producer must not punish anybody.** ``STRIKE_LOST`` is a machine code. The standing
rule for this platform is that the student UI never uses punishing language, so
:class:`StrikeResetCopyTests` reads the sentence a fifteen-year-old actually sees and fails on any
word that frames a reset streak as a failure.

Every test wraps its trigger in ``captureOnCommitCallbacks``: both producers defer their send to
``transaction.on_commit`` so a rolled-back award or a rolled-back register cannot tell a student
something untrue. Without the wrapper the callbacks are collected and dropped, and a test would
pass while asserting nothing at all.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.test import TestCase

from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from notifications import constants as note_const
from notifications.models import Notification
from rewards import constants, strikes
from rewards.services import award

User = get_user_model()

#: Words that frame a student as having failed. The reset copy must contain none of them —
#: substring matching on purpose, so "lost"/"loses", "miss"/"missed" and "fail"/"failed" are all
#: caught by one entry each.
PUNISHING_WORDS = (
    "lost", "lose", "miss", "fail", "penal", "punish", "absent",
    "broke", "gone", "warning", "deducted", "forfeit",
)


def _student(email: str):
    return User.objects.create_user(email, "secret123")


def _rewards(user):
    return Notification.objects.filter(
        recipient=user, event=note_const.EVENT_REWARD_EARNED
    )


def _strike_notes(user):
    return Notification.objects.filter(
        recipient=user, event=note_const.EVENT_STRIKE_LOST
    )


# ── REWARD_EARNED ─────────────────────────────────────────────────────────────

class AwardIsSilentOnARerunTests(TestCase):
    """The one that matters. A re-run must schedule nothing, not merely dedupe to one row."""

    def setUp(self):
        self.student = _student("nr_rerun@t.com")
        self.key = "manual:rerun-1"

    def _award(self, points: int):
        return award(
            self.student, constants.EVENT_MANUAL,
            idempotency_key=self.key, points=points, reason="test",
        )

    def test_three_identical_awards_schedule_one_send_and_write_one_row(self):
        """The ten-minute sweep replays every settled award. Only the first is news.

        ``len(callbacks)`` is the assertion that actually protects the platform: the row count
        would read 1 even if all three sends fired, because they share a dedupe key and land
        inside the same 60-minute window.
        """
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            for _ in range(3):
                self._award(10)

        self.assertEqual(
            len(callbacks), 1,
            "the no-op re-run branch must not even schedule a send",
        )
        self.assertEqual(_rewards(self.student).count(), 1)

    def test_a_new_earning_is_announced(self):
        with self.captureOnCommitCallbacks(execute=True):
            self._award(10)

        note = _rewards(self.student).get()
        self.assertIn("10", note.title)
        self.assertEqual(note.category, note_const.CATEGORY_REWARDS)

    def test_it_links_to_the_students_own_rewards_page(self):
        """The recipient is always the earner, never a member of staff — so the path is the
        student console's, not ops'."""
        with self.captureOnCommitCallbacks(execute=True):
            self._award(10)

        self.assertEqual(_rewards(self.student).get().link_url, "/rewards")

    def test_the_dedupe_key_is_the_awards_own_idempotency_key(self):
        """So a correction collapses onto its own original instead of stacking a second line."""
        with self.captureOnCommitCallbacks(execute=True):
            self._award(10)

        self.assertEqual(_rewards(self.student).get().dedupe_key, f"reward:{self.key}")


class CorrectionDirectionTests(TestCase):
    """Points going up is news. Points going down is not, and saying so would punish."""

    def setUp(self):
        self.student = _student("nr_correct@t.com")
        self.key = "manual:correct-1"

    def _award(self, points: int):
        return award(
            self.student, constants.EVENT_MANUAL,
            idempotency_key=self.key, points=points, reason="test",
        )

    def test_a_correction_upward_tells_the_student_the_new_value(self):
        with self.captureOnCommitCallbacks(execute=True):
            self._award(5)
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            self._award(12)

        self.assertEqual(len(callbacks), 1)
        # One row, not two: the correction shares the original's dedupe key and rewrites it.
        note = _rewards(self.student).get()
        self.assertIn("12", note.title)

    def test_a_correction_downward_is_silent(self):
        """A re-grade from 90% to 60%, a PRESENT corrected to LATE. The student has nothing to
        celebrate, and telling them their points dropped is the punishing framing this UI does
        not use. The XP high-water mark makes the same judgement in the arithmetic."""
        with self.captureOnCommitCallbacks(execute=True):
            self._award(12)
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            self._award(5)

        self.assertEqual(len(callbacks), 0)
        self.assertIn("12", _rewards(self.student).get().title)

    def test_an_earning_worth_nothing_is_not_announced(self):
        """``award`` records an explicit 0 as "assessed, earned nothing" — a 0% homework, a
        midterm re-sat below the pass mark. "You earned 0 points" is noise at best."""
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            self._award(0)

        self.assertEqual(len(callbacks), 0)
        self.assertFalse(_rewards(self.student).exists())

    def test_a_zero_earning_corrected_upward_is_announced_then(self):
        """The silence above is a deferral, not a loss: the moment it becomes good news, it is
        delivered."""
        with self.captureOnCommitCallbacks(execute=True):
            self._award(0)
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            self._award(15)

        self.assertEqual(len(callbacks), 1)
        self.assertIn("15", _rewards(self.student).get().title)

    def test_a_negative_manual_adjustment_is_silent(self):
        """An admin docking somebody is a points operation. It is not an earning and it is not
        something to announce."""
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            self._award(-20)

        self.assertEqual(len(callbacks), 0)
        self.assertFalse(_rewards(self.student).exists())


class AwardNotificationIsolationTests(TestCase):
    """The send waits for the commit, and it never becomes a push."""

    def setUp(self):
        self.student = _student("nr_iso@t.com")

    def test_a_rolled_back_award_never_reaches_the_student(self):
        """``award`` runs inside a savepoint precisely so a caller can roll it back. A student
        told they earned points for an award that then vanished has read something untrue and
        cannot un-read it — Django discards callbacks registered after a rolled-back savepoint,
        and this pins that we rely on that rather than sending inline."""
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            try:
                with transaction.atomic():
                    award(
                        self.student, constants.EVENT_MANUAL,
                        idempotency_key="manual:rollback-1", points=10, reason="test",
                    )
                    raise RuntimeError("the caller changed its mind")
            except RuntimeError:
                pass

        self.assertEqual(callbacks, [])
        self.assertFalse(_rewards(self.student).exists())

    def test_reward_earned_is_in_app_only(self):
        """Points move several times a day for an active student. A platform that buzzes a phone
        for each one teaches students to switch push off — after which the homework deadline does
        not reach them either. Pinned as a constant so adding it back is a deliberate act."""
        self.assertNotIn(note_const.EVENT_REWARD_EARNED, note_const.PUSH_EVENTS)


# ── STRIKE_LOST ───────────────────────────────────────────────────────────────

class StrikeResetFixture(TestCase):
    """A classroom with one student and a register that can be filled in a day at a time."""

    def setUp(self):
        self.teacher = _student("nr_strike_teacher@t.com")
        self.classroom = Classroom.objects.create(
            name="Strike notify class", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        self.student = _student("nr_strike_student@t.com")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        )
        self.day = date(2026, 8, 1)
        self._next_day = 0

    def _attend(self, *statuses):
        """Mark a run of lessons, one per day, and run the deferred sends.

        Days advance across calls — a classroom may hold only one session per date, so successive
        calls read as "then these lessons". The ``captureOnCommitCallbacks`` wrapper is not
        optional: both the strike reset and the attendance points defer their notification to
        ``on_commit``, and without it nothing would be delivered and every assertion below would
        pass vacuously.
        """
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            for status in statuses:
                session = AttendanceSession.objects.create(
                    classroom=self.classroom, date=self.day + timedelta(days=self._next_day),
                    status=AttendanceSession.STATUS_FINALIZED, created_by=self.teacher,
                )
                self._next_day += 1
                AttendanceRecord.objects.create(
                    session=session, student=self.student, status=status,
                    marked_by=self.teacher,
                )
        return callbacks


class StrikeResetTests(StrikeResetFixture):
    def test_a_reset_that_costs_strikes_tells_the_student_once(self):
        self._attend("PRESENT", "PRESENT")
        self._attend("ABSENT")

        self.assertEqual(_strike_notes(self.student).count(), 1)

    def test_recomputing_again_does_not_tell_them_twice(self):
        """``recompute`` runs on every change to the register and re-derives the whole history,
        so it evaluates "did the streak break?" constantly. Only the transition is an event."""
        self._attend("PRESENT", "PRESENT")
        self._attend("ABSENT")

        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            strikes.recompute(self.student)

        self.assertEqual(callbacks, [])
        self.assertEqual(_strike_notes(self.student).count(), 1)

    def test_a_reset_that_costs_nothing_says_nothing(self):
        """No streak to reset. Resetting zero is arithmetic, not something that happened to
        anybody."""
        self._attend("ABSENT")

        self.assertFalse(_strike_notes(self.student).exists())

    def test_a_streak_already_spent_to_nothing_says_nothing(self):
        """The guard is on the spendable balance, not on the streak: a student who has already
        spent everything has nothing taken from them by the reset."""
        self._attend("PRESENT", "PRESENT")
        strikes.spend(self.student, 2, reference="test purchase")

        self._attend("ABSENT")

        self.assertFalse(_strike_notes(self.student).exists())

    def test_a_second_break_later_is_news_again(self):
        """Keyed on the reset row, so a genuine second reset mints a new key rather than
        collapsing onto the first one's line in the bell."""
        self._attend("PRESENT", "PRESENT")
        self._attend("ABSENT")
        self._attend("PRESENT", "PRESENT")
        self._attend("ABSENT")

        self.assertEqual(_strike_notes(self.student).count(), 2)

    def test_it_links_to_the_shop_where_strikes_are_shown(self):
        """The rewards page carries points and XP; it would not answer "where did my strikes
        go?"."""
        self._attend("PRESENT", "PRESENT")
        self._attend("ABSENT")

        self.assertEqual(_strike_notes(self.student).first().link_url, "/shop")

    def test_a_rolled_back_recompute_never_reaches_the_student(self):
        self._attend("PRESENT", "PRESENT")

        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            try:
                with transaction.atomic():
                    AttendanceRecord.objects.filter(student=self.student).update(status="ABSENT")
                    strikes.recompute(self.student)
                    raise RuntimeError("the register save failed after all")
            except RuntimeError:
                pass

        self.assertEqual(callbacks, [])
        self.assertFalse(_strike_notes(self.student).exists())


class StrikeResetCopyTests(StrikeResetFixture):
    """What a fifteen-year-old actually reads.

    ``STRIKE_LOST`` is the event code, not the sentence. The standing rule for this platform is
    that the student UI never uses punishing language, so these assertions are on the words
    themselves rather than on the fact that a row exists.
    """

    def _note(self):
        self._attend("PRESENT", "PRESENT")
        self._attend("ABSENT")
        return _strike_notes(self.student).get()

    def test_the_copy_contains_no_punishing_word(self):
        note = self._note()
        text = f"{note.title} {note.body}".lower()
        for word in PUNISHING_WORDS:
            self.assertNotIn(word, text, f"punishing word {word!r} in: {text!r}")

    def test_it_says_the_streak_starts_again_rather_than_that_it_was_taken_away(self):
        note = self._note()
        self.assertIn("again", note.title.lower())

    def test_it_names_what_reset_and_what_starts_the_next_run(self):
        """The streak counter only ever shows the current number, so without this the strikes a
        student had banked simply vanish between one page load and the next."""
        note = self._note()
        self.assertIn("2", note.body)
        self.assertIn("next lesson", note.body.lower())

    def test_the_staff_ledger_row_keeps_its_plainer_wording(self):
        """The gentle copy is for the student. The ``StrikeTransaction`` is a record for whoever
        is staring at a ledger, and softening that would make it harder to read, not kinder."""
        from rewards.models import StrikeTransaction

        self._note()
        row = StrikeTransaction.objects.get(kind=StrikeTransaction.KIND_RESET)
        self.assertIn("missed lesson", row.reference.lower())
