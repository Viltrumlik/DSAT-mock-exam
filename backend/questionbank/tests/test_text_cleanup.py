"""Kerning-split word repair (dictionary rejoin)."""
from django.test import TestCase

from questionbank.import_pipeline import create_batch_from_pages
from questionbank.text_cleanup import dejoin_kerning


class DejoinKerningTests(TestCase):
    def test_rejoins_kerning_split_words(self):
        self.assertEqual(dejoin_kerning("census repor ted approximately"), "census reported approximately")
        self.assertEqual(dejoin_kerning("inver tebrate"), "invertebrate")
        self.assertEqual(dejoin_kerning("por trait"), "portrait")

    def test_leaves_real_word_pairs_apart(self):
        self.assertEqual(dejoin_kerning("and colleagues"), "and colleagues")
        self.assertEqual(dejoin_kerning("the main idea"), "the main idea")

    def test_preserves_trailing_punctuation(self):
        self.assertEqual(dejoin_kerning("repor ted,"), "reported,")

    def test_no_op_on_empty(self):
        self.assertEqual(dejoin_kerning(""), "")

    def test_applied_during_import(self):
        page = (
            "Test: Reading and Writing\nQuestion\nThe census repor ted high counts.\n"
            "A. one\nB. two\nCorrect Answer: A\nRationale\nBecause the counts were high.\n"
        )
        batch = create_batch_from_pages([page])
        cand = batch.candidates.get()
        self.assertIn("reported", cand.question_text)
        self.assertNotIn("repor ted", cand.question_text)
