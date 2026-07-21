/**
 * Midterm Rule Engine — canonical frontend source of truth for MIDTERM exams.
 *
 * This module mirrors backend/exams/midterm_rules.py; changing a midterm rule means
 * changing BOTH files. Two later backend modules also publish numbers a student is
 * TOLD before they sit the paper, and they are mirrored here for the same reason —
 * the rules screen must never quote a figure the server doesn't enforce:
 *   - backend/midterms/proctoring.py  → the off-screen grace + offence limit
 *   - backend/midterms/outcomes.py    → the default pass mark
 * Both are also sent on the attempt snapshot, so the mirrors below are FALLBACKS for
 * the pre-start screens (which render before any snapshot carries them), never an
 * override of what the server says.
 *
 * Midterms deliberately DO NOT follow the official Digital SAT structure
 * (see satRules.ts). Their rules:
 *   - Per-module question limit is builder-configurable (default 30).
 *   - Module time is freely set in the builder.
 *   - Scoring uses the chosen 100-point or 800-point scale.
 *   - The reference sheet is hidden.
 *   - There is no pause and no early submit — the paper is taken in when time runs out.
 *   - Leaving the exam window is an offence; the third one forfeits the sitting.
 *   - The Desmos calculator is LEVEL-GATED, not hidden: a Math midterm at middle/senior
 *     offers it. The server decides (Midterm.calculator_enabled) and the runner reads it
 *     via `calculatorAllowed` in testing-simulation/state/selectors.ts.
 */

import type { ModuleProgress } from "./satRules";

// ── Per-module question limit ────────────────────────────────────────────────

export const MIDTERM_DEFAULT_MODULE_QUESTION_LIMIT = 30;

// ── Exam-runner tooling ──────────────────────────────────────────────────────
// The calculator is NOT a constant — it is level-gated per midterm; see the header.
export const MIDTERM_REFERENCE_SHEET_ENABLED = false;

/** Resolve the effective per-module question limit (default when unset). */
export function midtermModuleQuestionLimit(limit: number | null | undefined): number {
  return limit && limit > 0 ? limit : MIDTERM_DEFAULT_MODULE_QUESTION_LIMIT;
}

// ── Off-screen rule (mirrors backend/midterms/proctoring.py) ─────────────────
// The student sits the paper in fullscreen. Leaving it — tabbing away, switching
// window, minimising — is an offence: the first two buy GRACE_SECONDS to come back,
// the third takes the paper in outright. The SERVER counts (a browser tally is wiped
// by a refresh, which is exactly what a student gaming the rule would do); these
// numbers exist so the runner can render the countdown and so the rules screen can
// state the rule before the student agrees to it.

export const MIDTERM_OFFSCREEN_GRACE_SECONDS = 3;
export const MIDTERM_OFFSCREEN_VIOLATION_LIMIT = 3;

/** Offences the student has left before the sitting is forfeited. */
export function offscreenChancesLeft(
  violations: number,
  limit: number = MIDTERM_OFFSCREEN_VIOLATION_LIMIT,
): number {
  return Math.max(0, limit - Math.max(0, violations));
}

/** "2 chances left" / "1 chance left" / "no chances left" — the warning's subtitle. */
export function offscreenChancesLabel(
  violations: number,
  limit: number = MIDTERM_OFFSCREEN_VIOLATION_LIMIT,
): string {
  const left = offscreenChancesLeft(violations, limit);
  if (left === 0) return "no chances left";
  return `${left} ${left === 1 ? "chance" : "chances"} left`;
}

// ── Pass mark (mirrors backend/midterms/outcomes.py) ─────────────────────────
// Expressed as a FRACTION of the questions, never as a percent of the ceiling: a blank
// 800-scale paper still scores 200, so "25% of 800" and "0% of the work" are the same
// paper. Both scales therefore share one rule at 50% of the questions correct.

export const MIDTERM_DEFAULT_PASS_FRACTION = 0.5;

/** [floor, ceiling] of a scale — the score a blank paper gets and a perfect one gets. */
const SCALE_BOUNDS: Record<string, [number, number]> = {
  SCALE_100: [0, 100],
  SCALE_800: [200, 800],
};

export function midtermScaleBounds(scoringScale: string | null | undefined): [number, number] {
  return SCALE_BOUNDS[scoringScale ?? ""] ?? SCALE_BOUNDS.SCALE_100;
}

/**
 * The score a student must reach to pass, on the midterm's own scale.
 * `passMark` is the midterm's authored value; null/undefined falls back to the default.
 */
export function midtermPassMark(
  scoringScale: string | null | undefined,
  passMark?: number | null,
): number {
  if (typeof passMark === "number" && Number.isFinite(passMark)) return Math.round(passMark);
  const [floor, ceiling] = midtermScaleBounds(scoringScale);
  return Math.round(floor + MIDTERM_DEFAULT_PASS_FRACTION * (ceiling - floor));
}

/** "500 out of 800" — how the pass mark is quoted to a student. */
export function midtermPassMarkLabel(
  scoringScale: string | null | undefined,
  passMark?: number | null,
): string {
  const [, ceiling] = midtermScaleBounds(scoringScale);
  return `${midtermPassMark(scoringScale, passMark)} out of ${ceiling}`;
}

/**
 * Progress toward a midterm module's question limit.
 * Mirrors satRules.getModuleProgress() shape so the authoring UI can swap
 * between SAT and midterm rules without branching on the return type.
 */
export function getMidtermModuleProgress(
  currentCount: number,
  limit: number | null | undefined,
): ModuleProgress {
  const required = midtermModuleQuestionLimit(limit);
  const complete = currentCount === required;
  const over = currentCount > required;
  const fraction = Math.min(currentCount / required, 1);

  return {
    current: currentCount,
    required,
    fraction,
    complete,
    over,
    label: `${currentCount} / ${required}`,
  };
}
