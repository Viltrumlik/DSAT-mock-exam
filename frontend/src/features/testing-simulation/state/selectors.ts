/** Derived read-only views over an Attempt. Pure functions, no React. */
import type { Attempt, ExamQuestion, ExamSubjectKind } from "../types";

const RW = ["READING", "WRITING", "READING_WRITING", "READING AND WRITING", "ENGLISH", "RW", "VERBAL"];
const MATH = ["MATH", "MATHEMATICS"];

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase().replace(/[_\s]+/g, " ");
}

export function subjectKind(attempt: Attempt | null): ExamSubjectKind {
  const s = norm(attempt?.practice_test_details?.subject);
  if (MATH.some((m) => s.includes(m))) return "MATH";
  if (RW.some((r) => s.includes(r.replace(/_/g, " ")))) return "READING_WRITING";
  // Default to RW layout (two-pane) when ambiguous.
  return "READING_WRITING";
}

export const isMath = (a: Attempt | null): boolean => subjectKind(a) === "MATH";
export const isReadingWriting = (a: Attempt | null): boolean => subjectKind(a) === "READING_WRITING";

export function questions(attempt: Attempt | null): ExamQuestion[] {
  return attempt?.current_module_details?.questions ?? [];
}

export function moduleLabel(attempt: Attempt | null): string {
  const order = attempt?.current_module_details?.module_order ?? 1;
  const subject = subjectKind(attempt) === "MATH" ? "Math" : "Reading and Writing";
  const section = subjectKind(attempt) === "MATH" ? 2 : 1;
  return `Section ${section}, Module ${order}: ${subject}`;
}

/** Whether this attempt allows manual pause (pastpapers yes, mocks no). */
export function pauseAllowed(attempt: Attempt | null, mockFlow: boolean): boolean {
  // Pastpapers pause; midterms and full mocks are strictly timed (no pause).
  const kind = attempt?.practice_test_details?.mock_kind;
  return !mockFlow && kind !== "MIDTERM" && kind !== "MOCK";
}

/**
 * Whether the runner may offer the Desmos calculator.
 *
 * Math-only everywhere. Pastpapers/mocks follow the SAT (Math module = calculator).
 * Midterms used to be blanket-denied; they are now level-gated — a Math midterm at
 * middle/senior offers it, matching the assessment rule. The decision is made SERVER-side
 * (`calculator_enabled` on the midterm's practice_test_details) rather than re-derived
 * here, so the rule lives in one place and the subject-casing difference can't bite.
 */
export function calculatorAllowed(attempt: Attempt | null): boolean {
  if (!isMath(attempt)) return false;
  if (attempt?.practice_test_details?.mock_kind !== "MIDTERM") return true;
  return Boolean(attempt?.practice_test_details?.calculator_enabled);
}
