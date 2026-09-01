"""Every receiver in ``rewards.hooks`` — what fires it, what it pays, and what takes it back.

There are eleven: two on the attendance register's saves, two on its deletes, one on a midterm
verdict, four on the things a homework bundle can contain, one on a support booking and one on
a survey response. This module used to cover the first two areas only. It now covers all
eleven, because the overhaul moved the rule under several of them at once.

The three rules that moved, and what pins them here:

* **Attendance pays on SAVE, not on FINALIZE** (OVERHAUL §6). The register is paid
  provisionally and corrected afterwards, where before it was confirmed and then paid once.
* **A withdrawn fact takes its XP with it** (§6). ``revoke`` zeroes ``xp`` alongside
  ``points``, and that is the only thing that makes save-time payment recoverable after a
  **Mark all present** press. Every correction test below asserts BOTH numbers — a test that
  checked points alone would pass against exactly the bug this change exists to prevent.
* **Homework settles at 100% before the deadline, at the deadline otherwise, and never for
  later work** (§2); it pays proportionally (§1); and classwork is never settled at all (§7).

Three things to know before adding a test here.

``award`` and ``revoke`` swallow every exception and log. A broken hook does not raise, does
not fail a request and shows up only as a ``logger.exception`` line — so **every assertion is
on ``PointAward`` rows**, never on a return value and never on a status code.

``TestCase`` does not run ``transaction.on_commit`` callbacks. All four homework receivers
defer to one, so a homework test without ``captureOnCommitCallbacks(execute=True)`` silently
exercises nothing and passes anyway.

``TestCase`` never COMMITS either, and one receiver fails only at commit — see
:class:`UserDeletionCascadeTests`, which is a ``TransactionTestCase`` for that reason and no
other.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from assessments.models import (
    AssessmentAttempt,
    AssessmentQuestion,
    AssessmentResult,
    AssessmentSet,
    HomeworkAssignment,
)
from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from classes.models_attendance import AttendanceRecord, AttendanceSession
from classes.models_support import SupportAvailability, SupportBooking
from exams.models import Module, PracticeTest, Question, TestAttempt
from midterms.models import Midterm, MidtermAttempt, MidtermOutcome
from midterms.scoring import SCALE_100
from rewards import constants
from rewards.models import PointAward, PointAwardAudit
from rewards.services import balance, xp_balance
from surveys.models import Survey, SurveyResponse
from vocabulary.models import (
    VocabHomework,
    VocabSection,
    VocabSet,
    VocabSetItem,
    VocabStudySession,
    VocabWord,
)

User = get_user_model()
P, A, L, E = "PRESENT", "ABSENT", "LATE", "EXCUSED"


def _u(email):
    return User.objects.create_user(email, "secret123")


def _paid(student) -> tuple[int, int]:
    """``(points, xp)``. Asserted as a pair throughout, because after the overhaul the two can
    legitimately disagree — a downgrade lowers points and leaves XP — and the bugs worth
    catching move exactly one of them."""
    return balance(student), xp_balance(student)


# ── Attendance ────────────────────────────────────────────────────────────────

class AttendanceFixture(TestCase):
    """A two-student register. Carries no tests of its own so the three suites below do not
    re-run each other's."""

    def setUp(self):
        self.owner = _u("hk_owner@t.com")
        self.classroom = Classroom.objects.create(
            name="Att", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        self.s1, self.s2 = _u("hk_s1@t.com"), _u("hk_s2@t.com")
        for u in (self.s1, self.s2):
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=u, role=ClassroomMembership.ROLE_STUDENT
            )

    def _session(self, *, finalized=True, day=0):
        return AttendanceSession.objects.create(
            classroom=self.classroom, date=date(2026, 6, 1) + timedelta(days=day),
            status=(
                AttendanceSession.STATUS_FINALIZED if finalized
                else AttendanceSession.STATUS_OPEN
            ),
            created_by=self.owner,
        )


