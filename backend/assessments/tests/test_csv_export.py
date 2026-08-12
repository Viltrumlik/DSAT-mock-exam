"""Assessment CSV export, and the round trip back through the importer.

The interesting field is ``correct_answer``. On the model it is a JSONField holding a string,
a number, a bool or a list; in the file it is one cell. Getting that encoding wrong produces
a file that imports cleanly and grades wrongly, which is worse than one that fails.
"""

from __future__ import annotations

import csv
import io

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.domain.csv_export import EXPORT_HEADERS, write_questions_csv
from assessments.domain.csv_import import REQUIRED_HEADERS, parse_rows
from assessments.models import AssessmentQuestion, AssessmentSet

User = get_user_model()


class ExportFixture(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.super_admin = User.objects.create_user(
            email="ax_super@t.com", password="x", role=acc_const.ROLE_SUPER_ADMIN
        )
        self.admin = User.objects.create_user(
            email="ax_admin@t.com", password="x", role=acc_const.ROLE_ADMIN
        )
        self.student = User.objects.create_user(email="ax_student@t.com", password="x")

        self.set = AssessmentSet.objects.create(
            subject="english", title="Boundaries drill", category="Boundaries",
            source=AssessmentSet.SOURCE_SATOPLAM, level="middle", created_by=self.admin,
        )
        self.mcq = AssessmentQuestion.objects.create(
            assessment_set=self.set, order=0, question_type="multiple_choice",
            prompt="Which choice completes the text?",
            question_prompt="Based on the passage…",
            choices=[
                {"id": "A", "text": "alpha"}, {"id": "B", "text": "beta"},
                {"id": "C", "text": "gamma"}, {"id": "D", "text": "delta"},
            ],
            correct_answer="B", points=1, explanation="Beta fits the contrast.",
        )
        self.numeric = AssessmentQuestion.objects.create(
            assessment_set=self.set, order=1, question_type="numeric",
            prompt="Enter one half", correct_answer=["0.5", "1/2"], points=2,
        )
        self.boolean = AssessmentQuestion.objects.create(
            assessment_set=self.set, order=2, question_type="boolean",
            prompt="The sky is blue.", correct_answer=True, points=1,
        )

    def rows(self, text):
        return list(csv.DictReader(io.StringIO(text)))


class ColumnContractTests(ExportFixture):
    def test_every_required_import_header_is_exported(self):
        for header in REQUIRED_HEADERS:
            with self.subTest(header=header):
                self.assertIn(header, EXPORT_HEADERS)

    def test_a_list_answer_becomes_a_comma_list(self):
        # The importer splits a numeric answer on commas, which is how several acceptable
        # forms of one value survive the trip.
        row = self.rows(write_questions_csv([self.numeric]))[0]
        self.assertEqual(row["correct_answer"], "0.5, 1/2")

    def test_a_boolean_answer_is_a_word_not_a_number(self):
        """In Python a bool IS an int, so a numeric branch tested first would write "1"
        and the importer would read it back as a number."""
        row = self.rows(write_questions_csv([self.boolean]))[0]
        self.assertEqual(row["correct_answer"], "true")

    def test_choices_are_matched_by_id_not_position(self):
        # A set whose choices are stored out of order must still export its answer key
        # against the right option — the one mistake this file cannot make.
        self.mcq.choices = [
            {"id": "C", "text": "gamma"}, {"id": "A", "text": "alpha"},
            {"id": "D", "text": "delta"}, {"id": "B", "text": "beta"},
        ]
        self.mcq.save(update_fields=["choices"])
        row = self.rows(write_questions_csv([self.mcq]))[0]
        self.assertEqual(row["option_a"], "alpha")
        self.assertEqual(row["option_b"], "beta")
        self.assertEqual(row["option_c"], "gamma")
        self.assertEqual(row["option_d"], "delta")

    def test_a_missing_choice_is_blank_not_a_crash(self):
        self.mcq.choices = [{"id": "A", "text": "alpha"}, {"id": "B", "text": "beta"}]
        self.mcq.save(update_fields=["choices"])
        row = self.rows(write_questions_csv([self.mcq]))[0]
        self.assertEqual(row["option_c"], "")
        self.assertEqual(row["option_d"], "")

    def test_an_image_is_flagged_because_it_cannot_travel(self):
        self.mcq.question_image = "assessment_questions/x.png"
        self.mcq.save(update_fields=["question_image"])
        self.assertEqual(self.rows(write_questions_csv([self.mcq]))[0]["has_image"], "yes")


class RoundTripTests(ExportFixture):
    def test_the_importer_accepts_what_the_exporter_writes(self):
        text = write_questions_csv([self.mcq, self.numeric, self.boolean])
        payloads = parse_rows(text)
        self.assertEqual(len(payloads), 3)

    def test_a_multiple_choice_question_survives_the_trip(self):
        [payload] = parse_rows(write_questions_csv([self.mcq]))
        self.assertEqual(payload["prompt"], self.mcq.prompt)
        self.assertEqual(payload["question_prompt"], self.mcq.question_prompt)
        self.assertEqual(payload["question_type"], "multiple_choice")
        self.assertEqual(payload["correct_answer"], "B")
        self.assertEqual(
            [c["text"] for c in payload["choices"]], ["alpha", "beta", "gamma", "delta"]
        )
        self.assertEqual(payload["points"], 1)

    def test_a_numeric_question_survives_the_trip(self):
        [payload] = parse_rows(write_questions_csv([self.numeric]))
        self.assertEqual(payload["question_type"], "numeric")
        self.assertEqual(payload["points"], 2)
        # However the importer chooses to represent it, both accepted forms must be in there.
        self.assertIn("0.5", str(payload["correct_answer"]))
        self.assertIn("1/2", str(payload["correct_answer"]))

    def test_a_boolean_question_survives_the_trip(self):
        [payload] = parse_rows(write_questions_csv([self.boolean]))
        self.assertEqual(payload["question_type"], "boolean")
        self.assertIn(payload["correct_answer"], (True, "true"))


class ExportEndpointTests(ExportFixture):
    def url(self, set_pk=None):
        return f"/api/assessments/admin/sets/{set_pk or self.set.pk}/questions/export-csv/"

    def test_a_super_admin_gets_the_file(self):
        self.client.force_authenticate(self.super_admin)
        r = self.client.get(self.url())
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/csv", r["Content-Type"])
        self.assertIn("Boundaries-drill", r["Content-Disposition"])
        self.assertEqual(len(self.rows(r.content.decode("utf-8-sig"))), 3)

    def test_an_admin_is_refused(self):
        # Authoring stays open to the staff who build sets; the whole-set download is the
        # school's review tool and is super_admin's alone.
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(self.url()).status_code, 403)

    def test_a_student_is_refused(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(self.url()).status_code, 403)

    def test_a_missing_set_is_a_404_not_a_blank_file(self):
        self.client.force_authenticate(self.super_admin)
        self.assertEqual(self.client.get(self.url(set_pk=999_999)).status_code, 404)

    def test_an_empty_set_still_has_headers(self):
        empty = AssessmentSet.objects.create(
            subject="math", title="Nothing yet", category="Algebra",
            source=AssessmentSet.SOURCE_SQB, level="middle", created_by=self.admin,
        )
        self.client.force_authenticate(self.super_admin)
        body = self.client.get(self.url(set_pk=empty.pk)).content.decode("utf-8-sig")
        self.assertEqual(self.rows(body), [])
        # An empty file would be indistinguishable from a failed download.
        self.assertTrue(body.startswith(EXPORT_HEADERS[0]))
