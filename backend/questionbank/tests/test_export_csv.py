"""
The CSV export must round-trip prod's real content shapes without corruption.

Every correct_answer type below was measured on prod (str 1676, int 301, float 40,
list 9, None 1) — the None row is a real question with no answer, so the export has
to emit it rather than crash. The text fixtures carry the markup that actually ships:
LaTeX delimiters, <br>, embedded newlines, quotes and non-ASCII.
"""
from __future__ import annotations

import csv
import tempfile
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase

from questionbank.models import (
    BankDomain,
    BankQuestion,
    BankSkill,
    QuestionStatus,
    QuestionType,
    Subject,
)
from questionbank.management.commands.export_question_bank import COLUMNS


def _read(path: Path) -> list[dict]:
    # utf-8-sig strips the BOM the writer adds for Excel.
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


class ExportQuestionBankTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.domain = BankDomain.objects.create(subject=Subject.MATH, name="Algebra", code="algebra")
        cls.skill = BankSkill.objects.create(domain=cls.domain, name="Linear Functions", code="linear-functions")

        def mk(qb_id, **kw):
            defaults = dict(
                subject=Subject.MATH,
                domain=cls.domain,
                skill=cls.skill,
                difficulty="MEDIUM",
                status=QuestionStatus.APPROVED,
                question_type=QuestionType.MULTIPLE_CHOICE,
                question_text="What is x?",
            )
            defaults.update(kw)
            q = BankQuestion(**defaults)
            q.qb_id = qb_id
            q.save()
            return q

        # The five answer shapes that exist on prod.
        cls.letter = mk("QB-MATH-000001", correct_answer="A", option_a="-2", option_b="7")
        cls.integer = mk("QB-MATH-000002", correct_answer=17, question_type=QuestionType.NUMERIC)
        cls.floating = mk("QB-MATH-000003", correct_answer=-3.5, question_type=QuestionType.NUMERIC)
        cls.multi = mk("QB-MATH-000004", correct_answer=["3/2", "1.5"], question_type=QuestionType.NUMERIC)
        cls.none_ans = mk("QB-MATH-000005", correct_answer=None, question_type=QuestionType.NUMERIC)

        # The markup that actually ships, plus an image and an untriaged row.
        cls.markup = mk(
            "QB-ENG-000006",
            subject=Subject.ENGLISH,
            question_text='A \\( \\cdot \\) note<br>\nline two, with a "quoted" bit and Galápagos ›',
            question_prompt="Which choice is best?",
            option_a="*C. olivacea* is a bird",
            correct_answer="B",
            question_image="question_bank/questions/diagram.png",
        )
        cls.triage = mk(
            "QB-MATH-000007",
            status=QuestionStatus.TRIAGE,
            domain=None,
            skill=None,
            difficulty="",
        )
        # bank_sync stamps suggestion_model only on a real category match; the rows
        # without it were dropped onto the subject's first domain/skill by the fallback.
        cls.classified = mk(
            "QB-MATH-000008",
            suggestion_model="sync:assessment_category",
            suggested_domain=cls.domain,
        )

    def _export(self, **opts) -> list[dict]:
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "qb.csv"
            call_command("export_question_bank", out=str(out), **opts)
            return _read(out)

    def test_every_question_gets_exactly_one_row(self):
        rows = self._export()
        self.assertEqual(len(rows), BankQuestion.objects.count())
        self.assertEqual(len(rows), 8)

    def test_header_matches_the_declared_columns(self):
        rows = self._export()
        self.assertEqual(list(rows[0].keys()), COLUMNS)

    def test_each_prod_answer_shape_survives(self):
        by_id = {r["qb_id"]: r for r in self._export()}
        self.assertEqual(by_id["QB-MATH-000001"]["correct_answer"], "A")
        self.assertEqual(by_id["QB-MATH-000002"]["correct_answer"], "17")
        self.assertEqual(by_id["QB-MATH-000003"]["correct_answer"], "-3.5")
        # A list is the multi-variant SPR case — joined for reading, exact in JSON.
        self.assertEqual(by_id["QB-MATH-000004"]["correct_answer"], "3/2 | 1.5")
        self.assertEqual(by_id["QB-MATH-000004"]["correct_answer_json"], '["3/2", "1.5"]')

    def test_a_question_with_no_answer_exports_blank_instead_of_crashing(self):
        by_id = {r["qb_id"]: r for r in self._export()}
        self.assertEqual(by_id["QB-MATH-000005"]["correct_answer"], "")
        self.assertEqual(by_id["QB-MATH-000005"]["correct_answer_json"], "null")

    def test_the_json_column_preserves_type_where_the_readable_one_cannot(self):
        by_id = {r["qb_id"]: r for r in self._export()}
        # "17" and 17 are indistinguishable in the readable column; JSON keeps them apart.
        self.assertEqual(by_id["QB-MATH-000002"]["correct_answer_json"], "17")
        self.assertEqual(by_id["QB-MATH-000001"]["correct_answer_json"], '"A"')

    def test_latex_newlines_quotes_and_unicode_round_trip_verbatim(self):
        by_id = {r["qb_id"]: r for r in self._export()}
        self.assertEqual(by_id["QB-ENG-000006"]["question_text"], self.markup.question_text)
        # The raw markup is the source of truth — nothing is stripped.
        self.assertIn("\\( \\cdot \\)", by_id["QB-ENG-000006"]["question_text"])
        self.assertIn("<br>", by_id["QB-ENG-000006"]["question_text"])
        self.assertIn("\n", by_id["QB-ENG-000006"]["question_text"])
        self.assertIn('"quoted"', by_id["QB-ENG-000006"]["question_text"])
        self.assertIn("Galápagos ›", by_id["QB-ENG-000006"]["question_text"])
        self.assertEqual(by_id["QB-ENG-000006"]["option_a"], "*C. olivacea* is a bird")

    def test_a_negative_number_keeps_its_minus_sign(self):
        # Excel treats a leading "-" as a formula trigger; guarding it would corrupt
        # the value, and prod has only legitimate negatives (no = or @ cells).
        by_id = {r["qb_id"]: r for r in self._export()}
        self.assertEqual(by_id["QB-MATH-000001"]["option_a"], "-2")
        self.assertEqual(by_id["QB-MATH-000003"]["correct_answer"], "-3.5")

    def test_image_becomes_an_absolute_url_and_a_blank_stays_blank(self):
        by_id = {r["qb_id"]: r for r in self._export(base_url="https://mastersat.uz")}
        self.assertEqual(
            by_id["QB-ENG-000006"]["question_image_url"],
            "https://mastersat.uz/media/question_bank/questions/diagram.png",
        )
        self.assertEqual(by_id["QB-MATH-000001"]["question_image_url"], "")
        self.assertEqual(by_id["QB-MATH-000001"]["option_a_image_url"], "")

    def test_base_url_trailing_slash_does_not_double_up(self):
        by_id = {r["qb_id"]: r for r in self._export(base_url="https://mastersat.uz/")}
        self.assertEqual(
            by_id["QB-ENG-000006"]["question_image_url"],
            "https://mastersat.uz/media/question_bank/questions/diagram.png",
        )

    def test_an_untriaged_row_exports_with_empty_taxonomy_not_a_crash(self):
        by_id = {r["qb_id"]: r for r in self._export()}
        row = by_id["QB-MATH-000007"]
        self.assertEqual(row["domain"], "")
        self.assertEqual(row["skill"], "")
        self.assertEqual(row["difficulty"], "")
        self.assertEqual(row["status"], "TRIAGE")

    def test_taxonomy_source_separates_a_real_match_from_the_sync_fallback(self):
        by_id = {r["qb_id"]: r for r in self._export()}
        # A recorded match: the category resolved to this exact domain.
        self.assertEqual(by_id["QB-MATH-000008"]["taxonomy_source"], "assessment_category")
        # No match recorded -> bank_sync dropped it on the subject's first domain/skill,
        # so the domain/skill cells are a default and must not read as a classification.
        self.assertEqual(by_id["QB-MATH-000001"]["taxonomy_source"], "fallback_default")
        self.assertEqual(by_id["QB-MATH-000001"]["domain"], "Algebra")
        # No taxonomy at all is a third, distinct state.
        self.assertEqual(by_id["QB-MATH-000007"]["taxonomy_source"], "unclassified")

    def test_status_filter_selects_only_that_status(self):
        rows = self._export(status=QuestionStatus.APPROVED)
        self.assertEqual(len(rows), 7)
        self.assertTrue(all(r["status"] == "APPROVED" for r in rows))

    def test_subject_filter_selects_only_that_subject(self):
        rows = self._export(subject=Subject.ENGLISH)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["qb_id"], "QB-ENG-000006")

    def test_the_file_carries_a_bom_so_excel_decodes_unicode(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "qb.csv"
            call_command("export_question_bank", out=str(out))
            self.assertEqual(out.read_bytes()[:3], b"\xef\xbb\xbf")