class AttendanceAwardTests(AttendanceFixture):
    def test_present_earns_five_and_late_earns_three(self):
        s = self._session()
        AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        AttendanceRecord.objects.create(session=s, student=self.s2, status=L)

        self.assertEqual(_paid(self.s1), (5, 5))
        self.assertEqual(_paid(self.s2), (3, 3))

    def test_absent_and_excused_earn_nothing(self):
        s = self._session()
        AttendanceRecord.objects.create(session=s, student=self.s1, status=A)
        AttendanceRecord.objects.create(session=s, student=self.s2, status=E)

        self.assertEqual(balance(self.s1), 0)
        self.assertEqual(balance(self.s2), 0)
        self.assertEqual(PointAward.objects.count(), 0)   # no row at all, not a zero row

    def test_a_mark_on_a_draft_register_pays_immediately(self):
        """The rule that moved (OVERHAUL §6): credit lands when the mark is saved.

        This test asserted the opposite until the overhaul — a draft register banked nothing
        until finalize. The school's instruction is that a student marked present at 09:05 sees
        the 5 points then, not whenever the teacher gets round to finalizing, which in practice
        is often never.
        """
        s = self._session(finalized=False)
        AttendanceRecord.objects.create(session=s, student=self.s1, status=P)

        self.assertEqual(_paid(self.s1), (5, 5))

    def test_finalizing_a_register_that_already_paid_changes_nothing(self):
        """Finalize is now a reconciliation pass, not the payment path.

        It re-runs every mark so a record whose own award write lost a race is settled, and
        because ``award`` writes nothing when nothing moved, the common case leaves the ledger
        untouched down to the audit table.
        """
        s = self._session(finalized=False)
        AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        AttendanceRecord.objects.create(session=s, student=self.s2, status=L)
        self.assertEqual(_paid(self.s1), (5, 5))
        self.assertEqual(_paid(self.s2), (3, 3))
        audit_rows = PointAwardAudit.objects.count()

        s.status = AttendanceSession.STATUS_FINALIZED
        s.save(update_fields=["status"])

        self.assertEqual(_paid(self.s1), (5, 5))
        self.assertEqual(_paid(self.s2), (3, 3))
        self.assertEqual(PointAward.objects.filter(student=self.s1).count(), 1)
        self.assertEqual(PointAwardAudit.objects.count(), audit_rows)

    def test_finalizing_twice_does_not_pay_twice(self):
        s = self._session(finalized=False)
        AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        for _ in range(3):
            s.status = AttendanceSession.STATUS_FINALIZED
            s.save(update_fields=["status"])

        self.assertEqual(_paid(self.s1), (5, 5))
        self.assertEqual(PointAward.objects.filter(student=self.s1).count(), 1)

    def test_correcting_present_to_absent_gives_back_the_points_and_the_xp(self):
        """The correction path is most of what save-time payment is: pay first, take it back
        when the register is fixed.

        **The XP half is the load-bearing half.** XP used to be a permanent high-water mark, so
        under save-time payment one mis-mark granted XP that no correction could ever reach —
        the teacher fixed the points and the board stayed wrong for ever.
        """
        s = self._session()
        record = AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        self.assertEqual(_paid(self.s1), (5, 5))

        record.status = A
        record.save(update_fields=["status"])

        self.assertEqual(_paid(self.s1), (0, 0))

    def test_correcting_back_to_present_restores_the_points_and_the_xp(self):
        s = self._session()
        record = AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        record.status = A
        record.save(update_fields=["status"])
        self.assertEqual(_paid(self.s1), (0, 0))

        record.status = P
        record.save(update_fields=["status"])

        self.assertEqual(_paid(self.s1), (5, 5))
        self.assertEqual(PointAward.objects.filter(student=self.s1).count(), 1)

    def test_present_downgraded_to_late_lowers_the_points_and_keeps_the_xp(self):
        """The other side of the XP rule, and the reason it is worded as it is: a student who
        turned up late *did* turn up. The fact got smaller, it was not withdrawn, so
        ``award``'s ``max(previous_xp, …)`` holds and only the points move."""
        s = self._session()
        record = AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        record.status = L
        record.save(update_fields=["status"])

        self.assertEqual(_paid(self.s1), (3, 5))
        self.assertEqual(PointAward.objects.filter(student=self.s1).count(), 1)

    def test_finalizing_re_creates_an_award_that_went_missing(self):
        """What the session receiver is *for*, now that it is no longer the payment path.

        Its own docstring calls it a reconciliation pass — it re-runs every mark so a record
        whose award write lost a race or failed transiently is settled. Every other test on
        this path passes just as happily against a receiver that does nothing, because the
        record hook has already paid. This one does not: the award is removed behind the ORM
        first, so only a receiver that genuinely re-walks the register can put it back.
        """
        s = self._session(finalized=False)
        AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        PointAward.objects.filter(student=self.s1).delete()
        self.assertEqual(_paid(self.s1), (0, 0))

        s.status = AttendanceSession.STATUS_FINALIZED
        s.save(update_fields=["status"])

        self.assertEqual(_paid(self.s1), (5, 5))

    def test_each_lesson_pays_once_per_student(self):
        for day in range(3):
            s = self._session(day=day)
            AttendanceRecord.objects.create(session=s, student=self.s1, status=P)

        self.assertEqual(_paid(self.s1), (15, 15))

    def test_the_award_records_the_classroom_it_was_earned_in(self):
        s = self._session()
        AttendanceRecord.objects.create(session=s, student=self.s1, status=P)

        a = PointAward.objects.get(student=self.s1)
        self.assertEqual(a.classroom_id, self.classroom.id)
        self.assertEqual(a.source_type, "attendance_record")


class MarkAllPresentTests(AttendanceFixture):
    """The exact press the XP rule change exists for.

    ``POST .../mark-all-present/`` writes a PRESENT row for the entire roster with no
    confirmation dialogue. Under save-time payment that pays every absentee instantly, so the
    only question that matters is whether correcting one of them puts the student back to
    where they started — in *both* currencies.
    """

    def _mark_all_present(self, session):
        """What the endpoint does: an upsert of PRESENT over every active member."""
        for member in ClassroomMembership.objects.filter(
            classroom=self.classroom, role=ClassroomMembership.ROLE_STUDENT,
            status__in=ClassroomMembership.NON_REMOVED_STATUSES,
        ):
            AttendanceRecord.objects.update_or_create(
                session=session, student_id=member.user_id,
                defaults={"status": P, "marked_by": self.owner},
            )

    def test_correcting_one_student_leaves_them_with_no_points_and_no_xp(self):
        s = self._session(finalized=False)
        self._mark_all_present(s)
        self.assertEqual(_paid(self.s1), (5, 5))
        self.assertEqual(_paid(self.s2), (5, 5))

        absentee = AttendanceRecord.objects.get(session=s, student=self.s2)
        absentee.status = A
        absentee.save(update_fields=["status"])

        # The whole point: 0 and 0, not 0 points beside 5 XP nobody can take back.
        self.assertEqual(_paid(self.s2), (0, 0))
        # And the student who really was there is untouched by the correction.
        self.assertEqual(_paid(self.s1), (5, 5))

    def test_the_ledger_can_answer_why_the_xp_dropped(self):
        """"Why did my XP go down?" has to be answerable from the audit table alone — which is
        why the revocation records ``previous_xp`` → 0 rather than leaving a reader to infer
        it from a points row."""
        s = self._session(finalized=False)
        self._mark_all_present(s)
        absentee = AttendanceRecord.objects.get(session=s, student=self.s2)
        absentee.status = A
        absentee.save(update_fields=["status"])

        award_row = PointAward.objects.get(student=self.s2)
        trail = PointAwardAudit.objects.filter(award=award_row).order_by("id").last()
        self.assertEqual((trail.previous_points, trail.new_points), (5, 0))
        self.assertEqual((trail.previous_xp, trail.new_xp), (5, 0))


