"""Foundation Math homework sources (2026-10-28): Math-only, and only on a set whose
primary or second level is Foundation."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase

from assessments.models import AssessmentSet
from assessments.serializers import AssessmentSetAdminWriteSerializer

User = get_user_model()

S01 = "FOUNDATION_S01"


class FoundationSourceTests(TestCase):
    def _payload(self, **over):
        base = {"subject": "math", "title": "Set", "category": "Algebra", "source": S01}
        base.update(over)
        return base

    def test_sixteen_topics_listed_for_math_only(self):
        self.assertEqual(len(AssessmentSet.FOUNDATION_SOURCES), 16)
        self.assertIn(S01, AssessmentSet.allowed_sources_for_subject("math"))
        self.assertNotIn(S01, AssessmentSet.allowed_sources_for_subject("english"))
        self.assertEqual(dict(AssessmentSet.SOURCE_CHOICES)["FOUNDATION_S21"], "S21 Circles")

    def test_foundation_set_accepts_topic(self):
        s = AssessmentSetAdminWriteSerializer(data=self._payload(level="foundation"))
        self.assertTrue(s.is_valid(), s.errors)

    def test_foundation_as_second_level_accepts_topic(self):
        s = AssessmentSetAdminWriteSerializer(
            data=self._payload(level="junior", secondary_level="foundation")
        )
        self.assertTrue(s.is_valid(), s.errors)

    def test_junior_set_rejects_topic(self):
        s = AssessmentSetAdminWriteSerializer(data=self._payload(level="junior"))
        self.assertFalse(s.is_valid())
        self.assertIn("source", s.errors)

    def test_english_rejects_topic(self):
        s = AssessmentSetAdminWriteSerializer(
            data=self._payload(subject="english", level="junior")
        )
        self.assertFalse(s.is_valid())
        self.assertIn("source", s.errors)

    def test_moving_level_off_foundation_rejects_kept_topic(self):
        author = User.objects.create_user("fnd_author@test.com", "secret123")
        inst = AssessmentSet.objects.create(
            subject="math", category="Algebra", title="S01 HW", source=S01,
            level="foundation", created_by=author,
        )
        s = AssessmentSetAdminWriteSerializer(inst, data={"level": "junior"}, partial=True)
        self.assertFalse(s.is_valid())
        self.assertIn("source", s.errors)
