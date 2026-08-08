"""A file-upload homework must still carry its vocabulary + assessment.

Mirrors exactly what AssignmentForm.tsx sends on create: multipart/form-data with
JSON-string id lists, an attachment, and allow_file_upload=true. Then reads the
student-facing detail payload to see whether the vocabulary/assessment survive.
"""
from __future__ import annotations

import json

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from assessments.models import AssessmentSet
from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


class UploadHomeworkKeepsOtherContentsTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("ru_owner@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Repro", subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.student = User.objects.create_user("ru_student@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.aset = AssessmentSet.objects.create(
            subject="english", title="sqb", source=AssessmentSet.SOURCE_MATHBOOK,
            level="junior", created_by=self.owner,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        from vocabulary.models import VocabSection, VocabSet, VocabSetItem, VocabWord

        section = VocabSection.objects.create(title="Panda", slug="panda", is_published=True)
        self.vset = VocabSet.objects.create(section=section, title="Set 2", order=2)
        for i in range(3):
            w = VocabWord.objects.create(section=section, word=f"w{i}", definition=f"d{i}")
            VocabSetItem.objects.create(vocab_set=self.vset, word=w, order=i)

        self.client = APIClient()

    def _create_via_teacher_form(self):
        self.client.force_authenticate(self.owner)
        payload = {
            "title": "Homework",
            "instructions": "1. Vocabook panda 2 set\n2. sqb\n3. article\n4.transitions",
            "category": Assignment.CATEGORY_HOMEWORK,
            "assessment_set_ids": json.dumps([self.aset.id]),
            "vocabulary_set_ids": json.dumps([self.vset.id]),
            "allow_file_upload": "true",
            "status": Assignment.STATUS_PUBLISHED,
            "attachment_file": SimpleUploadedFile(
                "Atlantic_1.pdf", b"%PDF-1.4 fake", content_type="application/pdf"
            ),
        }
        r = self.client.post(
            f"/api/classes/{self.classroom.id}/assignments/", payload, format="multipart"
        )
        self.assertIn(r.status_code, (200, 201), getattr(r, "data", r.content))
        return r.data["id"]

    def test_student_detail_still_lists_vocab_and_assessment(self):
        aid = self._create_via_teacher_form()
        self.client.force_authenticate(self.student)
        data = self.client.get(
            f"/api/classes/{self.classroom.id}/assignments/{aid}/"
        ).json()
        print("\n[DETAIL] allow_file_upload =", data.get("allow_file_upload"))
        print("[DETAIL] assessment_homeworks =", data.get("assessment_homeworks"))
        print("[DETAIL] vocab_homeworks =", data.get("vocab_homeworks"))
        print("[DETAIL] contents =", data.get("contents"))
        print("[DETAIL] content_type =", data.get("content_type"))
        self.assertEqual(len(data.get("vocab_homeworks") or []), 1, "vocabulary vanished")
        self.assertEqual(len(data.get("assessment_homeworks") or []), 1, "assessment vanished")

    def test_my_assignments_still_lists_vocab_and_assessment(self):
        aid = self._create_via_teacher_form()
        self.client.force_authenticate(self.student)
        items = self.client.get("/api/classes/my-assignments/").json()["items"]
        row = next(i for i in items if i["id"] == aid)
        print("\n[MY] assessment_homeworks =", row.get("assessment_homeworks"))
        print("[MY] vocab_homeworks =", row.get("vocab_homeworks"))
        self.assertEqual(len(row.get("vocab_homeworks") or []), 1)
        self.assertEqual(len(row.get("assessment_homeworks") or []), 1)
