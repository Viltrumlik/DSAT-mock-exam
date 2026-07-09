"""Midterm result-release gate (dual identity).

A certificate is issued by the LEGACY classes app under the ``mock_exam`` FK, but the
new midterms student area reads by the ``midterm`` FK. Regression: a teacher issuing a
certificate must release the student's result even though it was written under the
legacy identity — otherwise the student is stuck on "awaiting result".

    python manage.py test midterms.tests_result_gate --settings=config.settings_test_nomigrations
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase

from classes.models import Classroom
from classes.models_certificates import MidtermCertificate
from classes.models_schedule import MidtermSchedule
from exams.models import MockExam
from midterms.access import midterm_results_state
from midterms.models import Midterm, MidtermAttempt
from midterms.tests_api import make_published_midterm

User = get_user_model()


class MidtermResultGateTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create(username="gate_t", email="gt@x.io", is_staff=True)
        self.student = User.objects.create(username="gate_s", email="gs@x.io")
        self.classroom = Classroom.objects.create(
            name="C", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
        )
        # Legacy MockExam mirrored by the new Midterm (the identity bridge).
        self.mock = MockExam.objects.create(
            title="Mid", kind=MockExam.KIND_MIDTERM,
            midterm_subject="MATH", midterm_scoring_scale=MockExam.SCALE_800,
        )
        self.mt = make_published_midterm(scale=Midterm.SCALE_800, n=4)
        self.mt.legacy_mock_exam_id = self.mock.id
        self.mt.save(update_fields=["legacy_mock_exam_id"])
        self.att = MidtermAttempt.objects.create(
            midterm=self.mt, student=self.student, score=650,
            is_completed=True, current_state=MidtermAttempt.STATE_COMPLETED,
        )

    def _schedule(self, released):
        # Written under the LEGACY identity (mock_exam), midterm FK left NULL — exactly
        # what classes/certificates_service._release_results does.
        return MidtermSchedule.objects.create(
            classroom=self.classroom, mock_exam=self.mock,
            results_released=released, created_by=self.teacher,
        )

    def _legacy_cert(self):
        return MidtermCertificate.objects.create(
            classroom=self.classroom, mock_exam=self.mock, student=self.student,
            flavor=MidtermCertificate.FLAVOR_CLASSROOM,
            student_name="S", midterm_title="Mid", subject="MATH",
            score=650, scoring_scale="SCALE_800", rank=2, cohort_size=5,
        )

    def test_ungated_is_visible(self):
        # No schedule → not classroom-gated → visible on completion.
        state = midterm_results_state(self.att)
        self.assertTrue(state["results_visible"])

    def test_gated_without_cert_is_awaiting(self):
        self._schedule(released=False)
        state = midterm_results_state(self.att)
        self.assertFalse(state["results_visible"])
        self.assertIsNone(state["certificate"])

    def test_legacy_release_shows_result_and_cert(self):
        # THE BUG: a midterm-keyed access-window row exists but is NOT released (all the
        # old midterm_id-only gate could see). The teacher's certificate issuance ran on
        # the LEGACY classes path — it released the mock_exam-keyed schedule and wrote the
        # cert under that identity. The student must now see the result + certificate.
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.mt,
            results_released=False, created_by=self.teacher,
        )
        self._schedule(released=True)  # mock_exam-keyed, released by legacy issuance
        cert = self._legacy_cert()
        state = midterm_results_state(self.att)
        self.assertTrue(state["results_visible"], "release under the legacy identity must show the result")
        self.assertIsNotNone(state["certificate"])
        self.assertEqual(state["certificate"]["code"], cert.code)
        self.assertEqual(state["certificate"]["rank"], 2)
        self.assertEqual(state["certificate"]["cohort_size"], 5)
