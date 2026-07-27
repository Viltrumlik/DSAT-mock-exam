"""
Vocabulary CSV import — the section importer (bucketed into sets by the ``set`` column)
and the set importer (everything into one set).

The contract worth defending: the write is all-or-nothing, errors name the author's own
spreadsheet row, and a headword the section already teaches is LINKED into the new set
rather than duplicated — a section owns one row per word, and every student's progress
hangs off that row.
"""

from __future__ import annotations

import csv
import io
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from vocabulary.models import VocabSection, VocabSet, VocabSetItem, VocabWord

User = get_user_model()

HEADER = ["set", "word", "definition", "part_of_speech", "example", "synonyms"]

GOOD_ROWS = [
    ["1", "abate", "to lessen", "verb", "The storm abated.", "subside; diminish"],
    ["1", "candid", "frank", "adj.", "a candid answer", "honest, direct"],
    ["2", "deft", "skilful", "", "", ""],
]


def _csv_bytes(rows, header=HEADER, *, bom=False) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    for row in rows:
        writer.writerow(row)
    text = buf.getvalue()
    return text.encode("utf-8-sig" if bom else "utf-8")


def _upload(rows, header=HEADER, *, bom=False, name="words.csv"):
    return SimpleUploadedFile(name, _csv_bytes(rows, header, bom=bom), content_type="text/csv")


class CsvFixture(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            "vocab_csv_admin@t.com", role=acc_const.ROLE_ADMIN
        )
        self.section = VocabSection.objects.create(title="650 Hard Words", slug="hard-650")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _import_section(self, rows, header=HEADER, **kw):
        return self.client.post(
            f"/api/vocabulary/admin/sections/{self.section.id}/import-csv/",
            {"file": _upload(rows, header, **kw)},
            format="multipart",
        )

    def _import_set(self, vocab_set, rows, header=HEADER, **kw):
        return self.client.post(
            f"/api/vocabulary/admin/sets/{vocab_set.id}/import-csv/",
            {"file": _upload(rows, header, **kw)},
            format="multipart",
        )

    def _words_of(self, vocab_set):
        return list(
            VocabSetItem.objects.filter(vocab_set=vocab_set)
            .select_related("word")
            .order_by("order")
            .values_list("word__word", flat=True)
        )


