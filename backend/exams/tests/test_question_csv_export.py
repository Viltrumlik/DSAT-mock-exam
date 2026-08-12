"""The CSV a super_admin downloads must be the CSV the importer reads.

That is the whole contract, and it is the one thing a hand-written column list gets wrong:
the model field is ``correct_answers`` and the CSV column has always been ``correct_answer``,
so an export that mirrors the model produces a file whose answer key the importer silently
drops. The round-trip tests here exist to catch exactly that, not to restate the writer.
"""

from __future__ import annotations

import csv
import io

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from exams.models import Module, PracticeTest, Question
from exams.question_csv_export import EXPORT_HEADERS, write_questions_csv
from exams.question_csv_import import REQUIRED_HEADERS, parse_question_rows

User = get_user_model()


class ExportFixture(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.super_admin = User.objects.create_user(
            "csv_super@t.com", "secret123", role=C.ROLE_SUPER_ADMIN
        )
        self.test_admin = User.objects.create_user(
            "csv_ta@t.com", "secret123", role=C.ROLE_TEST_ADMIN
        )
        self.student = User.objects.create_user("csv_student@t.com", "secret123")

        self.test = PracticeTest.objects.create(
            title="Pastpaper 12", subject="READING_WRITING",
        )
        # A post_save on PracticeTest provisions Modules 1 and 2, so this takes the one that
        # already exists rather than minting a duplicate the unique constraint would refuse.
        self.module = Module.objects.get(practice_test=self.test, module_order=1)
        self.mcq = Question.objects.create(
            module=self.module, order=0, question_type="READING",
            question_text="Which choice completes the text?",
            question_prompt="The passage argues…",
            option_a="alpha", option_b="beta", option_c="gamma", option_d="delta",
            correct_answers="B", score=10, explanation="Beta fits the contrast.",
        )
        self.gridin = Question.objects.create(
            module=self.module, order=1, question_type="MATH",
            question_text="What is two thirds?",
            correct_answers="2/3, 0.666, 0.667", is_math_input=True, score=10,
        )

    def rows(self, text):
        return list(csv.DictReader(io.StringIO(text)))


class ColumnContractTests(ExportFixture):
    def test_every_required_import_header_is_exported(self):
        # The importer refuses a file missing these outright, so a download that lacks one
        # is not a round-trip, it is a 400.
        for header in REQUIRED_HEADERS:
            with self.subTest(header=header):
                self.assertIn(header, EXPORT_HEADERS)

    def test_the_answer_column_is_singular(self):
        """The model says correct_answerS; the CSV has always said correct_answer."""
        self.assertIn("correct_answer", EXPORT_HEADERS)
        self.assertNotIn("correct_answers", EXPORT_HEADERS)

    def test_a_multiple_choice_row_carries_its_options_and_key(self):
        row = self.rows(write_questions_csv([self.mcq]))[0]
        self.assertEqual(row["question_text"], "Which choice completes the text?")
        self.assertEqual(row["option_b"], "beta")
        self.assertEqual(row["correct_answer"], "B")
        self.assertEqual(row["is_math_input"], "")

    def test_a_grid_in_row_keeps_every_accepted_form(self):
        row = self.rows(write_questions_csv([self.gridin]))[0]
        self.assertEqual(row["correct_answer"], "2/3, 0.666, 0.667")
        self.assertEqual(row["is_math_input"], "true")

    def test_the_module_column_names_the_module_a_reviewer_sees(self):
        row = self.rows(write_questions_csv([self.mcq]))[0]
        self.assertIn("Module 1", row["module"])
        self.assertIn("Reading", row["module"])

    def test_an_image_is_flagged_because_it_cannot_travel(self):
        self.mcq.question_image = "question_images/x.png"
        self.mcq.save(update_fields=["question_image"])
        row = self.rows(write_questions_csv([self.mcq]))[0]
        # A row marked yes comes back through the importer without its figure. Saying so is
        # the only honest thing a text format can do about it.
        self.assertEqual(row["has_image"], "yes")


class RoundTripTests(ExportFixture):
    """Export → import → the same question. Nothing here checks the writer against itself."""

    def test_the_importer_accepts_what_the_exporter_writes(self):
        text = write_questions_csv([self.mcq, self.gridin])
        payloads = parse_question_rows(text.encode("utf-8"), subject="READING_WRITING")
        self.assertEqual(len(payloads), 2)

    def test_a_multiple_choice_question_survives_the_trip(self):
        text = write_questions_csv([self.mcq])
        [payload] = parse_question_rows(text.encode("utf-8"), subject="READING_WRITING")

        self.assertEqual(payload["question_text"], self.mcq.question_text)
        self.assertEqual(payload["question_prompt"], self.mcq.question_prompt)
        self.assertEqual(payload["correct_answer"], "B")
        self.assertEqual(payload["option_a"], "alpha")
        self.assertEqual(payload["option_d"], "delta")
        self.assertEqual(payload["question_type"], "READING")
        self.assertEqual(payload["score"], 10)
        self.assertEqual(payload["explanation"], self.mcq.explanation)
        self.assertFalse(payload["is_math_input"])

    def test_a_grid_in_question_survives_the_trip(self):
        text = write_questions_csv([self.gridin])
        [payload] = parse_question_rows(text.encode("utf-8"), subject="MATH")

        self.assertTrue(payload["is_math_input"])
        # Not uppercased and not split: a grid-in key is a list of accepted forms, and the
        # importer only upper-cases the single letter of a multiple-choice answer.
        self.assertEqual(payload["correct_answer"], "2/3, 0.666, 0.667")

    def test_the_review_only_columns_do_not_confuse_the_importer(self):
        """module / order / question_id / has_image are scaffolding for the reader. The
        importer must ignore them rather than choke or mistake one for a field."""
        text = write_questions_csv([self.mcq])
        [payload] = parse_question_rows(text.encode("utf-8"), subject="READING_WRITING")
        for scaffolding in ("module", "order", "question_id", "has_image"):
            self.assertNotIn(scaffolding, payload)

    def test_a_non_ascii_question_survives_the_trip(self):
        self.mcq.question_text = "Qaysi javob to‘g‘ri — “alpha” yoki «beta»?"
        self.mcq.save(update_fields=["question_text"])
        text = write_questions_csv([self.mcq])
        [payload] = parse_question_rows(
            text.encode("utf-8-sig"), subject="READING_WRITING"
        )
        # utf-8-sig on the way out (so Excel reads it) and on the way back in — decode_csv
        # strips the BOM, which is the only reason the first column name still matches.
        self.assertEqual(payload["question_text"], self.mcq.question_text)


class ExportEndpointTests(ExportFixture):
    def url(self):
        return f"/api/exams/admin/tests/{self.test.pk}/export-csv/"

    def test_a_super_admin_gets_the_file(self):
        self.client.force_authenticate(self.super_admin)
        r = self.client.get(self.url())
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/csv", r["Content-Type"])
        self.assertIn("attachment;", r["Content-Disposition"])
        self.assertIn("Pastpaper-12", r["Content-Disposition"])
        body = r.content.decode("utf-8-sig")
        self.assertEqual(len(self.rows(body)), 2)

    def test_the_response_is_not_cached(self):
        # An answer key served from cache after a question is edited is a wrong answer key.
        self.client.force_authenticate(self.super_admin)
        self.assertEqual(self.client.get(self.url())["Cache-Control"], "no-store")

    def test_a_test_admin_is_refused(self):
        # Narrower than the rest of the builder on purpose: a whole answer key leaving as a
        # file is a different act from reading the questions one at a time.
        self.client.force_authenticate(self.test_admin)
        self.assertEqual(self.client.get(self.url()).status_code, 403)

    def test_a_student_is_refused(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(self.url()).status_code, 403)

    def test_an_anonymous_request_is_refused(self):
        self.assertIn(self.client.get(self.url()).status_code, (401, 403))

    def test_an_empty_test_exports_headers_and_no_rows(self):
        empty = PracticeTest.objects.create(title="Nothing here", subject="MATH")
        self.client.force_authenticate(self.super_admin)
        r = self.client.get(f"/api/exams/admin/tests/{empty.pk}/export-csv/")
        self.assertEqual(r.status_code, 200)
        body = r.content.decode("utf-8-sig")
        self.assertEqual(self.rows(body), [])
        # Headers still present: an empty file would be indistinguishable from a failure.
        self.assertTrue(body.startswith(EXPORT_HEADERS[0]))

    def test_a_title_with_slashes_does_not_break_the_filename(self):
        self.test.title = "SAT 2026 / Form A: \"international\""
        self.test.save(update_fields=["title"])
        self.client.force_authenticate(self.super_admin)
        disposition = self.client.get(self.url())["Content-Disposition"]
        # One quoted filename, no stray quote or slash inside it.
        self.assertRegex(disposition, r'^attachment; filename="[A-Za-z0-9_-]+\.csv"$')
