"""Full-mock section scores must land on the SAT's 10-point grid.

A section score only exists in 10-point steps (200, 210 … 800) — the proportional curve
returned any integer (e.g. 466). The snap happens ONCE on the assembled section total,
after the 800 cap, never per module: compute_sat_module_score returns a share of a cap
(Math 380 + 220), and rounding those separately would stop a perfect run summing to
exactly 800.
"""
from __future__ import annotations

from django.test import SimpleTestCase

from exams.sat_rules import (
    SAT_MODULE_SCORE_CAP,
    SAT_SECTION_BASE_SCORE,
    SAT_SECTION_MAX_SCORE,
    compute_sat_module_score,
    snap_to_sat_score_grid,
)


def _section(subject: str, m1_frac: float, m2_frac: float) -> int:
    """Rebuild what mocks.scoring.score_section computes, without DB fixtures."""
    section = SAT_SECTION_BASE_SCORE
    for order, frac in ((1, m1_frac), (2, m2_frac)):
        section += compute_sat_module_score(
            earned_points=int(frac * 100), total_possible_points=100, subject=subject, module_order=order
        )
    return snap_to_sat_score_grid(min(section, SAT_SECTION_MAX_SCORE))


class SectionGridTests(SimpleTestCase):
    def test_perfect_section_is_still_exactly_800(self):
        for subject in ("MATH", "READING_WRITING"):
            self.assertEqual(_section(subject, 1.0, 1.0), 800, subject)

    def test_empty_section_is_still_exactly_200(self):
        for subject in ("MATH", "READING_WRITING"):
            self.assertEqual(_section(subject, 0.0, 0.0), 200, subject)

    def test_every_combination_is_a_multiple_of_ten_in_range(self):
        for subject in ("MATH", "READING_WRITING"):
            for a in range(0, 101, 7):
                for b in range(0, 101, 11):
                    s = _section(subject, a / 100, b / 100)
                    self.assertEqual(s % 10, 0, f"{subject} {a}/{b} -> {s}")
                    self.assertGreaterEqual(s, 200)
                    self.assertLessEqual(s, 800)

    def test_module_one_perfect_alone_matches_the_documented_ceiling(self):
        # Math M1 cap 380 -> 580; R&W M1 cap 330 -> 530 (both already multiples of 10).
        self.assertEqual(_section("MATH", 1.0, 0.0), 580)
        self.assertEqual(_section("READING_WRITING", 1.0, 0.0), 530)

    def test_a_raw_non_multiple_snaps(self):
        # Math M1 at 70%: 380*0.7 = 266 -> 200+266 = 466 raw -> 470 on the grid.
        raw = SAT_SECTION_BASE_SCORE + compute_sat_module_score(
            earned_points=70, total_possible_points=100, subject="MATH", module_order=1
        )
        self.assertEqual(raw, 466)
        self.assertEqual(_section("MATH", 0.7, 0.0), 470)

    def test_snap_helper_leaves_the_grid_endpoints_untouched(self):
        self.assertEqual(snap_to_sat_score_grid(200), 200)
        self.assertEqual(snap_to_sat_score_grid(800), 800)
        self.assertEqual(snap_to_sat_score_grid(795), 800)  # never exceeds the cap
        self.assertEqual(snap_to_sat_score_grid(204), 200)

    def test_caps_are_multiples_of_ten_so_the_grid_is_reachable(self):
        for subject, caps in SAT_MODULE_SCORE_CAP.items():
            for order, cap in caps.items():
                self.assertEqual(cap % 10, 0, f"{subject} M{order} cap={cap}")