class AttendanceDeletionTests(AttendanceFixture):
    """The two ``post_delete`` receivers — the only ones in the app, and new in this overhaul.

    The register is the one reward source staff routinely *delete* rather than correct: a
    session opened on the wrong date, a duplicate created by two teachers at once, a class
    rebuilt. Without these receivers the points stayed paid with nothing left to explain them,
    and no re-run of any hook could find them to take back.
    """

    def test_deleting_a_mark_takes_its_points_and_its_xp_back(self):
        s = self._session()
        record = AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        self.assertEqual(_paid(self.s1), (5, 5))

        record.delete()

        self.assertEqual(_paid(self.s1), (0, 0))
        # Zeroed, not deleted: the student's history must not silently disagree with their
        # balance.
        self.assertEqual(PointAward.objects.filter(student=self.s1).count(), 1)

    def test_deleting_a_mark_on_a_draft_register_takes_its_points_back_too(self):
        """A draft register now holds real money, which is exactly why these receivers cannot
        be gated on FINALIZED the way the session's save hook still is.

        The commonest delete on the platform is a half-marked session opened on the wrong date
        and thrown away before anyone finalizes it. Under save-time payment that session has
        already paid.
        """
        s = self._session(finalized=False)
        record = AttendanceRecord.objects.create(session=s, student=self.s1, status=L)
        self.assertEqual(_paid(self.s1), (3, 3))

        record.delete()

        self.assertEqual(_paid(self.s1), (0, 0))

    def test_deleting_a_lesson_takes_every_mark_on_it_with_it(self):
        """A cascade normally deletes children with one raw ``DELETE`` that signals nothing.
        Registering a ``post_delete`` listener for ``AttendanceRecord`` is what makes
        ``Collector.can_fast_delete`` fall back to the per-row loop — so this test is really
        asserting that the cascade still reaches the ledger."""
        s = self._session()
        AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        AttendanceRecord.objects.create(session=s, student=self.s2, status=L)
        self.assertEqual(_paid(self.s1), (5, 5))
        self.assertEqual(_paid(self.s2), (3, 3))

        s.delete()

        self.assertEqual(_paid(self.s1), (0, 0))
        self.assertEqual(_paid(self.s2), (0, 0))

    def test_a_mark_removed_behind_the_orm_is_swept_up_when_the_lesson_goes(self):
        """The session receiver is the reconciliation pass for rows the record receiver never
        saw: a raw ``DELETE``, a data migration, or anything removed before that receiver
        existed. Driven by the awards, because the records are the thing that is gone."""
        s = self._session()
        record = AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        self.assertEqual(_paid(self.s1), (5, 5))

        with connection.cursor() as cursor:
            cursor.execute(
                f"DELETE FROM {AttendanceRecord._meta.db_table} WHERE id = %s", [record.id]
            )
        self.assertEqual(_paid(self.s1), (5, 5))   # nothing has reached it yet

        s.delete()

        self.assertEqual(_paid(self.s1), (0, 0))

    def test_deleting_a_lesson_that_paid_nothing_writes_nothing(self):
        """The sweep sits on a delete path, so a re-run has to be free: it is scoped to awards
        that still carry something, and finds none here."""
        s = self._session()
        AttendanceRecord.objects.create(session=s, student=self.s1, status=A)
        self.assertEqual(PointAward.objects.count(), 0)

        s.delete()

        self.assertEqual(PointAward.objects.count(), 0)
        self.assertEqual(PointAwardAudit.objects.count(), 0)


