/**
 * Turning a report row into the ONE verdict shown against a student.
 *
 * Pure and separate from the components so the rules that matter are testable, and there are
 * three of them:
 *
 * 1. **A midterm with no pass mark (a pre-midterm) is *ungraded*, not failed.** The backend
 *    expresses "ungraded" three different ways depending on how far the sitting got —
 *    `pass_mark: null`, `passed: null`, `final_status: "NOT_GRADED"` — and a naive
 *    `passed === false ? "Failed"` read of any of them puts a red FAILED pill against a
 *    student who was never judged at all.
 * 2. **One student, one verdict.** The table used to carry three verdict columns (Result /
 *    Retake result / Final) which for most rows printed the same word two or three times.
 *    There is now a single {@link Outcome}, and the per-sitting facts are the scores.
 * 3. **Six labels, each with a stated meaning.** "Pending", "Awaiting result", "Not graded",
 *    "Not started" and "Scoring" were five ways of saying "no answer yet", shown in five
 *    tones with no legend anywhere. They collapse into one pill — *Awaiting result* — that
 *    carries the finer state as a subtitle, and every label on screen is explained by
 *    {@link legendFor} under the table it appears in.
 */
import type { FinalStatus, MidtermBrief, MidtermState, ReportRow } from "./types";

/**
 * How a pill reads. Colour is only half of it — the tone also selects the pill's icon, so the
 * verdicts stay distinguishable without colour vision and on a monochrome print-out.
 */
export type OutcomeTone = "pass" | "fail" | "absent" | "waiting" | "ungraded";

export type Outcome = {
  tone: OutcomeTone;
  /** One of exactly six strings. The whole vocabulary of this table. */
  label: string;
  /** What the label means, for the legend under the table. */
  meaning: string;
  /** The finer state, when there is one worth showing: "in progress", "scoring", … */
  detail?: string;
};

/** A midterm is pass/fail graded iff the API gave it a pass mark. */
export function isGraded(midterm: Pick<MidtermBrief, "pass_mark">): boolean {
  return midterm.pass_mark != null;
}

/**
 * The sub-state under an "Awaiting result" pill.
 *
 * Subordinate, never a competing label: an admin decides the same thing about all of these
 * (nothing yet — come back later), and the difference only matters once they are chasing a
 * specific student.
 */
const STATE_DETAIL: Record<MidtermState, string> = {
  ABSENT: "never opened",
  NOT_STARTED: "not started",
  ACTIVE: "in progress",
  SCORING: "being scored",
  COMPLETED: "sat, no verdict recorded",
  ABANDONED: "abandoned mid-sitting",
};

const PASSED: Outcome = {
  tone: "pass",
  label: "Passed",
  meaning: "Scored at or above the pass mark at the first sitting.",
};

const PASSED_ON_RETAKE: Outcome = {
  tone: "pass",
  label: "Passed on retake",
  meaning: "Did not reach the pass mark first time, and passed the retake. Counts as a pass.",
};

const FAILED: Outcome = {
  tone: "fail",
  label: "Failed",
  meaning: "Sat the paper (and any retake offered) without reaching the pass mark.",
};

const ABSENT: Outcome = {
  tone: "absent",
  label: "Absent",
  meaning: "On the roster but never sat the paper. Counts as not passed in every rate.",
};

const NOT_GRADED: Outcome = {
  tone: "ungraded",
  label: "Not graded",
  meaning: "A pre-midterm: scored, but never pass/fail judged, so nobody can pass or fail it.",
};

const AWAITING = (detail?: string): Outcome => ({
  tone: "waiting",
  label: "Awaiting result",
  meaning: "No verdict yet — still sitting, or sat and not yet given one. Not a failure.",
  detail,
});

/**
 * The single verdict for one student on one midterm (retake included).
 *
 * `graded` is what separates "we are still waiting for a verdict" from "there will never be
 * one", which is why it is a parameter rather than something inferred from the row.
 */
export function outcomeFor(row: ReportRow, graded: boolean): Outcome {
  if (!graded) return NOT_GRADED;
  switch (row.final_status as FinalStatus) {
    case "PASSED":
      return PASSED;
    case "PASSED_ON_RETAKE":
      return PASSED_ON_RETAKE;
    case "FAILED":
      return FAILED;
    case "ABSENT":
      return ABSENT;
    case "NOT_GRADED":
      return NOT_GRADED;
    default: {
      // PENDING, plus any status a newer backend adds. An absent student reaches here only
      // when the wire says PENDING and the attempt says ABSENT; say Absent, not Awaiting.
      if (row.midterm_state === "ABSENT") return ABSENT;
      return AWAITING(STATE_DETAIL[row.midterm_state]);
    }
  }
}

const TONE_ORDER: Record<OutcomeTone, number> = {
  pass: 0,
  fail: 1,
  absent: 2,
  waiting: 3,
  ungraded: 4,
};

/**
 * The legend for a table: every label actually used in it, once, in a fixed order.
 *
 * Built from the rendered rows rather than from the full vocabulary so the legend explains
 * what is on screen and nothing else.
 */
export function legendFor(outcomes: Outcome[]): Outcome[] {
  const seen = new Map<string, Outcome>();
  for (const o of outcomes) {
    if (!seen.has(o.label)) seen.set(o.label, { ...o, detail: undefined });
  }
  return [...seen.values()].sort(
    (a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.label.localeCompare(b.label),
  );
}

/** "440 / 800", or an em dash when there is no score to show. */
export function formatScore(score: number | null, ceiling?: number | null): string {
  if (score == null) return "—";
  return ceiling ? `${score} / ${ceiling}` : String(score);
}

/**
 * A score cell in words when there is no number.
 *
 * The old table printed one em dash for three different situations — never sat it, sat it
 * and has no score, has no retake to sit — separated only by a tooltip. Each now says what
 * it is.
 */
export function scoreText(
  score: number | null,
  ceiling: number | null | undefined,
  state: MidtermState | null,
): string {
  if (score != null) return formatScore(score, ceiling);
  if (state === "ABSENT" || state == null) return "Not sat";
  if (state === "NOT_STARTED") return "Not started";
  if (state === "ACTIVE") return "In progress";
  if (state === "ABANDONED") return "Abandoned";
  return "No score recorded";
}

/** Why a retake cell is empty for a student who was never offered one. */
export const NOT_OFFERED = "Not offered";

export const NOT_OFFERED_REASON =
  "Only a student who failed the midterm is given its retake — this student either passed it or has no verdict on it yet.";

/** True when this row is one an admin has to act on. Drives the table's own filter. */
export function isFailed(row: ReportRow): boolean {
  return row.final_status === "FAILED";
}

export function filterRows(rows: ReportRow[], onlyFailed: boolean): ReportRow[] {
  return onlyFailed ? rows.filter(isFailed) : rows;
}

/** "21 Jul 2026, 09:00" — the scheduled sitting, or an em dash when never scheduled. */
export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `Classroom.subject` → English. Never render the raw enum. */
export function classroomSubjectLabel(subject: string | null | undefined): string {
  if (!subject) return "";
  const key = subject.toUpperCase();
  if (key === "ENGLISH") return "English";
  if (key === "MATH") return "Math";
  if (key === "BOTH") return "English and Math";
  return subject;
}
