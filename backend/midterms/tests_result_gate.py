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

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
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

    def _grant(self, classroom):
        return ResourceAccessGrant.objects.create(
            user=self.student, scope=ResourceAccessGrant.SCOPE_RESOURCE,
            resource_type=RT_MIDTERM_V2, resource_id=self.mt.id,
            classroom=classroom, granted_by=self.teacher,
        )

    def _standalone_cert(self):
        return MidtermCertificate.objects.create(
            midterm=self.mt, student=self.student,
            flavor=MidtermCertificate.FLAVOR_STANDALONE,
            student_name="S", midterm_title="Mid", subject="MATH",
            score=650, scoring_scale="SCALE_800",
        )

    def test_ungated_is_visible(self):
        # No grant + no schedule → nothing governs release → visible on completion.
        state = midterm_results_state(self.att)
        self.assertTrue(state["results_visible"])

    def test_classroom_grant_without_schedule_is_awaiting(self):
        # THE FIX: a CLASSROOM-granted midterm with NO schedule row must still be gated —
        # keying the gate off the schedule alone leaked classroom scores before publish.
        self._grant(self.classroom)
        state = midterm_results_state(self.att)
        self.assertFalse(state["results_visible"])
        self.assertIsNone(state["certificate"])

    def test_classroom_grant_released_by_classroom_certificate(self):
        self._grant(self.classroom)
        self._legacy_cert()  # CLASSROOM-flavor cert (teacher published)
        state = midterm_results_state(self.att)
        self.assertTrue(state["results_visible"])
        self.assertIsNotNone(state["certificate"])

    def test_standalone_autocert_does_not_release_classroom(self):
        # A classroom student's stray STANDALONE auto-cert must NOT unlock their score.
        self._grant(self.classroom)
        self._standalone_cert()
        state = midterm_results_state(self.att)
        self.assertFalse(state["results_visible"])
        self.assertIsNone(state["certificate"])

    def test_standalone_grant_is_visible_on_submit(self):
        self._grant(None)  # standalone (classroom=None) → visible once completed
        state = midterm_results_state(self.att)
        self.assertTrue(state["results_visible"])

    def test_release_in_other_classroom_does_not_leak(self):
        # THE LIVE BUG: the same midterm is released in ANOTHER classroom, but THIS student's
        # classroom hasn't published. Their score must stay gated (was leaking via any()).
        self._grant(self.classroom)  # student is in self.classroom
        MidtermSchedule.objects.create(  # this classroom: NOT released
            classroom=self.classroom, midterm=self.mt, results_released=False, created_by=self.teacher,
        )
        other = Classroom.objects.create(
            name="Other", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
        )
        MidtermSchedule.objects.create(  # a DIFFERENT classroom: released
            classroom=other, midterm=self.mt, results_released=True, created_by=self.teacher,
        )
        state = midterm_results_state(self.att)
        self.assertFalse(state["results_visible"], "another classroom's release must not leak")
        self.assertIsNone(state["certificate"])

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
