"""Midterm scheduling + results-release tests.

Covers the start gate (`_midterm_start_guard`), the results-release gate
(`_midterm_results_state`), the teacher control panel, and the student my-midterms list.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from exams.models import MockExam, PracticeTest, TestAttempt
from exams.views import _midterm_start_guard, _midterm_results_state

from classes.models import Classroom, ClassroomMembership
from classes.models_schedule import MidtermSchedule
from classes.certificates_service import issue_certificates

User = get_user_model()


class ScheduleFixture(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("sch_owner@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Sched Class", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.student = User.objects.create_user("sch_s@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.midterm = MockExam.objects.create(
            title="Scheduled Midterm", kind=MockExam.KIND_MIDTERM,
            midterm_subject="MATH", midterm_scoring_scale=MockExam.SCALE_100,
        )
        self.section = PracticeTest.objects.create(
            subject="MATH", label="M", title="sec", collection_name="MID", mock_exam=self.midterm
        )
        self.client = APIClient()

    def _schedule(self, **kw):
        return MidtermSchedule.objects.create(classroom=self.classroom, mock_exam=self.midterm, **kw)

    def _attempt(self, *, completed, score=80, state=None):
        return TestAttempt.objects.create(
            student=self.student, practice_test=self.section, mock_exam=self.midterm,
            score=score if completed else None, is_completed=completed,
            current_state=state or ("COMPLETED" if completed else "MODULE_1_ACTIVE"),
            completed_at=timezone.now() if completed else None,
        )


class StartGuardTests(ScheduleFixture):
    def test_unscheduled_allows_start(self):
        self.assertIsNone(_midterm_start_guard(self.student, self.midterm))

    def test_future_start_blocks_with_countdown(self):
        self._schedule(starts_at=timezone.now() + timedelta(hours=2))
        resp = _midterm_start_guard(self.student, self.midterm)
        self.assertIsNotNone(resp)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data["code"], "midterm_locked")
        self.assertIsNotNone(resp.data["available_at"])

    def test_past_start_allows(self):
        self._schedule(starts_at=timezone.now() - timedelta(minutes=5))
        self.assertIsNone(_midterm_start_guard(self.student, self.midterm))

    def test_ignore_start_opens_immediately(self):
        self._schedule(starts_at=timezone.now() + timedelta(hours=2), ignore_start=True)
        self.assertIsNone(_midterm_start_guard(self.student, self.midterm))

    def test_past_deadline_closes(self):
        self._schedule(
            starts_at=timezone.now() - timedelta(hours=3),
            deadline=timezone.now() - timedelta(hours=1),
        )
        resp = _midterm_start_guard(self.student, self.midterm)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data["code"], "midterm_closed")

    def test_completed_blocks_retake(self):
        self._schedule(starts_at=timezone.now() - timedelta(minutes=5))
        self._attempt(completed=True)
        resp = _midterm_start_guard(self.student, self.midterm)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data["code"], "midterm_completed")

    def test_active_attempt_resumes_even_when_locked(self):
        # Window closed, but an in-progress attempt may always resume.
        self._schedule(starts_at=timezone.now() + timedelta(hours=2))
        self._attempt(completed=False)
        self.assertIsNone(_midterm_start_guard(self.student, self.midterm))


class ResultsGateTests(ScheduleFixture):
    def test_unscheduled_results_visible(self):
        state = _midterm_results_state(self.student.id, self.midterm.id)
        self.assertTrue(state["results_visible"])

    def test_scheduled_hidden_until_released(self):
        self._schedule(starts_at=timezone.now() - timedelta(hours=1))
        state = _midterm_results_state(self.student.id, self.midterm.id)
        self.assertFalse(state["results_visible"])
        self.assertFalse(state["certificate"]["available"])

    def test_released_after_issue_shows_certificate(self):
        self._schedule(starts_at=timezone.now() - timedelta(hours=1))
        self._attempt(completed=True, score=90)
        issue_certificates(self.classroom, self.midterm, self.owner)
        state = _midterm_results_state(self.student.id, self.midterm.id)
        self.assertTrue(state["results_visible"])
        self.assertTrue(state["certificate"]["available"])
        self.assertIn(state["certificate"]["code"], state["certificate"]["download_url"])


class PanelAndMyMidtermsTests(ScheduleFixture):
    def _panel_url(self):
        return f"/api/classes/{self.classroom.id}/midterms/{self.midterm.id}/panel/"

    def test_panel_staff_only(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(self._panel_url()).status_code, 403)

    def test_panel_get_and_schedule_patch(self):
        self.client.force_authenticate(self.owner)
        got = self.client.get(self._panel_url())
        self.assertEqual(got.status_code, 200)
        self.assertIn("schedule", got.json())
        self.assertIn("students", got.json())

        start = (timezone.now() + timedelta(days=1)).isoformat()
        patched = self.client.patch(self._panel_url(), {"starts_at": start, "ignore_start": False}, format="json")
        self.assertEqual(patched.status_code, 200)
        self.assertTrue(patched.json()["is_before_start"])
        self.assertEqual(MidtermSchedule.objects.get(classroom=self.classroom, mock_exam=self.midterm).ignore_start, False)

    def test_my_midterms_states(self):
        # Locked (future start), student is assigned via assigned_users.
        self.midterm.assigned_users.add(self.student)
        self._schedule(starts_at=timezone.now() + timedelta(hours=3))
        self.client.force_authenticate(self.student)
        data = self.client.get("/api/classes/my-midterms/").json()["midterms"]
        self.assertEqual(len(data), 1)
        row = data[0]
        self.assertFalse(row["is_open"])
        self.assertTrue(row["is_before_start"])
        self.assertIsNotNone(row["available_at"])
        self.assertFalse(row["submitted"])
        self.assertIsNone(row["score"])

    def test_my_midterms_hides_score_until_release(self):
        self.midterm.assigned_users.add(self.student)
        self._schedule(starts_at=timezone.now() - timedelta(hours=2))
        self._attempt(completed=True, score=88)
        self.client.force_authenticate(self.student)
        row = self.client.get("/api/classes/my-midterms/").json()["midterms"][0]
        self.assertTrue(row["submitted"])
        self.assertFalse(row["results_visible"])
        self.assertIsNone(row["score"])

        issue_certificates(self.classroom, self.midterm, self.owner)
        row = self.client.get("/api/classes/my-midterms/").json()["midterms"][0]
        self.assertTrue(row["results_visible"])
        self.assertEqual(row["score"], 88)
        self.assertTrue(row["certificate"]["available"])