class UserDeletionCascadeTests(TransactionTestCase):
    """Deleting a USER who holds attendance awards. **A ``TransactionTestCase``, and that is the
    whole point of the class.**

    The bug it pins is a *deferred* foreign key, and a deferred FK is only evaluated at COMMIT.
    Every other test in this module is a ``TestCase``, which wraps the test in an atomic block
    it rolls back and never commits — so the constraint is never checked, the delete appears to
    succeed, and the test is green whether the bug is present or not. That is the exact shape of
    a false green: the assertion is real, the thing it asserts about never runs. Running in
    autocommit costs a table truncate per test and is the only way to make the database answer.

    **What used to happen.** ``User.delete()`` cascades into ``AttendanceRecord``, into
    ``PointAward`` (its only cascading FK into the ledger) and into ``PointAwardAudit``, and the
    collector fast-deletes the audit rows first. The ``post_delete`` receiver on each mark then
    called ``revoke``, which INSERTs a fresh ``PointAwardAudit`` row pointing at a ``PointAward``
    the same cascade was about to remove. Django declares that FK ``DEFERRABLE INITIALLY
    DEFERRED``, so nothing objected until the transaction committed — which lands *outside* the
    receiver's ``try``, outside ``revoke``'s savepoint and outside every swallow in
    ``services``. Deleting a student simply raised, and the "an award never raises into its
    caller" invariant could not save it: by then the award code had long since returned.

    ``hooks._award_dies_with_this_delete`` is the fix, and it is a real fix rather than a dodge:
    the student's entire ledger is being deleted by the same statement, so there is no award
    left to take back and nobody left to take it from. (``transaction.on_commit`` would also
    escape the FK and would be wrong — the register is corrected inside teacher requests that
    read the balance back, and a deferred revoke leaves a deleted lesson still paid.)

    Both sides of that guard are pinned here. Skipping too eagerly is the mirror-image bug — the
    register is the one reward source staff routinely delete, so a guard that also swallowed an
    ordinary mark deletion would leave points paid for lessons nobody attended, silently and on
    the commonest path there is.

    **Measured, so nobody has to take the first paragraph on trust.** With
    ``_award_dies_with_this_delete`` forced to ``False`` — a stand-in for someone deleting the
    guard — the user-delete test below raised ``django.db.utils.IntegrityError: FOREIGN KEY
    constraint failed`` on 3 of 3 runs while the other two tests stayed green; with the guard in
    place, 3 of 3 clean. It is a real regression test, not a description of one.
    """

    def setUp(self):
        self.owner = _u("hk_del_owner@t.com")
        self.classroom = Classroom.objects.create(
            name="Cascade", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        self.student = _u("hk_del_s@t.com")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT,
        )

    def _mark(self, *, day, status):
        session = AttendanceSession.objects.create(
            classroom=self.classroom, date=date(2026, 6, 1) + timedelta(days=day),
            status=AttendanceSession.STATUS_FINALIZED, created_by=self.owner,
        )
        return AttendanceRecord.objects.create(
            session=session, student=self.student, status=status
        )

    def _assert_the_database_is_intact(self):
        """Ask the database, not the ORM.

        ``delete()`` returning without an exception is not evidence here: the failure was raised
        by the COMMIT that follows it, so a test that only checked the call would have missed
        the entire bug. On sqlite this runs ``PRAGMA foreign_key_check`` over every table and
        raises ``IntegrityError`` on a dangling row; on PostgreSQL it forces every deferred
        constraint to be evaluated immediately.
        """
        connection.check_constraints()

    def test_deleting_a_student_who_holds_attendance_awards_commits_cleanly(self):
        self._mark(day=0, status=P)
        self._mark(day=1, status=L)
        self.assertEqual(_paid(self.student), (8, 8))
        student_id = self.student.pk

        # No ``assertRaises``, no ``captureOnCommitCallbacks``: this is autocommit, so the
        # cascade's own atomic block commits as ``delete()`` returns, and the FK is checked
        # there. Before the guard this line raised an IntegrityError naming the audit table.
        self.student.delete()

        self._assert_the_database_is_intact()
        # The ledger went with the student, which is why there was nothing to revoke. Asserted
        # on rows rather than on ``balance()`` because the student object no longer has a pk.
        self.assertEqual(PointAward.objects.filter(student_id=student_id).count(), 0)
        self.assertEqual(
            PointAwardAudit.objects.filter(award__student_id=student_id).count(), 0
        )
        self.assertEqual(AttendanceRecord.objects.filter(student_id=student_id).count(), 0)

    def test_deleting_students_in_bulk_commits_cleanly_too(self):
        """The same delete as above arriving as a queryset, which is how ops removes users.

        Worth its own test because the guard cannot read it the same way: a queryset ``origin``
        carries no instance to compare a ``student_id`` against, so it is answered from
        ``origin.model`` alone. That reads as a broad "any user queryset is fatal" and is exact —
        the only route from a user to an ``AttendanceRecord`` is the record's own ``student`` FK
        (``marked_by`` and ``created_by`` are SET_NULL, ``Classroom.created_by`` is PROTECT), so
        a user cascade can never reach a mark belonging to somebody else.
        """
        self._mark(day=0, status=P)
        self.assertEqual(_paid(self.student), (5, 5))
        student_id = self.student.pk

        User.objects.filter(pk=student_id).delete()

        self._assert_the_database_is_intact()
        self.assertEqual(PointAward.objects.filter(student_id=student_id).count(), 0)

    def test_deleting_a_lone_mark_still_revokes_its_award(self):
        """The other side of the guard, kept here rather than only in the ``TestCase`` suite so
        that "the delete commits" and "the delete still pays back" are proved under the same
        autocommit conditions.

        Nothing about this delete touches the student, so the award row outlives it and there is
        a live award to zero. It is also the ordinary case by volume — a mark fixed by removing
        it, a session opened on the wrong date — so a guard that misfired here would be a
        confiscation-in-reverse on the busiest path in the register.
        """
        record = self._mark(day=0, status=P)
        self.assertEqual(_paid(self.student), (5, 5))

        record.delete()

        self._assert_the_database_is_intact()
        self.assertEqual(_paid(self.student), (0, 0))
        # Zeroed, not deleted: the student is still here, so their history must still explain
        # their balance.
        self.assertEqual(PointAward.objects.filter(student=self.student).count(), 1)


# ── Midterm ───────────────────────────────────────────────────────────────────

def _midterm(*, mtype=Midterm.TYPE_MIDTERM, pass_mark=50, parent=None, n=4):
    module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=25)
    for i in range(n):
        Question.objects.create(
            module=module, question_type="MATH", question_text=f"Q{i}",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers="a", score=10, order=i,
        )
    return Midterm.objects.create(
        title="MT", subject=Midterm.MATH, scoring_scale=SCALE_100, midterm_type=mtype,
        pass_mark=pass_mark, retake_of=parent, question_module=module, is_published=True,
    )


