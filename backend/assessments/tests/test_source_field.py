"""AssessmentSet.source: create-required + subject/source pairing validation."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase

from assessments.models import AssessmentSet
from assessments.serializers import AssessmentSetAdminWriteSerializer

User = get_user_model()


class AllowedSourcesTests(TestCase):
    def test_allowed_sources_per_subject(self):
        eng = AssessmentSet.allowed_sources_for_subject(AssessmentSet.SUBJECT_ENGLISH)
        math = AssessmentSet.allowed_sources_for_subject(AssessmentSet.SUBJECT_MATH)
        self.assertEqual(
            set(eng),
            {AssessmentSet.SOURCE_SQB, AssessmentSet.SOURCE_SATOPLAM, AssessmentSet.SOURCE_EXTERNAL},
        )
        self.assertEqual(
            set(math),
            {
                AssessmentSet.SOURCE_SQB,
                AssessmentSet.SOURCE_MATHBOOK,
                AssessmentSet.SOURCE_PREP_PROS,
                AssessmentSet.SOURCE_HARD_QUESTIONS,
                AssessmentSet.SOURCE_EXTERNAL,
            },
        )
        self.assertEqual(AssessmentSet.allowed_sources_for_subject("nope"), ())


class WriteSerializerSourceTests(TestCase):
    def _payload(self, **over):
        base = {"subject": "english", "title": "Set", "category": "Boundaries"}
        base.update(over)
        return base

    def test_create_requires_source(self):
        s = AssessmentSetAdminWriteSerializer(data=self._payload())
        self.assertFalse(s.is_valid())
        self.assertIn("source", s.errors)

    def test_create_rejects_source_wrong_subject(self):
        # Mathbook is a Math-only source; invalid on an English set.
        s = AssessmentSetAdminWriteSerializer(
            data=self._payload(subject="english", source=AssessmentSet.SOURCE_MATHBOOK)
        )
        self.assertFalse(s.is_valid())
        self.assertIn("source", s.errors)

    def test_create_accepts_valid_pairing(self):
        s = AssessmentSetAdminWriteSerializer(
            data=self._payload(subject="english", source=AssessmentSet.SOURCE_SATOPLAM)
        )
        self.assertTrue(s.is_valid(), s.errors)

    def test_update_does_not_require_source(self):
        author = User.objects.create_user("src_author@test.com", "secret123")
        inst = AssessmentSet.objects.create(
            subject="math", category="Algebra", title="Existing", created_by=author,
        )
        # PATCH without source is allowed (legacy sets keep blank source).
        s = AssessmentSetAdminWriteSerializer(inst, data={"title": "Renamed"}, partial=True)
        self.assertTrue(s.is_valid(), s.errors)

    def test_update_rejects_invalid_source_for_subject(self):
        author = User.objects.create_user("src_author2@test.com", "secret123")
        inst = AssessmentSet.objects.create(
            subject="math", category="Algebra", title="Existing", created_by=author,
        )
        s = AssessmentSetAdminWriteSerializer(
            inst, data={"source": AssessmentSet.SOURCE_SATOPLAM}, partial=True
        )
        # SAToplam is English-only → invalid on a Math set.
        self.assertFalse(s.is_valid())
        self.assertIn("source", s.errors)
