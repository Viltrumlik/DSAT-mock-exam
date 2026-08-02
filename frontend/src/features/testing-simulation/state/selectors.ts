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

/**
 * Whether this attempt is a midterm, as the SERVER labelled it.
 *
 * The runner is reached for a midterm by `?src=midterm`, but that query param says which
 * BACKEND to talk to, not what the paper is — a resumed link, a copied URL or an admin
 * preview can lose it. `mock_kind` travels with the attempt itself, so anything that
 * changes what a midterm looks like keys on this and not on the param.
 */
export function isMidtermAttempt(attempt: Attempt | null): boolean {
  return attempt?.practice_test_details?.mock_kind === "MIDTERM";
}

export function moduleLabel(attempt: Attempt | null): string {
  const subject = subjectKind(attempt) === "MATH" ? "Math" : "Reading and Writing";
  // A single-module midterm is ONE paper — the SAT "Section 2, Module 1" rail is meaningless
  // and reads as if more modules were coming. A TWO-module midterm does have parts, so it
  // shows "— Module N" so the student knows which one they are on.
  if (isMidtermAttempt(attempt)) {
    const base = attempt?.practice_test_details?.title?.trim() || `${subject} Midterm`;
    const modules = attempt?.practice_test_details?.modules ?? [];
    if (modules.length > 1) {
      const order = attempt?.current_module_details?.module_order ?? 1;
      return `${base} — Module ${order}`;
    }
    return base;
  }
  const order = attempt?.current_module_details?.module_order ?? 1;
  const section = subjectKind(attempt) === "MATH" ? 2 : 1;
  return `Section ${section}, Module ${order}: ${subject}`;
}

/** Whether this attempt offers a manual Pause button (pastpapers yes, mocks and midterms no). */
export function pauseAllowed(attempt: Attempt | null, mockFlow: boolean): boolean {
  // Pastpapers pause on demand; midterms and full mocks are strictly timed — a student
  // sitting a mock can never CHOOSE to stop the clock.
  const kind = attempt?.practice_test_details?.mock_kind;
  return !mockFlow && kind !== "MIDTERM" && kind !== "MOCK";
}

/**
 * Whether this sitting is INVIGILATED — fullscreen enforced and leaving the screen policed
 * by the off-screen rule.
 *
 * Read off the ATTEMPT, never off the URL. `?src=midterm` / `?src=mock` say which backend
 * to talk to, not what the paper is, and a copied link or a resumed session can lose a
 * query param — a rule that can be dropped by editing the address bar is not a rule. The
 * server publishes `proctored` on every snapshot; midterms are proctored by definition, a
 * mock is proctored exactly when it is sat in a session, and solo practice never is.
 */
export function isProctored(attempt: Attempt | null): boolean {
  if (attempt?.practice_test_details?.mock_kind === "MIDTERM") return true;
  return Boolean((attempt as unknown as { proctored?: boolean } | null)?.proctored);
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