class MidtermAwardTests(TestCase):
    def setUp(self):
        self.student = _u("hk_mt@t.com")

    def _sit(self, midterm, *, correct):
        qs = list(midterm.questions())
        answers = {str(q.id): ("a" if i < correct else "b") for i, q in enumerate(qs)}
        attempt = MidtermAttempt.objects.create(
            midterm=midterm, student=self.student, answers=answers
        )
        attempt.start_attempt()
        attempt.submit()
        attempt.complete()
        return attempt

    def test_passing_a_midterm_earns_twenty(self):
        mt = _midterm(pass_mark=50)
        self._sit(mt, correct=3)   # 75 >= 50

        self.assertEqual(_paid(self.student), (20, 20))

    def test_a_score_exactly_on_the_pass_mark_earns_the_full_award(self):
        mt = _midterm(pass_mark=50)
        self._sit(mt, correct=2)   # 50 — the mark is inclusive

        self.assertEqual(balance(self.student), 20)

    def test_failing_earns_nothing(self):
        mt = _midterm(pass_mark=50)
        self._sit(mt, correct=1)   # 25 < 50

        self.assertEqual(balance(self.student), 0)
        self.assertEqual(PointAward.objects.count(), 0)

    def test_passing_a_retake_midterm_earns_five(self):
        first = _midterm(pass_mark=50)
        retake = _midterm(mtype=Midterm.TYPE_RETAKE, pass_mark=50, parent=first)
        self._sit(retake, correct=3)

        self.assertEqual(balance(self.student), 5)

    def test_re_recording_the_same_verdict_does_not_pay_twice(self):
        """``record_for`` is an update_or_create that the backfill command also calls."""
        mt = _midterm(pass_mark=50)
        attempt = self._sit(mt, correct=3)
        for _ in range(3):
            MidtermOutcome.record_for(attempt)

        self.assertEqual(balance(self.student), 20)
        self.assertEqual(PointAward.objects.count(), 1)

    def test_a_verdict_downgraded_to_a_fail_takes_back_the_points_and_the_xp(self):
        """A re-score that turns a pass into a fail is a **withdrawn** fact, not a smaller one:
        the student did not pass. So this goes through ``revoke`` and the XP goes with it —
        the same rule as a PRESENT corrected to ABSENT, and new in this overhaul."""
        mt = _midterm(pass_mark=50)
        self._sit(mt, correct=3)
        self.assertEqual(_paid(self.student), (20, 20))

        outcome = MidtermOutcome.objects.get(midterm=mt, student=self.student)
        outcome.passed = False
        outcome.save(update_fields=["passed"])

        self.assertEqual(_paid(self.student), (0, 0))

    def test_midterm_points_carry_no_classroom(self):
        """A midterm belongs to no single class, so it counts globally but not on a class
        board. Pinned because the academic leaderboard is going to read this ledger."""
        mt = _midterm(pass_mark=50)
        self._sit(mt, correct=3)

        self.assertIsNone(PointAward.objects.get(student=self.student).classroom_id)


# ── Homework: the four item receivers, and the gate they all converge on ──────

class HomeworkHookFixture(TestCase):
    """One published homework carrying nothing yet; each test attaches what it needs.

    Every builder that writes a source row does so inside ``captureOnCommitCallbacks`` —
    ``_recompute`` defers to ``transaction.on_commit`` so the assessment it was woken by is
    actually GRADED by the time the bundle is read, and ``TestCase`` never runs those callbacks
    on its own.

    Each builder **returns the captured callbacks**, and the tests that assert "no award was
    written" check that list is non-empty first. That is what separates "the gate declined" from
    "the receiver never fired": an assertion that a row does not exist passes just as happily
    against a hook that was deleted.
    """

    def setUp(self):
        self.teacher = _u("hk_hw_t@t.com")
        self.classroom = Classroom.objects.create(
            name="Bundle", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        self.student = _u("hk_hw_s@t.com")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.assignment = self.make_assignment()
        self.section = VocabSection.objects.create(title="Bank", slug="hk-bank")

    # ── builders ──────────────────────────────────────────────────────────────

    def make_assignment(self, **kw):
        kw.setdefault("title", "Week 1")
        kw.setdefault("category", Assignment.CATEGORY_HOMEWORK)
        return Assignment.objects.create(
            classroom=self.classroom, status=Assignment.STATUS_PUBLISHED,
            created_by=self.teacher, **kw,
        )

    def add_assessment(self, assignment=None, *, title="Set", questions=2):
        aset = AssessmentSet.objects.create(title=title, created_by=self.teacher)
        for i in range(questions):
            AssessmentQuestion.objects.create(
                assessment_set=aset, order=i, prompt=f"Q{i}",
                question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE,
                choices=[{"id": "A", "text": "a"}, {"id": "B", "text": "b"}],
                correct_answer="A", points=1,
            )
        return HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=aset,
            assignment=assignment or self.assignment, assigned_by=self.teacher,
        )

    def grade(self, homework, percent, *, execute=True):
        """Write a graded full-length attempt — the row ``_on_assessment_result_saved`` hangs
        off. Returns the captured on-commit callbacks so a caller can pin the deferral."""
        order = list(homework.assessment_set.questions.values_list("id", flat=True))
        with self.captureOnCommitCallbacks(execute=execute) as callbacks:
            attempt = AssessmentAttempt.objects.create(
                homework=homework, student=self.student,
                status=AssessmentAttempt.STATUS_GRADED,
                submitted_at=timezone.now(), question_order=order,
            )
            AssessmentResult.objects.create(
                attempt=attempt, score_points=percent, max_points=100, percent=percent
            )
        return callbacks

    def add_vocab(self, assignment=None, *, words=4):
        vset = VocabSet.objects.create(section=self.section, title="Vocab set")
        for i in range(words):
            word = VocabWord.objects.create(
                section=self.section, word=f"w{i}", definition=f"d{i}"
            )
            VocabSetItem.objects.create(vocab_set=vset, word=word, order=i)
        return VocabHomework.objects.create(
            classroom=self.classroom, assignment=assignment or self.assignment,
            vocab_set=vset, assigned_by=self.teacher,
        )

    def study(self, link, mode, *, accuracy, distinct_words):
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            VocabStudySession.objects.create(
                user=self.student, vocab_set=link.vocab_set, homework=link, mode=mode,
                accuracy=accuracy, correct_count=distinct_words, total_count=distinct_words,
                distinct_words=distinct_words, completed_at=timezone.now(),
            )
        return callbacks

    def add_pastpaper(self, assignment=None):
        assignment = assignment or self.assignment
        test = PracticeTest.objects.create(
            subject="MATH", title="PP", skip_default_modules=True
        )
        assignment.practice_test_ids = [test.id]
        assignment.save(update_fields=["practice_test_ids"])
        return test

    def sit(self, test):
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            TestAttempt.objects.create(
                practice_test=test, student=self.student, score=1200,
                is_completed=True, current_state=TestAttempt.STATE_COMPLETED,
                completed_at=timezone.now(),
            )
        return callbacks

    def hand_in(self, assignment=None):
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            Submission.objects.create(
                assignment=assignment or self.assignment, student=self.student,
                status=Submission.STATUS_SUBMITTED, submitted_at=timezone.now(),
            )
        return callbacks

    def homework_award(self):
        return PointAward.objects.filter(
            student=self.student, event=constants.EVENT_HOMEWORK
        ).first()


