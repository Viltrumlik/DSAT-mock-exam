/**
 * The midterm rules a student is TOLD before sitting the paper, ported from the site's
 * frontend/src/lib/midtermRules.ts. They mirror backend/midterms/proctoring.py (the off-screen
 * grace + offence limit) and backend/midterms/outcomes.py (the default pass mark). The server
 * sends the live values on every snapshot; these are the fallbacks for the pre-start screens,
 * never an override of what the server says.
 *
 * Importers: exam/lockdown/useOffscreenGuard.ts, exam/midterm/MidtermRulesScreen.tsx.
 */

export const MIDTERM_OFFSCREEN_GRACE_SECONDS = 3;
export const MIDTERM_OFFSCREEN_VIOLATION_LIMIT = 3;

/** Offences the student has left before the sitting is forfeited. */
export function offscreenChancesLeft(violations: number, limit: number = MIDTERM_OFFSCREEN_VIOLATION_LIMIT): number {
  return Math.max(0, limit - Math.max(0, violations));
}

/** "2 chances left" / "1 chance left" / "no chances left" — the warning's subtitle. */
export function offscreenChancesLabel(violations: number, limit: number = MIDTERM_OFFSCREEN_VIOLATION_LIMIT): string {
  const left = offscreenChancesLeft(violations, limit);
  if (left === 0) return "no chances left";
  return `${left} ${left === 1 ? "chance" : "chances"} left`;
}

// Expressed as a FRACTION of the questions, never a percent of the ceiling: a blank 800-scale
// paper still scores 200, so both scales share one rule at 50% of the questions correct.
export const MIDTERM_DEFAULT_PASS_FRACTION = 0.5;

const SCALE_BOUNDS: Record<string, [number, number]> = {
  SCALE_100: [0, 100],
  SCALE_800: [200, 800],
};

export function midtermScaleBounds(scoringScale: string | null | undefined): [number, number] {
  return SCALE_BOUNDS[scoringScale ?? ""] ?? SCALE_BOUNDS.SCALE_100;
}

export function midtermPassMark(scoringScale: string | null | undefined, passMark?: number | null): number {
  if (typeof passMark === "number" && Number.isFinite(passMark)) return Math.round(passMark);
  const [floor, ceiling] = midtermScaleBounds(scoringScale);
  return Math.round(floor + MIDTERM_DEFAULT_PASS_FRACTION * (ceiling - floor));
}

/** "500 out of 800" — how the pass mark is quoted to a student. */
export function midtermPassMarkLabel(scoringScale: string | null | undefined, passMark?: number | null): string {
  const [, ceiling] = midtermScaleBounds(scoringScale);
  return `${midtermPassMark(scoringScale, passMark)} out of ${ceiling}`;
}
