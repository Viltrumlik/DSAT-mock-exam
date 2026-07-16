"""Full-mock scorer: per-section SAT proportional (200–800) → combined 1600.

Reuses ``exams.sat_rules.compute_sat_module_score`` (the SAT per-module curve) and
``Question.check_answer`` — the mock's scale IS the SAT scale, unlike the midterm. Each
section = 200 + module-1 + module-2 (capped at 800); total = English + Math (max 1600).
"""

from __future__ import annotations

from exams.sat_rules import (
    SAT_SECTION_BASE_SCORE,
    SAT_SECTION_MAX_SCORE,
    compute_sat_module_score,
    snap_to_sat_score_grid,
)


def _grade_module(module, answers) -> tuple[int, int]:
    answers = answers or {}
    earned = 0
    total = 0
    for q in module.questions.all():
        pts = int(q.score or 0)
        total += pts
        if q.check_answer(answers.get(str(q.id))):
            earned += pts
    return earned, total


def score_section(modules, module_answers, subject) -> int:
    """Score one 2-module section onto the SAT 200–800 scale.

    Snapped to the SAT's 10-point grid ONCE, on the assembled total and after the cap —
    a section score is always a multiple of 10, and rounding the module contributions
    separately would stop the caps summing to exactly 800 on a perfect run.
    """
    section = SAT_SECTION_BASE_SCORE
    for module in modules:
        earned, total = _grade_module(module, (module_answers or {}).get(str(module.id), {}))
        section += compute_sat_module_score(
            earned_points=earned, total_possible_points=total, subject=subject, module_order=module.module_order
        )
    return snap_to_sat_score_grid(min(section, SAT_SECTION_MAX_SCORE))


def score_mock_attempt(attempt) -> dict:
    """Compute english/math/total (1600) from the attempt's module_answers."""
    mock = attempt.mock
    ma = attempt.module_answers or {}
    english = score_section(mock.english_modules(), ma, "READING_WRITING")
    math = score_section(mock.math_modules(), ma, "MATH")
    return {"english_score": english, "math_score": math, "total_score": english + math}