class HomeworkReceiverTests(HomeworkHookFixture):
    """One test per entry point. Each asserts the *proportional* figure, because the receiver
    firing at all and the bundle being priced correctly are the two ways this can break."""

    def test_grading_an_assessment_settles_the_bundle(self):
        homework = self.add_assessment()
        self.grade(homework, 80)

        # Proportional, not banded: 15 × 80% = 12. The old rule paid a flat 10 for anything
        # in 80–99 and nothing at all below 60.
        self.assertEqual(_paid(self.student), (12, 12))

    def test_a_bundle_under_sixty_percent_is_still_paid(self):
        """The retired 60% floor, stated as a test so it cannot creep back: "at the deadline,
        whatever percent they reached is what they get"."""
        homework = self.add_assessment()
        self.grade(homework, 40)

        self.assertEqual(_paid(self.student), (6, 6))

    def test_finishing_a_vocabulary_run_settles_the_bundle(self):
        link = self.add_vocab(words=4)

        self.study(link, VocabStudySession.MODE_TEST, accuracy=100.0, distinct_words=4)

        # One mode of four, answered perfectly over every word: 100 × 1.0 coverage ÷ 4 modes
        # = 25% of the set, and the set is the whole bundle. 15 × 25% = 3.75 → 4.
        self.assertEqual(_paid(self.student), (4, 4))

    def test_a_farmed_vocabulary_run_is_discounted_by_its_coverage(self):
        """Speed only reports the prompts answered before its 60-second clock expires, so two
        of twenty words answered correctly stores ``accuracy = 100``. Coverage is what stops
        that being worth a full quarter of the set."""
        link = self.add_vocab(words=4)

        self.study(link, VocabStudySession.MODE_SPEED, accuracy=100.0, distinct_words=1)

        # 100 × 0.25 coverage ÷ 4 modes = 6.25% of the bundle → 15 × 6.25% = 0.9375 → 1.
        self.assertEqual(_paid(self.student), (1, 1))

    def test_finishing_a_pastpaper_section_settles_the_bundle(self):
        test = self.add_pastpaper()

        self.sit(test)

        # SAT content stays binary — every targeted section sat, so 100%.
        self.assertEqual(_paid(self.student), (15, 15))

    def test_handing_work_in_settles_the_bundle(self):
        self.assignment.allow_file_upload = True
        self.assignment.save(update_fields=["allow_file_upload"])

        self.hand_in()

        # A hand-in is binary and deliberately not gated on being marked: a student must not
        # lose points waiting on a teacher's backlog.
        self.assertEqual(_paid(self.student), (15, 15))

    def test_the_bundle_is_a_weighted_mean_over_its_items(self):
        """The school's worked example: one assessment at 95 beside one vocabulary set."""
        homework = self.add_assessment()
        link = self.add_vocab(words=4)
        for mode, _ in VocabStudySession.MODE_CHOICES:
            self.study(link, mode, accuracy=100.0, distinct_words=4)
        self.grade(homework, 95)

        # 47.5 + 50 = 97.5% → 15 × 97.5% = 14.625 → 15.
        self.assertEqual(balance(self.student), 15)
        award_row = self.homework_award()
        self.assertEqual(award_row.classroom_id, self.classroom.id)
        self.assertEqual(award_row.source_type, "assignment")
        self.assertEqual(award_row.source_id, self.assignment.id)

    def test_the_settlement_waits_for_the_commit(self):
        """``_recompute`` defers on purpose. ``grade_attempt`` writes the result and only then
        flips the attempt to GRADED, both inside one atomic block — a receiver that recomputed
        inline would read the attempt as still SUBMITTED and pay a perfect homework 0.

        Stated as a test because a homework test that forgets ``captureOnCommitCallbacks``
        exercises nothing and passes anyway.
        """
        homework = self.add_assessment()

        callbacks = self.grade(homework, 100, execute=False)

        self.assertTrue(callbacks)
        self.assertIsNone(self.homework_award())
        for callback in callbacks:
            callback()
        self.assertEqual(_paid(self.student), (15, 15))

    def test_only_one_award_however_many_receivers_fire(self):
        """Four entry points, one bundle, one row — keyed on
        ``homework:<assignment>:<student>`` rather than on whatever finished."""
        homework = self.add_assessment()
        self.assignment.allow_file_upload = True
        self.assignment.save(update_fields=["allow_file_upload"])
        test = self.add_pastpaper()
        link = self.add_vocab(words=4)

        self.grade(homework, 100)
        self.hand_in()
        self.sit(test)
        for mode, _ in VocabStudySession.MODE_CHOICES:
            self.study(link, mode, accuracy=100.0, distinct_words=4)

        self.assertEqual(
            PointAward.objects.filter(
                student=self.student, event=constants.EVENT_HOMEWORK
            ).count(),
            1,
        )
        self.assertEqual(_paid(self.student), (15, 15))


