"""CSV import for assessments — create a new set from a CSV, and append to an existing set.

Every row is validated by AssessmentQuestionAdminWriteSerializer, so the type-specific
correct_answer handling (MCQ letter, numeric comma-list, boolean, short_text) is exercised
through the real authoring path. Import is all-or-nothing.
"""

from __future__ import annotations

import csv
import io

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import AssessmentQuestion, AssessmentSet

User = get_user_model()

HEADER = ["question_type", "prompt", "option_a", "option_b", "option_c", "option_d", "correct_answer", "points", "explanation"]
GOOD_ROWS = [
    ["multiple_choice", "What is 2+2?", "3", "4", "5", "6", "B", "1", "2+2=4"],
    ["numeric", "Enter one half", "", "", "", "", "0.5, 1/2", "2", ""],
    ["boolean", "The sky is blue.", "", "", "", "", "true", "1", ""],
    ["short_text", "Capital of France?", "", "", "", "", "Paris", "1", ""],
]


def _csv_bytes(rows, header=HEADER) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        w.writerow(r)
    return buf.getvalue().encode("utf-8")


def _upload(rows, header=HEADER, name="q.csv"):
    return SimpleUploadedFile(name, _csv_bytes(rows, header), content_type="text/csv")


class CsvImportFixture(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email="csv_admin@t.com", password="x", role=acc_const.ROLE_ADMIN)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _existing_set(self, subject="english", source=None):
        return AssessmentSet.objects.create(
            subject=subject, title="Existing", category="Boundaries",
            source=source or AssessmentSet.SOURCE_SATOPLAM, level="middle", created_by=self.admin,
        )


class CreateNewFromCsv(CsvImportFixture):
    def test_creates_set_and_questions(self):
        r = self.client.post(
            "/api/assessments/admin/sets/import-csv/",
            {"subject": "english", "source": AssessmentSet.SOURCE_SATOPLAM, "level": "middle",
             "title": "From CSV", "category": "Boundaries", "file": _upload(GOOD_ROWS)},
            format="multipart",
        )
        self.assertEqual(r.status_code, 201, r.content)
        set_id = r.json()["id"]
        self.assertEqual(r.json()["created_count"], 4)
        qs = list(AssessmentQuestion.objects.filter(assessment_set_id=set_id).order_by("order"))
        self.assertEqual([q.order for q in qs], [0, 1, 2, 3])  # server-owned dense order

        mcq, numeric, boolean, short = qs
        self.assertEqual(mcq.question_type, "multiple_choice")
        self.assertEqual([c["id"] for c in mcq.choices], ["A", "B", "C", "D"])
        self.assertEqual(mcq.correct_answer, "B")
        # Numeric with several acceptable values → stored as a list.
        self.assertEqual(numeric.correct_answer, [0.5, "1/2"])
        self.assertEqual(numeric.points, 2)
        self.assertEqual(boolean.correct_answer, True)  # coerced from "true"
        self.assertEqual(short.correct_answer, "Paris")

    def test_bad_row_rolls_back_the_whole_set(self):
        bad = [["multiple_choice", "Bad", "3", "4", "", "", "Z", "1", ""]]  # 'Z' matches no choice
        before = AssessmentSet.objects.count()
        r = self.client.post(
            "/api/assessments/admin/sets/import-csv/",
            {"subject": "english", "source": AssessmentSet.SOURCE_SATOPLAM, "level": "middle",
             "title": "Bad", "category": "Boundaries", "file": _upload(bad)},
            format="multipart",
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("errors", r.json())
        self.assertEqual(AssessmentSet.objects.count(), before)  # set not created either

    def test_missing_required_header_is_400(self):
        r = self.client.post(
            "/api/assessments/admin/sets/import-csv/",
            {"subject": "english", "source": AssessmentSet.SOURCE_SATOPLAM, "level": "middle",
             "title": "NoHeader", "category": "Boundaries",
             "file": _upload([["x"]], header=["foo", "bar"])},
            format="multipart",
        )
        self.assertEqual(r.status_code, 400, r.content)

    def test_missing_file_is_400(self):
        r = self.client.post(
            "/api/assessments/admin/sets/import-csv/",
            {"subject": "english", "source": AssessmentSet.SOURCE_SATOPLAM, "level": "middle",
             "title": "NoFile", "category": "Boundaries"},
            format="multipart",
        )
        self.assertEqual(r.status_code, 400, r.content)


class AppendToExisting(CsvImportFixture):
    def test_appends_and_keeps_dense_order(self):
        aset = self._existing_set()
        # Seed one existing question at order 0.
        AssessmentQuestion.objects.create(
            assessment_set=aset, order=0, prompt="Seed", question_type="short_text",
            choices=[], correct_answer="x", points=1,
        )
        r = self.client.post(
            f"/api/assessments/admin/sets/{aset.id}/questions/import-csv/",
            {"file": _upload(GOOD_ROWS)},
            format="multipart",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["created_count"], 4)
        orders = list(
            AssessmentQuestion.objects.filter(assessment_set=aset).order_by("order").values_list("order", flat=True)
        )
        self.assertEqual(orders, [0, 1, 2, 3, 4])  # appended after the seed

    def test_bad_row_appends_nothing(self):
        aset = self._existing_set()
        bad = [
            ["short_text", "Ok", "", "", "", "", "yes", "1", ""],
            ["multiple_choice", "Bad", "3", "4", "", "", "Z", "1", ""],  # invalid → whole import fails
        ]
        r = self.client.post(
            f"/api/assessments/admin/sets/{aset.id}/questions/import-csv/",
            {"file": _upload(bad)},
            format="multipart",
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(AssessmentQuestion.objects.filter(assessment_set=aset).count(), 0)

    def test_teacher_cannot_append_cross_subject(self):
        aset = self._existing_set(subject="english")
        teacher = User.objects.create_user(
            email="mathteacher@t.com", password="x", role=acc_const.ROLE_TEACHER, subject="math",
        )
        client = APIClient()
        client.force_authenticate(teacher)
        r = client.post(
            f"/api/assessments/admin/sets/{aset.id}/questions/import-csv/",
            {"file": _upload(GOOD_ROWS)},
            format="multipart",
        )
        # Denied either way: 403 (no cross-subject authoring grant) or 404 (english set
        # is invisible to a math teacher). Both keep the set untouched.
        self.assertIn(r.status_code, (403, 404), r.content)
        self.assertEqual(AssessmentQuestion.objects.filter(assessment_set=aset).count(), 0)
