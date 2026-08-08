"""The two hooks wired in this PR: attendance (5 / 3 late) and midterm (20 / 5 retake)."""

from __future__ import annotations

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase

from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from exams.models import Module, Question
from midterms.models import Midterm, MidtermAttempt, MidtermOutcome
from midterms.scoring import SCALE_100
from rewards.models import PointAward
from rewards.services import balance

User = get_user_model()
P, A, L, E = "PRESENT", "ABSENT", "LATE", "EXCUSED"


def _u(email):
    return User.objects.create_user(email, "secret123")


# ── Attendance ────────────────────────────────────────────────────────────────

class AttendanceAwardTests(TestCase):
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

    def test_present_earns_five_and_late_earns_three(self):
        s = self._session()
        AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        AttendanceRecord.objects.create(session=s, student=self.s2, status=L)

        self.assertEqual(balance(self.s1), 5)
        self.assertEqual(balance(self.s2), 3)

    def test_absent_and_excused_earn_nothing(self):
        s = self._session()
        AttendanceRecord.objects.create(session=s, student=self.s1, status=A)
        AttendanceRecord.objects.create(session=s, student=self.s2, status=E)

        self.assertEqual(balance(self.s1), 0)
        self.assertEqual(balance(self.s2), 0)
        self.assertEqual(PointAward.objects.count(), 0)   # no row at all, not a zero row

    def test_a_draft_session_banks_nothing(self):
        """A teacher toggles P/A/L/E freely while marking; paying on each toggle would let a
        mis-click mint points."""
        s = self._session(finalized=False)
        AttendanceRecord.objects.create(session=s, student=self.s1, status=P)

        self.assertEqual(balance(self.s1), 0)

    def test_finalizing_settles_the_marks_taken_while_it_was_a_draft(self):
        s = self._session(finalized=False)
        AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        AttendanceRecord.objects.create(session=s, student=self.s2, status=L)
        self.assertEqual(balance(self.s1), 0)

        s.status = AttendanceSession.STATUS_FINALIZED
        s.save(update_fields=["status"])

        self.assertEqual(balance(self.s1), 5)
        self.assertEqual(balance(self.s2), 3)

    def test_finalizing_twice_does_not_pay_twice(self):
        s = self._session(finalized=False)
        AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        for _ in range(3):
            s.status = AttendanceSession.STATUS_FINALIZED
            s.save(update_fields=["status"])

        self.assertEqual(balance(self.s1), 5)
        self.assertEqual(PointAward.objects.filter(student=self.s1).count(), 1)

    def test_correcting_present_to_absent_gives_the_points_back(self):
        """An owner may still edit a finalized session, so the award has to follow the mark
        rather than being a one-way payment."""
        s = self._session()
        record = AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        self.assertEqual(balance(self.s1), 5)

        record.status = A
        record.save(update_fields=["status"])

        self.assertEqual(balance(self.s1), 0)

    def test_correcting_back_to_present_restores_the_points(self):
        s = self._session()
        record = AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        record.status = A
        record.save(update_fields=["status"])
        record.status = P
        record.save(update_fields=["status"])

        self.assertEqual(balance(self.s1), 5)
        self.assertEqual(PointAward.objects.filter(student=self.s1).count(), 1)

    def test_present_downgraded_to_late_adjusts_rather_than_adds(self):
        s = self._session()
        record = AttendanceRecord.objects.create(session=s, student=self.s1, status=P)
        record.status = L
        record.save(update_fields=["status"])

        self.assertEqual(balance(self.s1), 3)
        self.assertEqual(PointAward.objects.filter(student=self.s1).count(), 1)

    def test_each_lesson_pays_once_per_student(self):
        for day in range(3):
            s = self._session(day=day)
            AttendanceRecord.objects.create(session=s, student=self.s1, status=P)

        self.assertEqual(balance(self.s1), 15)

    def test_the_award_records_the_classroom_it_was_earned_in(self):
        s = self._session()
        AttendanceRecord.objects.create(session=s, student=self.s1, status=P)

        a = PointAward.objects.get(student=self.s1)
        self.assertEqual(a.classroom_id, self.classroom.id)
        self.assertEqual(a.source_type, "attendance_record")


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

        self.assertEqual(balance(self.student), 20)

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

    def test_a_verdict_downgraded_to_a_fail_takes_the_points_back(self):
        mt = _midterm(pass_mark=50)
        self._sit(mt, correct=3)
        self.assertEqual(balance(self.student), 20)

        outcome = MidtermOutcome.objects.get(midterm=mt, student=self.student)
        outcome.passed = False
        outcome.save(update_fields=["passed"])

        self.assertEqual(balance(self.student), 0)

    def test_midterm_points_carry_no_classroom(self):
        """A midterm belongs to no single class, so it counts globally but not on a class
        board. Pinned because the academic leaderboard is going to read this ledger."""
        mt = _midterm(pass_mark=50)
        self._sit(mt, correct=3)

        self.assertIsNone(PointAward.objects.get(student=self.student).classroom_id)