class HomeworkTimingGateTests(HomeworkHookFixture):
    """§2 — the gate every item receiver converges on.

        no deadline                  → settle live
        deadline before it was set   → no window, so no deadline: settle live
        before the deadline, 100%    → settle now
        before the deadline, < 100%  → write NOTHING AT ALL
        after the deadline           → settle as of the deadline
    """

    def _with_deadline(self, offset, *, assigned=None):
        """Give the homework a deadline ``offset`` from now, and optionally back-date when it
        was set to ``assigned`` from now.

        **The ``assigned`` half is not decoration, and leaving it out silently tests something
        else.** ``Assignment.created_at`` is ``auto_now_add``, so an assignment built by a test
        exists from *now*; moving only ``due_at`` into the past therefore produces a homework
        that was already overdue the instant it was created, which is the journals-carrier shape
        ``homework._scoring_cutoff`` deliberately refuses to treat as a deadline at all. A
        "post-deadline" fixture built that way lands in the escape hatch, is scored live, and
        reads as though the cutoff were being ignored. Ordering matters, so any test about a
        deadline that has PASSED has to say when the work was set:
        ``created_at < due_at < now``.

        ``auto_now_add`` also dictates *how*: Django stamps that column on insert and ignores
        whatever ``create()`` or ``save()`` was given for it, so a queryset ``.update()`` —
        which writes the column without going through the model — is the only way to move it.
        ``recompute_bundle`` re-reads the row at commit time and sees the new value; the
        in-memory copy is refreshed only because this class's own assertions read it.

        Both timestamps are derived from a single ``now``, so equal offsets give exactly equal
        timestamps — which is what lets the escape-hatch test below sit precisely on the
        boundary instead of near it.
        """
        now = timezone.now()
        self.assignment.due_at = now + offset
        self.assignment.save(update_fields=["due_at"])
        if assigned is not None:
            Assignment.objects.filter(pk=self.assignment.pk).update(created_at=now + assigned)
            self.assignment.refresh_from_db(fields=["created_at"])

    def test_a_perfect_bundle_settles_the_moment_it_is_finished(self):
        self._with_deadline(timedelta(days=1))
        homework = self.add_assessment()

        self.grade(homework, 100)

        self.assertEqual(_paid(self.student), (15, 15))

    def test_a_part_finished_bundle_before_its_deadline_writes_no_row_at_all(self):
        """Not an optimisation — the reason is XP.

        XP is a high-water mark, so an interim award written at whatever the bundle is worth
        mid-week banks that XP permanently. The deadline figure could then only lower the
        points, and the board would stay wrong. So there is no row: not a zero row, not a
        provisional one.
        """
        self._with_deadline(timedelta(days=1))
        first, second = self.add_assessment(title="A"), self.add_assessment(title="B")

        callbacks = self.grade(first, 100)

        # The receiver fired and ran — it is the GATE that declined, not a hook that never
        # woke up. Without this line the assertion below would pass just as happily against a
        # receiver that was never registered.
        self.assertTrue(callbacks)
        self.assertIsNone(self.homework_award())
        self.assertEqual(_paid(self.student), (0, 0))

        # …and once the bundle is genuinely complete it settles without waiting for the sweep.
        self.grade(second, 100)
        self.assertEqual(_paid(self.student), (15, 15))

    def test_work_done_after_the_deadline_never_enters_the_arithmetic(self):
        """A hook firing days late used to raise the award. Now it settles **as of** the
        deadline: every kind carries a completion timestamp, so post-deadline work simply
        never enters the sum — which is what makes the re-running sweep idempotent.

        The homework is back-dated to a week ago so it had a real window that has since closed
        (``created_at < due_at < now``). Without that it would be an assignment that was overdue
        the moment it existed, which the gate reads as having no usable deadline — a different
        rule, pinned by the test below.
        """
        self._with_deadline(timedelta(days=-1), assigned=timedelta(days=-7))
        homework = self.add_assessment()

        self.grade(homework, 100)   # sat today, a day after it was due

        award_row = self.homework_award()
        self.assertIsNotNone(award_row)   # settled, explicitly, at nothing
        self.assertEqual((award_row.points, award_row.xp), (0, 0))
        self.assertEqual(_paid(self.student), (0, 0))

    def test_a_deadline_that_predates_its_own_assignment_is_scored_live(self):
        """``homework._scoring_cutoff``: a ``due_at`` at or before ``created_at`` is not a
        deadline, because it bounds no window in which any work could have been done.

        This is the journals carrier, not a hypothetical. ``journals.delivery`` mints a homework
        assignment whose ``due_at`` comes from the LESSON'S PLANNED DATE and never floors it at
        now — deliberately, so releasing lesson 5 a week late does not shorten its deadline to
        the next lesson after today. A class running behind schedule is therefore handed an
        Assignment already overdue the instant it is created. Read as a real deadline, the
        scoring window ``[created_at, due_at]`` is empty, every item filters to nothing, and the
        whole class is settled at 0% for work they were never given a moment to do — then
        re-settled at 0% every ten minutes for seven days by the sweep. Scored live, the student
        who does the work today is paid for it.

        Clamping ``as_of`` up to ``created_at`` is the obvious alternative and pays the same
        zero, because the window is still empty. Fixing the mint site instead is not enough
        either: every carrier already minted would keep paying nothing.

        The two timestamps are set exactly EQUAL rather than merely inverted, because equality
        is the case an off-by-one gets wrong — ``_scoring_cutoff`` keeps the cutoff only when
        ``as_of > created_at``, and a ``>=`` there would send this bundle back to 0 while a
        strictly-past ``due_at`` would still pass.
        """
        self._with_deadline(timedelta(days=-1), assigned=timedelta(days=-1))
        homework = self.add_assessment()

        self.grade(homework, 80)   # today — long after a "deadline" that never opened

        # Settled live and in full, exactly as a deadline-less bundle: 15 × 80% = 12. Not 0, and
        # not withheld pending the sweep either — there is no deadline to wait for. (The bundle
        # is under 100%, so a gate that mistook this for a real future deadline would write no
        # row at all, and one that mistook it for a passed deadline would write a 0.)
        self.assertEqual(_paid(self.student), (12, 12))