class SectionImportTests(CsvFixture):
    def test_buckets_rows_into_sets(self):
        r = self._import_section(GOOD_ROWS)
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual(body["section_id"], self.section.id)
        self.assertEqual(body["created_sets"], 2)
        self.assertEqual(body["created_words"], 3)
        self.assertEqual(body["linked_words"], 0)
        self.assertEqual(len(body["set_ids"]), 2)

        first, second = (VocabSet.objects.get(pk=i) for i in body["set_ids"])
        self.assertEqual([first.title, second.title], ["Set 1", "Set 2"])
        self.assertEqual(self._words_of(first), ["abate", "candid"])
        self.assertEqual(self._words_of(second), ["deft"])

    def test_normalizes_part_of_speech_and_synonyms(self):
        self._import_section(GOOD_ROWS)
        abate = VocabWord.objects.get(section=self.section, word="abate")
        candid = VocabWord.objects.get(section=self.section, word="candid")
        deft = VocabWord.objects.get(section=self.section, word="deft")
        self.assertEqual(abate.part_of_speech, VocabWord.PART_VERB)
        self.assertEqual(abate.synonyms, ["subside", "diminish"])  # ';' wins
        self.assertEqual(candid.part_of_speech, VocabWord.PART_ADJECTIVE)  # 'adj.' alias
        self.assertEqual(candid.synonyms, ["honest", "direct"])  # ',' fallback
        self.assertEqual(deft.part_of_speech, VocabWord.PART_OTHER)  # blank → other

    def test_non_numeric_set_value_is_used_verbatim(self):
        r = self._import_section([["Week 3", "aloof", "distant", "", "", ""]])
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(VocabSet.objects.get(pk=r.json()["set_ids"][0]).title, "Week 3")

    def test_existing_set_with_a_matching_title_is_appended_to(self):
        existing = VocabSet.objects.create(section=self.section, title="Set 1", order=0)
        VocabSetItem.objects.create(
            vocab_set=existing,
            word=VocabWord.objects.create(section=self.section, word="prior", definition="earlier"),
            order=0,
        )
        r = self._import_section([["1", "abate", "to lessen", "", "", ""]])
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["created_sets"], 0)
        self.assertEqual(r.json()["set_ids"], [existing.id])
        self.assertEqual(self._words_of(existing), ["prior", "abate"])

    def test_word_already_in_the_section_is_linked_not_duplicated(self):
        VocabWord.objects.create(section=self.section, word="abate", definition="to lessen")
        r = self._import_section([["1", "Abate", "to lessen", "", "", ""]])
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["created_words"], 0)
        self.assertEqual(r.json()["linked_words"], 1)
        self.assertEqual(VocabWord.objects.filter(section=self.section).count(), 1)

    def test_duplicate_word_in_the_same_set_is_a_row_error(self):
        rows = [
            ["1", "abate", "to lessen", "", "", ""],
            ["1", "Abate", "again", "", "", ""],
        ]
        r = self._import_section(rows)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json()["errors"], [{"row": 3, "errors": {"word": ["Already in this set."]}}])
        self.assertEqual(VocabWord.objects.filter(section=self.section).count(), 0)

    def test_the_same_word_may_appear_in_two_different_sets(self):
        rows = [
            ["1", "abate", "to lessen", "", "", ""],
            ["2", "abate", "to lessen", "", "", ""],
        ]
        r = self._import_section(rows)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual((r.json()["created_words"], r.json()["linked_words"]), (1, 1))

    def test_a_bad_row_rolls_back_everything(self):
        rows = [
            ["1", "abate", "to lessen", "", "", ""],
            ["1", "", "no headword", "", "", ""],
        ]
        r = self._import_section(rows)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json()["errors"][0]["row"], 3)
        self.assertIn("word", r.json()["errors"][0]["errors"])
        self.assertEqual(VocabWord.objects.count(), 0)
        self.assertEqual(VocabSet.objects.count(), 0)

    def test_blank_rows_are_skipped_without_shifting_row_numbers(self):
        rows = [
            ["1", "abate", "to lessen", "", "", ""],
            ["", "", "", "", "", ""],
            ["1", "", "no headword", "", "", ""],
        ]
        r = self._import_section(rows)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json()["errors"][0]["row"], 4)  # the spacer row still counts

    def test_excel_bom_is_stripped(self):
        r = self._import_section(GOOD_ROWS, bom=True)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["created_words"], 3)

    def test_missing_required_header_is_400(self):
        r = self._import_section([["x", "y"]], header=["set", "meaning"])
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("word", r.json()["detail"])
        self.assertNotIn("errors", r.json())

    def test_missing_file_is_400(self):
        r = self.client.post(
            f"/api/vocabulary/admin/sections/{self.section.id}/import-csv/",
            {},
            format="multipart",
        )
        self.assertEqual(r.status_code, 400, r.content)

    def test_empty_csv_is_400(self):
        r = self._import_section([])
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("no word rows", r.json()["detail"])

    def test_row_cap_is_enforced(self):
        rows = [["1", f"word{i}", "meaning", "", "", ""] for i in range(2001)]
        r = self._import_section(rows)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("2000", r.json()["detail"])
        self.assertEqual(VocabWord.objects.count(), 0)

    def test_rows_without_a_set_column_share_one_set(self):
        r = self._import_section(
            [["abate", "to lessen"], ["candid", "frank"]], header=["word", "definition"]
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["created_sets"], 1)
        self.assertEqual(VocabSet.objects.get(pk=r.json()["set_ids"][0]).title, "Set 1")

    def test_a_teacher_cannot_import(self):
        teacher = User.objects.create_user(
            "vocab_csv_teacher@t.com", role=acc_const.ROLE_TEACHER, subject="english"
        )
        client = APIClient()
        client.force_authenticate(teacher)
        r = client.post(
            f"/api/vocabulary/admin/sections/{self.section.id}/import-csv/",
            {"file": _upload(GOOD_ROWS)},
            format="multipart",
        )
        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(VocabWord.objects.count(), 0)


