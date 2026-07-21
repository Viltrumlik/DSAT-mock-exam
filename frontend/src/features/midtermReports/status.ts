/**
 * Turning report rows into the verdict shown in a cell.
 *
 * Pure and separate from the components so the one rule that actually matters here is
 * testable: a midterm with no pass mark (a PRE_MIDTERM) is *ungraded*, not failed. The
 * backend expresses "ungraded" three different ways depending on how far the sitting got —
 * `pass_mark: null`, `passed: null`, `final_status: "NOT_GRADED"` — and a naive
 * `passed === false ? "Failed"`-style read of any of them puts a red FAILED pill against a
 * student who was never judged at all.
 */
import type { FinalStatus, MidtermBrief, MidtermState, ReportRow } from "./types";

/**
 * How a pill reads. Colour is only half of it — the tone also selects the pill's icon, so
 * the three verdicts stay distinguishable without colour vision.
 */
export type PillTone = "pass" | "fail" | "absent" | "waiting" | "ungraded";

export type Pill = { tone: PillTone; label: string };

/** A midterm is pass/fail graded iff the API gave it a pass mark. */
export function isGraded(midterm: Pick<MidtermBrief, "pass_mark">): boolean {
  return midterm.pass_mark != null;
}

const STATE_LABELS: Record<MidtermState, string> = {
  ABSENT: "Absent",
  NOT_STARTED: "Not started",
  ACTIVE: "In progress",
  SCORING: "Scoring",
  COMPLETED: "Completed",
  ABANDONED: "Abandoned",
};

/** Neither absent nor finished — the student is somewhere mid-sitting. */
function inFlightPill(state: MidtermState | null): Pill {
  if (state === "ABSENT" || state == null) return { tone: "absent", label: "Absent" };
  return { tone: "waiting", label: STATE_LABELS[state] ?? "Pending" };
}

/**
 * The Result / Retake result cell for one sitting.
 *
 * `passed` is null for every no-verdict case, so `graded` is what separates "we are still
 * waiting for a verdict" from "there will never be one".
 */
export function sittingPill(
  graded: boolean,
  passed: boolean | null,
  state: MidtermState | null,
): Pill {
  if (passed === true) return { tone: "pass", label: "Passed" };
  if (passed === false) return { tone: "fail", label: "Failed" };
  if (state === "COMPLETED") {
    return graded
      ? // Completed, graded, yet no verdict: the frozen outcome is missing (see the backfill
        // note in admin_report._sitting). Say so rather than inventing a pass or a fail.
        { tone: "waiting", label: "Awaiting result" }
      : { tone: "ungraded", label: "Not graded" };
  }
  return inFlightPill(state);
}

/** The Final cell — the whole midterm+retake story for one student in one pill. */
export function finalPill(row: ReportRow, graded: boolean): Pill {
  switch (row.final_status as FinalStatus) {
    case "PASSED":
      return { tone: "pass", label: "Passed" };
    case "PASSED_ON_RETAKE":
      return { tone: "pass", label: "Passed on retake" };
    case "FAILED":
      return { tone: "fail", label: "Failed" };
    case "ABSENT":
      return { tone: "absent", label: "Absent" };
    case "NOT_GRADED":
      return { tone: "ungraded", label: "Not graded" };
    default:
      // PENDING, plus any status a newer backend adds. Falling back through sittingPill keeps
      // an ungraded midterm out of the failure vocabulary whatever the wire says.
      return sittingPill(graded, null, row.midterm_state);
  }
}

/** "440 / 800", or an em dash when there is no score to show. */
export function formatScore(score: number | null, ceiling?: number | null): string {
  if (score == null) return "—";
  return ceiling ? `${score} / ${ceiling}` : String(score);
}

/** True when this row is one an admin has to act on. Drives the "Only failed" filter. */
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
