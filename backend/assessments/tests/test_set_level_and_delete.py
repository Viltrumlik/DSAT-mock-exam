"""AssessmentSet.level: subject-dependent validation, and the hardened set-delete
endpoint (blocks published/assigned sets with 409 instead of 500)."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import AssessmentSet, HomeworkAssignment
from assessments.serializers import AssessmentSetAdminWriteSerializer
from classes.models import Assignment, Classroom

User = get_user_model()


class AllowedLevelsTests(TestCase):
    def test_allowed_levels_per_subject(self):
        eng = AssessmentSet.allowed_levels_for_subject(AssessmentSet.SUBJECT_ENGLISH)
        math = AssessmentSet.allowed_levels_for_subject(AssessmentSet.SUBJECT_MATH)
        self.assertEqual(set(eng), {"junior", "middle", "senior"})
        self.assertEqual(set(math), {"foundation", "junior", "middle", "senior"})
        self.assertEqual(AssessmentSet.allowed_levels_for_subject("nope"), ())


class WriteSerializerLevelTests(TestCase):
    def _payload(self, **over):
        base = {
            "subject": "english", "title": "Set", "category": "Boundaries",
            "source": AssessmentSet.SOURCE_SATOPLAM,
        }
        base.update(over)
        return base

    def test_english_rejects_foundation(self):
        s = AssessmentSetAdminWriteSerializer(data=self._payload(level="foundation"))
        self.assertFalse(s.is_valid())
        self.assertIn("level", s.errors)

    def test_english_accepts_middle(self):
        s = AssessmentSetAdminWriteSerializer(data=self._payload(level="middle"))
        self.assertTrue(s.is_valid(), s.errors)

    def test_math_accepts_foundation(self):
        s = AssessmentSetAdminWriteSerializer(
            data=self._payload(subject="math", source=AssessmentSet.SOURCE_MATHBOOK, level="foundation")
        )
        self.assertTrue(s.is_valid(), s.errors)

    def test_blank_level_allowed_on_create(self):
        # Level is required in the UI, but blank is accepted server-side (legacy/untagged).
        s = AssessmentSetAdminWriteSerializer(data=self._payload())
        self.assertTrue(s.is_valid(), s.errors)

    def test_update_rejects_invalid_level_for_subject(self):
        author = User.objects.create_user("lvl_author@test.com", "secret123")
        inst = AssessmentSet.objects.create(
            subject="english", category="Boundaries", title="Existing", created_by=author,
        )
        s = AssessmentSetAdminWriteSerializer(inst, data={"level": "foundation"}, partial=True)
        self.assertFalse(s.is_valid())
        self.assertIn("level", s.errors)


class SetDeleteGuardTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            "del_admin@test.com", "secret123", role=acc_const.ROLE_SUPER_ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _mk_set(self, title="Draft set"):
        return AssessmentSet.objects.create(
            subject="math", category="Algebra", title=title,
            source=AssessmentSet.SOURCE_MATHBOOK, level="junior", created_by=self.admin,
        )

    def _delete(self, set_id):
        return self.client.delete(f"/api/assessments/admin/sets/{set_id}/")

    def test_delete_pristine_draft_returns_204(self):
        s = self._mk_set()
        resp = self._delete(s.id)
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertFalse(AssessmentSet.objects.filter(pk=s.id).exists())

    def test_delete_assigned_set_returns_409(self):
        s = self._mk_set("Assigned set")
        classroom = Classroom.objects.create(
            name="C", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        assignment = Assignment.objects.create(
            classroom=classroom, created_by=self.admin, title="HW",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
        )
        HomeworkAssignment.objects.create(
            classroom=classroom, assessment_set=s, assignment=assignment, assigned_by=self.admin,
        )
        resp = self._delete(s.id)
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertTrue(AssessmentSet.objects.filter(pk=s.id).exists())

    def test_force_delete_removes_assigned_set_with_attempts(self):
        from assessments.models import AssessmentAttempt, AssessmentAnswer
        s = self._mk_set("Force me")
        classroom = Classroom.objects.create(
            name="C", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        assignment = Assignment.objects.create(
            classroom=classroom, created_by=self.admin, title="HW",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
        )
        hw = HomeworkAssignment.objects.create(
            classroom=classroom, assessment_set=s, assignment=assignment,
            assigned_by=self.admin,
        )
        student = User.objects.create_user("force_student@test.com", "secret123")
        attempt = AssessmentAttempt.objects.create(homework=hw, student=student)
        AssessmentAnswer.objects.create(attempt=attempt, question_id=1, answer="B")

        # Without force: blocked.
        self.assertEqual(self._delete(s.id).status_code, 409)

        # With force: gone, along with homework + attempt + answers.
        resp = self.client.delete(f"/api/assessments/admin/sets/{s.id}/?force=true")
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertFalse(AssessmentSet.objects.filter(pk=s.id).exists())
        self.assertFalse(HomeworkAssignment.objects.filter(pk=hw.id).exists())
        self.assertFalse(AssessmentAttempt.objects.filter(pk=attempt.id).exists())