class SetImportTests(CsvFixture):
    def setUp(self):
        super().setUp()
        self.vset = VocabSet.objects.create(section=self.section, title="Set 1", order=0)

    def test_every_row_lands_in_the_target_set_and_the_set_column_is_ignored(self):
        r = self._import_set(self.vset, GOOD_ROWS)
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual(body["set_id"], self.vset.id)
        self.assertEqual(body["created_count"], 3)
        self.assertEqual((body["created_words"], body["linked_words"]), (3, 0))
        self.assertEqual(len(body["word_ids"]), 3)
        self.assertEqual(VocabSet.objects.count(), 1)  # no extra sets from the `set` column
        self.assertEqual(self._words_of(self.vset), ["abate", "candid", "deft"])

    def test_appends_after_the_existing_words(self):
        VocabSetItem.objects.create(
            vocab_set=self.vset,
            word=VocabWord.objects.create(section=self.section, word="prior", definition="earlier"),
            order=0,
        )
        self._import_set(self.vset, [["", "abate", "to lessen", "", "", ""]])
        orders = list(
            VocabSetItem.objects.filter(vocab_set=self.vset)
            .order_by("order")
            .values_list("order", flat=True)
        )
        self.assertEqual(orders, [0, 1])
        self.assertEqual(self._words_of(self.vset), ["prior", "abate"])

    def test_word_already_in_the_set_is_a_row_error(self):
        VocabSetItem.objects.create(
            vocab_set=self.vset,
            word=VocabWord.objects.create(section=self.section, word="abate", definition="to lessen"),
            order=0,
        )
        r = self._import_set(self.vset, [["", "abate", "to lessen", "", "", ""]])
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json()["errors"], [{"row": 2, "errors": {"word": ["Already in this set."]}}])
        self.assertEqual(VocabSetItem.objects.filter(vocab_set=self.vset).count(), 1)

    def test_a_bad_row_appends_nothing(self):
        rows = [
            ["", "abate", "to lessen", "", "", ""],
            ["", "candid", "", "", "", ""],  # no definition
        ]
        r = self._import_set(self.vset, rows)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("definition", r.json()["errors"][0]["errors"])
        self.assertEqual(VocabSetItem.objects.filter(vocab_set=self.vset).count(), 0)
        self.assertEqual(VocabWord.objects.count(), 0)

    def test_a_custom_set_cannot_be_imported_into(self):
        student = User.objects.create_user("vocab_csv_student@t.com")
        custom = VocabSet.objects.create(owner=student, title="Mine")
        r = self._import_set(custom, GOOD_ROWS)
        self.assertEqual(r.status_code, 404, r.content)

    def test_reused_headwords_are_not_reported_as_newly_authored(self):
        VocabWord.objects.create(section=self.section, word="abate", definition="to lessen")
        r = self._import_set(
            self.vset,
            [
                ["", "Abate", "to lessen", "", "", ""],
                ["", "candid", "frank", "", "", ""],
            ],
        )
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual(body["created_count"], 2)  # items added to the SET
        self.assertEqual(body["created_words"], 1)  # only "candid" is a new bank word
        self.assertEqual(body["linked_words"], 1)  # "abate" was already in the section
        self.assertEqual(VocabWord.objects.filter(section=self.section).count(), 2)


class ImportRaceTests(CsvFixture):
    """
    Two authors importing the same headword at once. The re-read inside the write
    transaction narrows the window but cannot close it, so the INSERT itself has to
    settle the race — with a clean link, not a 500.
    """

    def test_a_headword_committed_mid_write_is_linked(self):
        real_create = VocabSet.objects.create

        def create_set_then_race(**kwargs):
            # Stands in for the other author: this runs inside _write_plans' transaction,
            # after its re-read of the section's words and before the first word INSERT.
            VocabWord.objects.create(
                section=self.section, word="abate", definition="to grow less"
            )
            return real_create(**kwargs)

        with mock.patch.object(
            VocabSet.objects, "create", side_effect=create_set_then_race
        ):
            r = self._import_section([["1", "abate", "to lessen", "", "", ""]])

        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual((r.json()["created_words"], r.json()["linked_words"]), (0, 1))
        # One row for the headword — the winner's, wording untouched — linked into the set.
        words = list(VocabWord.objects.filter(section=self.section))
        self.assertEqual([w.definition for w in words], ["to grow less"])
        items = VocabSetItem.objects.filter(vocab_set_id=r.json()["set_ids"][0])
        self.assertEqual([i.word_id for i in items], [words[0].id])
