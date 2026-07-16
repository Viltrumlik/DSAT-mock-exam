"""SCALE_800 must land on the SAT's 10-point grid.

A real SAT section score only exists in 10-point steps (200, 210 … 800). The old linear
map returned any integer (e.g. 43/58 -> 645), which is not a reportable score.
"""
from __future__ import annotations

from django.test import TestCase

from midterms.scoring import SCALE_100, SCALE_800, compute_score


class Scale800GridTests(TestCase):
    def test_every_possible_tally_is_a_multiple_of_ten_in_range(self):
        for total in (1, 7, 22, 29, 44, 58):
            for correct in range(total + 1):
                s = compute_score(correct, total, SCALE_800)
                self.assertEqual(s % 10, 0, f"{correct}/{total} -> {s} is not a multiple of 10")
                self.assertGreaterEqual(s, 200)
                self.assertLessEqual(s, 800)

    def test_endpoints_stay_exact(self):
        self.assertEqual(compute_score(0, 29, SCALE_800), 200)
        self.assertEqual(compute_score(29, 29, SCALE_800), 800)
        self.assertEqual(compute_score(0, 0, SCALE_800), 200)  # empty midterm

    def test_the_reported_case_645_now_snaps(self):
        # 43/58 produced 645 on prod — not a real SAT score.
        self.assertEqual(compute_score(43, 58, SCALE_800), 640)

    def test_snaps_to_the_nearest_ten_not_always_down(self):
        self.assertEqual(compute_score(22, 29, SCALE_800), 660)  # raw 655 -> up
        self.assertEqual(compute_score(20, 29, SCALE_800), 610)  # raw 614 -> down
        self.assertEqual(compute_score(15, 29, SCALE_800), 510)  # raw 510 -> unchanged

    def test_scale_100_is_untouched(self):
        # The percentage scale must keep its exact integer values (migration identity).
        self.assertEqual(compute_score(10, 29, SCALE_100), 34)
        self.assertEqual(compute_score(43, 58, SCALE_100), 74)
        self.assertEqual(compute_score(0, 0, SCALE_100), 0)
