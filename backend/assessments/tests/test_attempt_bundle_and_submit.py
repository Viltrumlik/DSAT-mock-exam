"""Regression tests for the student attempt runner:

- The in-progress attempt bundle must NOT leak the worked-solution
  ``explanation`` (nor correct_answer) — neither in ``set.questions`` nor in the
  top-level ``questions``.
- A focus/retry attempt (question_order = a SUBSET of active questions) must be
  able to submit; the version gate only fires for genuinely stale snapshots
  (a pinned question was removed/deactivated).
- Plus tight unit checks for NFKC normalization and zero-denominator rejection.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import UserAccess
from assessments.grading import grade_answer
from assessments.models import (
    AssessmentAnswer,
    AssessmentAttempt,
    AssessmentQuestion,
    AssessmentSet,
    HomeworkAssignment,
)
from assessments.serializers import AssessmentQuestionAdminWriteSerializer
from classes.models import Assignment, Classroom, ClassroomMembership


@override_settings(
    ASSESSMENT_MAX_ATTEMPT_LIFETIME_SECONDS=0,
    CELERY_BROKER_URL="",
    CELERY_TASK_ALWAYS_EAGER=False,
)
class AttemptBundleAndSubmitTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.teacher = User.objects.create_user(
            email="t_bundle@example.com",
            password="x",
            role=acc_const.ROLE_TEACHER,
            subject=acc_const.DOMAIN_MATH,
        )
        UserAccess.objects.create(
            user=self.teacher, subject=acc_const.DOMAIN_MATH, classroom=None, granted_by=self.teacher
        )
        self.student = User.objects.create_user(
            email="st_bundle@example.com", password="x", role=acc_const.ROLE_STUDENT, subject=""
        )

        self.classroom = Classroom.objects.create(
            name="Math class",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
            teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )

        self.aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH,
            category="algebra",
            title="Algebra set",
            created_by=self.teacher,
            is_active=True,
        )
        self.q1 = AssessmentQuestion.objects.create(
            assessment_set=self.aset,
            order=1,
            prompt="2+2?",
            question_type=AssessmentQuestion.TYPE_NUMERIC,
            correct_answer=4,
            explanation="Add two and two to get four.",
            points=1,
            is_active=True,
        )
        self.q2 = AssessmentQuestion.objects.create(
            assessment_set=self.aset,
            order=2,
            prompt="3+3?",
            question_type=AssessmentQuestion.TYPE_NUMERIC,
            correct_answer=6,
            explanation="Add three and three to get six.",
            points=1,
            is_active=True,
        )

        assignment = Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title="HW", instructions=""
        )
        self.hw = HomeworkAssignment.objects.create(
            classroom=self.classroom,
            assessment_set=self.aset,
            assignment=assignment,
            assigned_by=self.teacher,
        )

        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def _start(self, payload):
        r = self.client.post("/api/assessments/attempts/start/", payload, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        return r.data["id"]

    # ── FIX 1: no explanation leak mid-attempt ──────────────────────────────
    def test_bundle_omits_explanation_for_in_progress_attempt(self):
        attempt_id = self._start({"homework_id": self.hw.id})
        r = self.client.get(f"/api/assessments/attempts/{attempt_id}/bundle/")
        self.assertEqual(r.status_code, 200, r.content)

        # Top-level sanitized questions
        for q in r.data["questions"]:
            self.assertNotIn("explanation", q)
            self.assertNotIn("correct_answer", q)
        # Nested set.questions (the leak this test guards)
        set_questions = r.data["set"]["questions"]
        self.assertTrue(set_questions)
        for q in set_questions:
            self.assertNotIn("explanation", q)
            self.assertNotIn("correct_answer", q)

    # ── FIX 2: a focus attempt (subset) can submit ──────────────────────────
    def test_focus_subset_attempt_submits_successfully(self):
        attempt_id = self._start({"homework_id": self.hw.id, "focus_question_ids": [self.q1.id]})
        att = AssessmentAttempt.objects.get(pk=attempt_id)
        self.assertEqual(att.question_order, [self.q1.id])  # subset of active

        r = self.client.post(
            "/api/assessments/attempts/submit/", {"attempt_id": attempt_id}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIsNotNone(r.data.get("result"))

    def test_added_questions_do_not_block_submit(self):
        # Full attempt over q1+q2, then a teacher ADDS q3. The existing snapshot is
        # a subset of the (now larger) active set — submit must still succeed.
        attempt_id = self._start({"homework_id": self.hw.id})
        AssessmentQuestion.objects.create(
            assessment_set=self.aset,
            order=3,
            prompt="4+4?",
            question_type=AssessmentQuestion.TYPE_NUMERIC,
            correct_answer=8,
            points=1,
            is_active=True,
        )
        r = self.client.post(
            "/api/assessments/attempts/submit/", {"attempt_id": attempt_id}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)

    def test_stale_snapshot_still_forces_restart(self):
        # Genuinely stale: a pinned question is deactivated/removed after start.
        attempt_id = self._start({"homework_id": self.hw.id})
        att = AssessmentAttempt.objects.get(pk=attempt_id)
        self.assertEqual(set(att.question_order), {self.q1.id, self.q2.id})
        self.q2.is_active = False
        self.q2.save(update_fields=["is_active"])
        r = self.client.post(
            "/api/assessments/attempts/submit/", {"attempt_id": attempt_id}, format="json"
        )
        self.assertEqual(r.status_code, 409, r.content)


class NfkcNormalizationTests(SimpleTestCase):
    """FIX 5: full-width digits/letters from mobile IMEs fold to ASCII before grading."""

    def test_fullwidth_digits_match_numeric(self):
        # "４２" (full-width) should grade equal to short-text "42".
        self.assertTrue(
            grade_answer(question_type="short_text", correct_answer="42", answer="４２", config={})
        )

    def test_fullwidth_letters_match_short_text(self):
        self.assertTrue(
            grade_answer(question_type="short_text", correct_answer="cat", answer="ｃａｔ", config={})
        )


class FractionZeroDenominatorValidationTests(SimpleTestCase):
    """FIX 6: a zero (or zero-ish) denominator is rejected at save, not silently un-answerable."""

    def _ser(self, correct):
        return AssessmentQuestionAdminWriteSerializer(
            data={"question_type": "numeric", "prompt": "Q", "correct_answer": correct, "points": 1}
        )

    def test_zero_denominator_rejected(self):
        s = self._ser("1/0")
        self.assertFalse(s.is_valid())
        self.assertIn("correct_answer", s.errors)

    def test_zero_float_denominator_rejected(self):
        s = self._ser("3/0.0")
        self.assertFalse(s.is_valid())
        self.assertIn("correct_answer", s.errors)

    def test_valid_fraction_still_accepted(self):
        s = self._ser("1/2")
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.validated_data["correct_answer"], "1/2")
