"""Attendance tests: scoring math, service, API, and Academic-ranking integration.

Validates BUSINESS-ARCHITECTURE §4 / §4.1.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from classes import attendance as att
from classes.models import Assignment, Classroom, ClassroomMembership, Submission, SubmissionReview
from classes.models_attendance import AttendanceRecord, AttendanceSession
from classes.models_ranking import AcademicWeightConfig, RankingSnapshot
from classes.ranking import service

User = get_user_model()
P, A, L, E = "PRESENT", "ABSENT", "LATE", "EXCUSED"


def _u(email):
    return User.objects.create_user(email, "secret123")


class AttendanceScoreMathTests(SimpleTestCase):
    def test_weights(self):
        self.assertEqual(att.compute_attendance_score([P, P, P, P]), 100.0)
        self.assertEqual(att.compute_attendance_score([P, L]), 75.0)       # (1+0.5)/2
        self.assertEqual(att.compute_attendance_score([P, A]), 50.0)
        self.assertEqual(att.compute_attendance_score([P, A, L, A]), round(100 * 1.5 / 4, 1))

    def test_excused_excluded_from_denominator(self):
        self.assertEqual(att.compute_attendance_score([P, E, A]), 50.0)    # counts [P, A]
        self.assertIsNone(att.compute_attendance_score([E, E]))            # all excused → None
        self.assertIsNone(att.compute_attendance_score([]))


class _ClassFixture(TestCase):
    def setUp(self):
        self.owner = _u("att_owner@t.com")
        self.classroom = Classroom.objects.create(
            name="Att", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.s1 = _u("att_s1@t.com")
        self.s2 = _u("att_s2@t.com")
        for u in (self.s1, self.s2):
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=u, role=ClassroomMembership.ROLE_STUDENT
            )

    def _session(self, day_offset=0, finalized=True):
        return AttendanceSession.objects.create(
            classroom=self.classroom, date=date(2026, 6, 1) + timedelta(days=day_offset),
            status=AttendanceSession.STATUS_FINALIZED if finalized else AttendanceSession.STATUS_OPEN,
            created_by=self.owner,
        )

    def _mark(self, session, student, status):
        return AttendanceRecord.objects.create(
            session=session, student=student, status=status, marked_by=self.owner
        )


class AttendanceServiceTests(_ClassFixture):
    def test_scores_and_detail(self):
        s_a, s_b = self._session(0), self._session(1)
        self._mark(s_a, self.s1, P); self._mark(s_b, self.s1, A)   # 50
        self._mark(s_a, self.s2, P); self._mark(s_b, self.s2, P)   # 100
        scores = att.attendance_scores_for(self.classroom, [self.s1.id, self.s2.id])
        self.assertEqual(scores[self.s1.id], 50.0)
        self.assertEqual(scores[self.s2.id], 100.0)

        detail = att.student_detail(self.classroom, self.s1)
        self.assertEqual(detail["attendance_score"], 50.0)
        self.assertEqual(detail["counted_sessions"], 2)
        self.assertEqual(len(detail["history"]), 2)

    def test_open_sessions_not_counted(self):
        open_s = self._session(0, finalized=False)
        self._mark(open_s, self.s1, A)
        self.assertIsNone(att.attendance_scores_for(self.classroom, [self.s1.id])[self.s1.id])

    def test_class_summary_series(self):
        s = self._session(0)
        self._mark(s, self.s1, P); self._mark(s, self.s2, A)
        summary = att.class_summary(self.classroom)
        self.assertEqual(summary["sessions"][0]["present_rate"], 50.0)
        self.assertEqual(len(summary["students"]), 2)


class AttendanceApiTests(_ClassFixture):
    def setUp(self):
        super().setUp()
        self.client = APIClient()

    def _url(self, suffix=""):
        return f"/api/classes/{self.classroom.id}/attendance/{suffix}"

    def test_student_cannot_create_session(self):
        self.client.force_authenticate(self.s1)
        r = self.client.post(self._url("sessions/"), {"date": "2026-06-02"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_full_marking_flow(self):
        self.client.force_authenticate(self.owner)
        r = self.client.post(self._url("sessions/"), {"date": "2026-06-02", "title": "Lesson 1"}, format="json")
        self.assertEqual(r.status_code, 201)
        sid = r.json()["id"]

        # bulk mark: s1 present, s2 excused
        r = self.client.post(self._url(f"sessions/{sid}/mark/"), {
            "records": [
                {"student_id": self.s1.id, "status": "PRESENT"},
                {"student_id": self.s2.id, "status": "EXCUSED"},
            ]}, format="json")
        self.assertEqual(r.json()["updated"], 2)

        # mark-all-present preserves the EXCUSED student
        r = self.client.post(self._url(f"sessions/{sid}/mark-all-present/"), {}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            AttendanceRecord.objects.get(session_id=sid, student=self.s2).status, "EXCUSED"
        )
        self.assertEqual(
            AttendanceRecord.objects.get(session_id=sid, student=self.s1).status, "PRESENT"
        )

        # quick correction: single record update
        r = self.client.post(self._url(f"sessions/{sid}/mark/"), {
            "records": [{"student_id": self.s1.id, "status": "LATE", "note": "bus"}]}, format="json")
        self.assertEqual(AttendanceRecord.objects.get(session_id=sid, student=self.s1).status, "LATE")

        # finalize, then it counts toward the score
        self.client.post(self._url(f"sessions/{sid}/finalize/"), {}, format="json")
        self.client.force_authenticate(self.s1)
        me = self.client.get(self._url("me/")).json()
        self.assertEqual(me["attendance_score"], 50.0)  # LATE alone = 0.5 → 50

    def test_invalid_status_ignored(self):
        self.client.force_authenticate(self.owner)
        sid = self.client.post(self._url("sessions/"), {"date": "2026-06-03"}, format="json").json()["id"]
        r = self.client.post(self._url(f"sessions/{sid}/mark/"), {
            "records": [{"student_id": self.s1.id, "status": "BOGUS"}]}, format="json")
        self.assertEqual(r.json()["updated"], 0)


class AttendanceOneSessionPerDayTests(_ClassFixture):
    """A lesson has exactly one session.

    Attendance is about to become a reward trigger (5 points a lesson), so two sessions on
    one date would each finalize independently and pay the same student twice.
    """

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _url(self, suffix=""):
        return f"/api/classes/{self.classroom.id}/attendance/{suffix}"

    def test_creating_the_same_date_twice_returns_the_first_session(self):
        first = self.client.post(self._url("sessions/"), {"date": "2026-06-04", "title": "Lesson 1"}, format="json")
        self.assertEqual(first.status_code, 201)
        again = self.client.post(self._url("sessions/"), {"date": "2026-06-04", "title": "Typed it again"}, format="json")

        self.assertEqual(again.status_code, 200)          # 200, not 201 — nothing was created
        self.assertEqual(again.json()["id"], first.json()["id"])
        self.assertEqual(again.json()["title"], "Lesson 1")   # the original marking survives
        self.assertEqual(
            AttendanceSession.objects.filter(classroom=self.classroom, date=date(2026, 6, 4)).count(), 1
        )

    def test_database_rejects_a_duplicate_session(self):
        from django.db import IntegrityError, transaction as db_transaction

        self._session(0)
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                self._session(0)


class AttendanceFinalizeIsOnceTests(_ClassFixture):
    """Finalize is the terminal transition the reward hook will hang off, so it must be
    exactly-once and must actually freeze the session."""

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.ta = _u("att_ta@t.com")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.ta, role=ClassroomMembership.ROLE_TA
        )

    def _url(self, suffix=""):
        return f"/api/classes/{self.classroom.id}/attendance/{suffix}"

    def test_second_finalize_is_a_no_op(self):
        self.client.force_authenticate(self.owner)
        session = self._session(0, finalized=False)

        first = self.client.post(self._url(f"sessions/{session.id}/finalize/"), {}, format="json")
        self.assertEqual(first.status_code, 200)
        self.assertFalse(first.json()["already_finalized"])
        session.refresh_from_db()
        stamp = session.updated_at

        second = self.client.post(self._url(f"sessions/{session.id}/finalize/"), {}, format="json")
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.json()["already_finalized"])
        session.refresh_from_db()
        # Untouched: a re-save would bump auto_now and, once rewards land, re-run the award.
        self.assertEqual(session.updated_at, stamp)
        self.assertEqual(session.status, AttendanceSession.STATUS_FINALIZED)

    def test_mark_all_present_cannot_rewrite_a_finalized_session(self):
        """The gap this closes: `mark/` checked for FINALIZED, `mark-all-present/` did not,
        so the bulk button could silently overwrite a frozen session."""
        session = self._session(0, finalized=True)
        self._mark(session, self.s1, A)

        self.client.force_authenticate(self.ta)
        r = self.client.post(self._url(f"sessions/{session.id}/mark-all-present/"), {}, format="json")

        self.assertEqual(r.status_code, 403)
        self.assertEqual(AttendanceRecord.objects.get(session=session, student=self.s1).status, A)

    def test_owner_may_still_correct_a_finalized_session(self):
        session = self._session(0, finalized=True)
        self._mark(session, self.s1, A)

        self.client.force_authenticate(self.owner)
        r = self.client.post(self._url(f"sessions/{session.id}/mark-all-present/"), {}, format="json")

        self.assertEqual(r.status_code, 200)
        self.assertEqual(AttendanceRecord.objects.get(session=session, student=self.s1).status, P)


class AttendanceOnTheLeaderboardTests(_ClassFixture):
    """Attendance is back on the Academic board — through the reward ledger, not the weights.

    Three different answers over this project's life, so the distinction matters:

    1. it fed the board through ``AcademicWeightConfig.w_attendance``, a weighted model nobody
       could explain at the board;
    2. it fed nothing, while the board was "assessment points banked since the class opened";
    3. **now**: showing up earns a `PointAward` at the rule's rate, and the board sums the
       ledger. Same visible outcome as (1), completely different mechanism — a student can be
       told "you were here five times, that is five awards" and check it.

    Pinned in both directions: attendance contributes, **and** the weight column that still
    exists on the model must not quietly bring (1) back.
    """

    def _points_for_attendance(self):
        from rewards import constants as rc
        from rewards.services import points_for

        return float(points_for(rc.EVENT_ATTENDANCE_PRESENT))

    def test_being_present_earns_points_on_the_board(self):
        s = self._session(0); self._mark(s, self.s1, P)
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        snap = RankingSnapshot.objects.get(
            classroom=self.classroom, kind="ACADEMIC", period_key="p1", student=self.s1)
        self.assertEqual(float(snap.score), self._points_for_attendance())
        self.assertEqual(snap.components["source"], "rewards")
        self.assertEqual(snap.components["awards"], 1)

    def test_a_student_who_stayed_away_earns_nothing(self):
        s = self._session(0); self._mark(s, self.s1, P)
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        snap = RankingSnapshot.objects.get(
            classroom=self.classroom, kind="ACADEMIC", period_key="p1", student=self.s2)
        self.assertEqual(float(snap.score), 0.0)

    def test_the_old_weight_config_still_changes_nothing(self):
        # `w_attendance` is dead weight on a live model. Setting it must not resurrect the
        # weighted model — the board reads the ledger and consults this config nowhere.
        cfg, _ = AcademicWeightConfig.objects.get_or_create(classroom=self.classroom)
        cfg.w_homework = 0.35; cfg.w_quiz = 0; cfg.w_classwork = 0
        cfg.w_participation = 0; cfg.w_attendance = 0.15
        cfg.save()
        s = self._session(0); self._mark(s, self.s1, P)

        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        snap = RankingSnapshot.objects.get(
            classroom=self.classroom, kind="ACADEMIC", period_key="p1", student=self.s1)
        # Exactly the attendance award, not a weighted blend of a 100% attendance score.
        self.assertEqual(float(snap.score), self._points_for_attendance())
        self.assertNotIn("category_scores", snap.components)
