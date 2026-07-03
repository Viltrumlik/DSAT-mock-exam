"""assignment-options: class-subject filtering + assessment `source` + `classroom_subject`,
and the attachment_urls object shape (url/file_name/content_type/size)."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import AssessmentSet
from classes.models import Assignment, Classroom, ClassroomMembership
from classes.serializers import AssignmentSerializer

User = get_user_model()


class AssignmentOptionsSubjectFilterTests(TestCase):
    def setUp(self):
        # super_admin ⇒ WILDCARD perms ⇒ practice library is NOT subject-scoped, so the
        # only subject filter exercised is the new one in assignment_options.
        self.admin = User.objects.create_user(
            "ao_admin@test.com", "secret123", role=acc_const.ROLE_SUPER_ADMIN,
        )
        self.classroom = Classroom.objects.create(
            name="Eng Class",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.admin, role=ClassroomMembership.ROLE_ADMIN
        )
        self.eng_set = AssessmentSet.objects.create(
            subject="english", category="Boundaries", title="Eng Set",
            source=AssessmentSet.SOURCE_SATOPLAM, created_by=self.admin,
        )
        self.math_set = AssessmentSet.objects.create(
            subject="math", category="Algebra", title="Math Set",
            source=AssessmentSet.SOURCE_MATHBOOK, created_by=self.admin,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _options(self):
        resp = self.client.get(f"/api/classes/{self.classroom.id}/assignment-options/")
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    def test_classroom_subject_in_payload(self):
        self.assertEqual(self._options()["classroom_subject"], Classroom.SUBJECT_ENGLISH)

    def test_only_class_subject_assessment_sets_with_source(self):
        data = self._options()
        titles = {a["title"] for a in data["assessment_sets"]}
        self.assertIn("Eng Set", titles)
        self.assertNotIn("Math Set", titles)  # math set filtered out for an English class
        for a in data["assessment_sets"]:
            self.assertEqual(a["subject"], "english")
            self.assertIn("source", a)
        eng = next(a for a in data["assessment_sets"] if a["title"] == "Eng Set")
        self.assertEqual(eng["source"], AssessmentSet.SOURCE_SATOPLAM)

    def test_practice_tests_are_class_subject_only(self):
        # Every returned pastpaper section must match the class platform subject.
        for pt in self._options()["practice_tests"]:
            self.assertEqual(pt["subject"], "READING_WRITING")


class AttachmentUrlsShapeTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("att_admin@test.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="C", subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )

    def test_attachment_urls_are_objects(self):
        a = Assignment.objects.create(
            classroom=self.classroom, created_by=self.admin, title="HW",
            attachment_file=SimpleUploadedFile("worksheet.pdf", b"%PDF-1.4 body", content_type="application/pdf"),
        )
        data = AssignmentSerializer(a, context={}).data
        urls = data["attachment_urls"]
        self.assertEqual(len(urls), 1)
        item = urls[0]
        self.assertEqual(set(item.keys()), {"url", "file_name", "content_type", "size"})
        self.assertTrue(item["file_name"].endswith(".pdf"))
        self.assertEqual(item["content_type"], "application/pdf")
        self.assertTrue(item["url"])