class ClassworkIsNeverSettledTests(HomeworkHookFixture):
    """§7 — classwork pays only by a teacher's hand.

    The carrier is an ordinary PUBLISHED ``classes.Assignment`` minted by ``journals.delivery``,
    so before the category check existed every journal item shared with a class already paid
    homework points nobody decided to give. These receivers still fire for it; the gate is what
    declines.
    """

    def test_a_hand_in_on_classwork_pays_nothing(self):
        classwork = self.make_assignment(
            title="Lesson 4", category=Assignment.CATEGORY_CLASSWORK, allow_file_upload=True,
        )

        callbacks = self.hand_in(classwork)

        # Identical to ``test_handing_work_in_settles_the_bundle``, which pays 15, in every
        # respect but the category — and the receiver demonstrably ran.
        self.assertTrue(callbacks)
        self.assertEqual(PointAward.objects.filter(student=self.student).count(), 0)

    def test_a_graded_assessment_on_classwork_pays_nothing(self):
        classwork = self.make_assignment(
            title="Lesson 5", category=Assignment.CATEGORY_CLASSWORK
        )
        homework = self.add_assessment(classwork, title="In-class set")

        callbacks = self.grade(homework, 100)

        self.assertTrue(callbacks)
        self.assertEqual(PointAward.objects.filter(student=self.student).count(), 0)


# ── Support teacher ───────────────────────────────────────────────────────────

class SupportBookingHookTests(TestCase):
    def setUp(self):
        self.teacher = _u("hk_sup_t@t.com")
        self.student = _u("hk_sup_s@t.com")
        self.classroom = Classroom.objects.create(
            name="Support", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        starts = timezone.now() + timedelta(days=1)
        self.slot = SupportAvailability.objects.create(
            support_teacher=self.teacher, starts_at=starts,
            ends_at=starts + timedelta(hours=1),
        )
        self.booking = SupportBooking.objects.create(
            availability=self.slot, student=self.student, classroom=self.classroom,
        )

    def _settle(self, status):
        self.booking.status = status
        self.booking.save(update_fields=["status"])

    def test_booking_a_slot_earns_nothing(self):
        """On HELD, not on booking: a student who books and never turns up has not been
        helped, and paying at booking time makes the calendar the cheapest points on the
        platform."""
        self.assertEqual(self.booking.status, SupportBooking.STATUS_BOOKED)
        self.assertEqual(PointAward.objects.count(), 0)

    def test_a_session_confirmed_as_held_earns_ten(self):
        self._settle(SupportBooking.STATUS_HELD)

        self.assertEqual(_paid(self.student), (10, 10))
        award_row = PointAward.objects.get(student=self.student)
        self.assertEqual(award_row.classroom_id, self.classroom.id)
        self.assertEqual(award_row.source_type, "support_booking")
        self.assertEqual(award_row.source_id, self.booking.id)

    def test_correcting_a_held_session_to_a_no_show_takes_back_both(self):
        """A teacher settling the wrong row is the case this exists for. The session did not
        happen, so it is a withdrawn fact and the XP goes with the points."""
        self._settle(SupportBooking.STATUS_HELD)
        self.assertEqual(_paid(self.student), (10, 10))

        self._settle(SupportBooking.STATUS_NO_SHOW)

        self.assertEqual(_paid(self.student), (0, 0))

    def test_re_settling_it_as_held_restores_both(self):
        self._settle(SupportBooking.STATUS_HELD)
        self._settle(SupportBooking.STATUS_CANCELLED)
        self.assertEqual(_paid(self.student), (0, 0))

        self._settle(SupportBooking.STATUS_HELD)

        self.assertEqual(_paid(self.student), (10, 10))
        self.assertEqual(PointAward.objects.filter(student=self.student).count(), 1)


# ── Survey ────────────────────────────────────────────────────────────────────

class SurveyHookTests(TestCase):
    def setUp(self):
        self.staff = _u("hk_srv_staff@t.com")
        self.student = _u("hk_srv_s@t.com")
        self.survey = Survey.objects.create(
            title="How is it going?", status=Survey.STATUS_PUBLISHED, created_by=self.staff,
        )
        self.response = SurveyResponse.objects.create(
            survey=self.survey, student=self.student
        )

    def _set_status(self, status):
        self.response.status = status
        self.response.submitted_at = (
            timezone.now() if status == SurveyResponse.STATUS_SUBMITTED else None
        )
        self.response.save(update_fields=["status", "submitted_at"])

    def test_a_half_finished_response_earns_nothing(self):
        self.assertEqual(self.response.status, SurveyResponse.STATUS_IN_PROGRESS)
        self.assertEqual(PointAward.objects.count(), 0)

    def test_submitting_earns_forty_and_carries_no_classroom(self):
        """A survey is sent by the school, not by a class: attributing it to one would put it
        on that class's board and nobody else's."""
        self._set_status(SurveyResponse.STATUS_SUBMITTED)

        self.assertEqual(balance(self.student), 40)
        award_row = PointAward.objects.get(student=self.student)
        self.assertIsNone(award_row.classroom_id)
        self.assertEqual(award_row.source_type, "survey_response")

    def test_a_survey_pays_points_and_no_xp(self):
        """SURVEY spent a while inside XP and the school took it back out (2026-09-01,
        migration 0009): at 40 points one questionnaire was worth two midterm passes on the
        board, and answering a form is not evidence of having learned anything.

        The lever is ``RewardRule.grants_xp``, which is data — so this asserts the school's
        current decision, not a law of the system.
        """
        self._set_status(SurveyResponse.STATUS_SUBMITTED)

        self.assertEqual(_paid(self.student), (40, 0))

    def test_withdrawing_a_response_takes_back_the_points(self):
        self._set_status(SurveyResponse.STATUS_SUBMITTED)
        self.assertEqual(_paid(self.student), (40, 0))

        self._set_status(SurveyResponse.STATUS_IN_PROGRESS)

        self.assertEqual(_paid(self.student), (0, 0))

    def test_re_saving_a_submitted_response_does_not_pay_twice(self):
        """Keyed on the response, which is unique per (survey, student) — so a survey pays once
        no matter how the row is touched afterwards."""
        for _ in range(3):
            self._set_status(SurveyResponse.STATUS_SUBMITTED)

        self.assertEqual(balance(self.student), 40)
        self.assertEqual(PointAward.objects.filter(student=self.student).count(), 1)
