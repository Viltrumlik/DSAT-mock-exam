/**
 * How a typed numeric answer is read, mirrored from `backend/assessments/grading.py` so the
 * answer box, a teacher's Check and the grader agree on what a student wrote.
 */

/**
 * A number the way students here write it: Uzbek schools write a decimal with a comma
 * ("2,5"), and phones and pasted worksheets give the typographic minus (U+2212). Only a
 * single comma with no point is a decimal comma. Mirrors `_number_as_written_here`.
 */
export function numberAsWrittenHere(s: string): string {
  const t = s.replace(/\u2212/g, "-");
  return (t.match(/,/g) ?? []).length === 1 && !t.includes(".") ? t.replace(",", ".") : t;
}

/** One letter (Latin or Cyrillic "х"), "=", then the answer. */
const LETTER_EQUALS = /^\p{L}\s*=\s*/u;

/**
 * A numeric answer as written on paper: "x=5" and "x = 12" are 5 and 12 (owner, 2026-11-24).
 * Only one letter then "=" is read away; "2x=10" stays unreadable. Mirrors `_numeric_answer_text`.
 */
export function numericAnswerText(s: string): string {
  return numberAsWrittenHere(s.trim().replace(LETTER_EQUALS, ""));
}
