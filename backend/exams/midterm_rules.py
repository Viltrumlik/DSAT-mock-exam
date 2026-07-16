"""
Midterm Rule Engine — authoritative source of truth for MIDTERM exams.

Midterms are institution-controlled and deliberately DO NOT follow the official
Digital SAT structure (see sat_rules.py). They have their own rules:

  - Per-module question limit is builder-configurable (default 30), NOT the SAT
    22 (Math) / 27 (R&W) counts.
  - Module time is freely set in the builder (no fixed per-subject limits).
  - Scoring uses MockExam.midterm_scoring_scale (100-point or 800-point).
  - The reference sheet is hidden.
  - The Desmos calculator is LEVEL-GATED, not hidden: a Math midterm at middle/senior
    level offers it. The rule lives on the new app's model (midterms.Midterm.
    calculator_enabled, driven by MockExam.midterm_level which sync mirrors), NOT here.

Keep in sync with the frontend mirror: frontend/src/lib/midtermRules.ts
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import MockExam

# ── Per-module question limit ───────────────────────────────────────────────
# Default cap applied when a midterm has no explicit limit set. Builder-
# configurable via MockExam.midterm_module_question_limit.

MIDTERM_DEFAULT_MODULE_QUESTION_LIMIT = 30

# ── Exam-runner tooling ─────────────────────────────────────────────────────
# The calculator is NOT a constant — it is level-gated per midterm (see the module
# docstring and midterms.Midterm.calculator_enabled).

MIDTERM_REFERENCE_SHEET_ENABLED = False


def midterm_module_question_limit(exam: "MockExam | None") -> int:
    """Hard per-module question cap for a midterm.

    Falls back to MIDTERM_DEFAULT_MODULE_QUESTION_LIMIT when the exam has no
    explicit value (0 / None).
    """
    value = getattr(exam, "midterm_module_question_limit", None)
    return int(value) if value else MIDTERM_DEFAULT_MODULE_QUESTION_LIMIT
