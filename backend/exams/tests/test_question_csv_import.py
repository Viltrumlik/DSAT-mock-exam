"""CSV question import for the exams system (pastpapers, full mocks, legacy midterms).

Covers the shared importer + the two bulk-import endpoints:
  - POST /api/exams/admin/tests/{test_pk}/modules/{module_pk}/questions/bulk-import/
  - POST /api/mocks/admin/mocks/{mock_pk}/modules/{module_pk}/questions/bulk-import/
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from exams.models import MockExam, Module, PracticeTest, Question

User = get_user_model()

_ALLOWED_HOSTS = ("testserver", "localhost", "127.0.0.1", "questions.mastersat.uz")
_QHOST = {"HTTP_HOST": "questions.mastersat.uz"}

_HEADER = "question_type,question_text,question_prompt,is_math_input,option_a,option_b,option_c,option_d,correct_answer,score,explanation"


def _csv(*rows: str) -> SimpleUploadedFile:
    body = "\n".join([_HEADER, *rows]).encode("utf-8")
    return SimpleUploadedFile("questions.csv", body, content_type="text/csv")


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_HOSTS))
class ExamsCsvImportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email="csv-admin@example.com", password="pw",
            role="super_admin", is_staff=True, is_superuser=True,
        )
        self.client.force_authenticate(self.admin)

        self.pt = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True,
        )
        self.mod = Module.objects.create(
            practice_test=self.pt, module_order=1, time_limit_minutes=35,
        )

    def _url(self, test_id=None, module_id=None):
        return (
            f"/api/exams/admin/tests/{test_id or self.pt.id}"
            f"/modules/{module_id or self.mod.id}/questions/bulk-import/"
        )

    def _post(self, upload, url=None):
        return self.client.post(url or self._url(), {"file": upload}, format="multipart", **_QHOST)

    # ── happy paths ──────────────────────────────────────────────────────────
    def test_pastpaper_import_mcq_and_gridin(self):
        r = self._post(_csv(
            'MATH,"What is 2+2?",,,"3","4","5","6",B,10,"Because 2+2=4"',
            ',"Type the value of x if 2x=6",,true,,,,,"3, 3.0",10,',
        ))
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["created_count"], 2)

        qs = list(Question.objects.filter(module=self.mod).order_by("order"))
        self.assertEqual(len(qs), 2)
        # MCQ: uppercased letter, options, dense order from 0.
        self.assertEqual(qs[0].question_text, "What is 2+2?")
        self.assertEqual(qs[0].correct_answers, "B")
        self.assertFalse(qs[0].is_math_input)
        self.assertEqual(qs[0].option_b, "4")
        self.assertEqual(qs[0].order, 0)
        self.assertEqual(qs[0].explanation, "Because 2+2=4")
        # Grid-in: is_math_input, comma variants preserved, question_type defaulted to MATH.
        self.assertTrue(qs[1].is_math_input)
        self.assertEqual(qs[1].correct_answers, "3, 3.0")
        self.assertEqual(qs[1].question_type, "MATH")
        self.assertEqual(qs[1].order, 1)

    def test_question_type_defaults_from_subject(self):
        r = self._post(_csv(',"Q",,,"1","2","3","4",A,,'))
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Question.objects.get(module=self.mod).question_type, "MATH")

    # ── validation: all-or-nothing ───────────────────────────────────────────
    def test_invalid_row_imports_nothing(self):
        # Row 2 valid; row 3 has a bad MCQ answer letter → whole import rejected.
        r = self._post(_csv(
            'MATH,"Good",,,"1","2","3","4",A,,',
            'MATH,"Bad",,,"1","2","3","4",Z,,',
        ))
        self.assertEqual(r.status_code, 400, r.content)
        body = r.json()
        self.assertIn("errors", body)
        self.assertEqual(body["errors"][0]["row"], 3)  # header is row 1
        self.assertEqual(Question.objects.filter(module=self.mod).count(), 0)

    def test_mcq_answer_must_match_a_filled_option(self):
        # 'D' but option_d is blank → rejected by content validation.
        r = self._post(_csv('MATH,"Q",,,"1","2",,,"D",,'))
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(Question.objects.filter(module=self.mod).count(), 0)

    def test_missing_required_column(self):
        body = ("question_text\n\"hi\"").encode("utf-8")
        upload = SimpleUploadedFile("q.csv", body, content_type="text/csv")
        r = self._post(upload)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("correct_answer", r.json()["detail"])

    def test_missing_file(self):
        r = self.client.post(self._url(), {}, format="multipart", **_QHOST)
        self.assertEqual(r.status_code, 400, r.content)

    # ── SAT per-module cap ───────────────────────────────────────────────────
    def test_cap_exceeded_imports_nothing(self):
        # MATH module cap is 22; seed 22 then try to add 1 more.
        for i in range(22):
            Question.objects.create(
                module=self.mod, question_type="MATH", question_text=f"Q{i}",
                option_a="1", option_b="2", correct_answers="A", order=i,
            )
        r = self._post(_csv('MATH,"one more",,,"1","2","3","4",A,,'))
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("at most 22", r.json()["detail"])
        self.assertEqual(Question.objects.filter(module=self.mod).count(), 22)

    def test_pastpaper_rejects_wrong_type_for_subject(self):
        # A MATH module may not hold a WRITING question (SAT rule).
        r = self._post(_csv('WRITING,"Q",,,"1","2","3","4",A,,'))
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(Question.objects.filter(module=self.mod).count(), 0)

    # ── legacy midterm module (exams endpoint) — SAT-exempt ──────────────────
    def test_legacy_midterm_module_allows_any_type(self):
        exam = MockExam.objects.create(
            title="MT", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_scoring_scale=MockExam.SCALE_100, midterm_module_count=1,
        )
        pt = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", mock_exam=exam,
            title="MT section", skip_default_modules=True,
        )
        mod = Module.objects.create(practice_test=pt, module_order=1, time_limit_minutes=35)
        # WRITING type on a MATH midterm module is allowed (midterms are SAT-exempt).
        r = self._post(
            _csv('WRITING,"Reading Q",,,"1","2","3","4",C,10,'),
            url=self._url(test_id=pt.id, module_id=mod.id),
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Question.objects.filter(module=mod).count(), 1)


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_HOSTS))
class MockCsvImportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email="csv-mock@example.com", password="pw",
            role="super_admin", is_staff=True, is_superuser=True,
        )
        self.client.force_authenticate(self.admin)
        # Create a mock via the admin API so its 2 sections × 2 modules are auto-provisioned.
        create = self.client.post(
            "/api/mocks/admin/mocks/", {"title": "CSV Mock", "break_minutes": 10},
            format="json", **_QHOST,
        )
        self.assertEqual(create.status_code, 201, create.content)
        self.mock = create.json()
        # Pick the Math section's Module 1.
        math_section = next(s for s in self.mock["sections"] if s["subject"] == "MATH")
        self.module_id = next(m["id"] for m in math_section["modules"] if m["module_order"] == 1)

    def test_mock_module_import(self):
        url = f"/api/mocks/admin/mocks/{self.mock['id']}/modules/{self.module_id}/questions/bulk-import/"
        body = _csv(
            'MATH,"Mock Q1",,,"1","2","3","4",A,10,',
            ',"Mock grid-in",,yes,,,,,"7/2",10,',
        )
        r = self.client.post(url, {"file": body}, format="multipart", **_QHOST)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["created_count"], 2)
        self.assertEqual(Question.objects.filter(module_id=self.module_id).count(), 2)
