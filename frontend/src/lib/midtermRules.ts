/**
 * Midterm Rule Engine — canonical frontend source of truth for MIDTERM exams.
 *
 * This module mirrors backend/exams/midterm_rules.py.
 * When changing midterm rules, update BOTH files.
 *
 * Midterms deliberately DO NOT follow the official Digital SAT structure
 * (see satRules.ts). Their rules:
 *   - Per-module question limit is builder-configurable (default 30).
 *   - Module time is freely set in the builder.
 *   - Scoring uses the chosen 100-point or 800-point scale.
 *   - The Desmos calculator is hidden.
 *   - The reference sheet is hidden.
 */

import type { ModuleProgress } from "./satRules";

// ── Per-module question limit ────────────────────────────────────────────────

export const MIDTERM_DEFAULT_MODULE_QUESTION_LIMIT = 30;

// ── Exam-runner tooling (midterms never offer these) ─────────────────────────

export const MIDTERM_CALCULATOR_ENABLED = false;
export const MIDTERM_REFERENCE_SHEET_ENABLED = false;

/** Resolve the effective per-module question limit (default when unset). */
export function midtermModuleQuestionLimit(limit: number | null | undefined): number {
  return limit && limit > 0 ? limit : MIDTERM_DEFAULT_MODULE_QUESTION_LIMIT;
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
