import { OUTCOMES, type OutcomeKey, type rateTone } from "./outcome";
import type { Tally } from "./types";

/**
 * The midterm page's colours in the console's tokens (design handoff v0.3).
 *
 * `outcome.ts` keeps the vocabulary (what each outcome is called, in what order); this keeps how
 * each one is drawn: green passed, red failed, amber did not come, grey still waiting. The same
 * four colours on every bar, legend, number and chart of the page.
 */

/** A bar segment or legend dot. */
export const OUTCOME_FILL: Record<OutcomeKey, string> = {
  passed: "bg-ms-positive",
  failed: "bg-ms-critical",
  absent: "bg-ms-attention",
  pending: "bg-ms-neutral",
};

/** A count of that outcome in a table. */
export const OUTCOME_TEXT: Record<OutcomeKey, string> = {
  passed: "text-ms-positive-fg",
  failed: "text-ms-critical-fg",
  absent: "text-ms-attention-fg",
  pending: "text-ms-fg-3",
};

/** The same colours for the charts, which take a CSS value rather than a class. */
export const OUTCOME_COLOR: Record<OutcomeKey, string> = {
  passed: "var(--ms-positive)",
  failed: "var(--ms-critical)",
  absent: "var(--ms-attention)",
  pending: "var(--ms-neutral)",
};

type RateTone = ReturnType<typeof rateTone>;

/** The headline pass rate's number, by how it should feel (see `rateTone`). */
export const RATE_TONE_TEXT: Record<RateTone, string> = {
  good: "text-ms-positive-fg",
  fair: "text-ms-attention-fg",
  poor: "text-ms-critical-fg",
  none: "text-ms-fg-3",
};

/** …and the bar under it. */
export const RATE_TONE_FILL: Record<RateTone, string> = {
  good: "bg-ms-positive",
  fair: "bg-ms-attention",
  poor: "bg-ms-critical",
  none: "bg-ms-surface-3",
};

/** The month's outcomes as chart data in the console's colours, the empty ones dropped (as `outcomeSlices`). */
export function outcomeSlicesMs(tally: Pick<Tally, OutcomeKey>) {
  return OUTCOMES.map((o) => ({ name: o.label, value: tally[o.key] ?? 0, color: OUTCOME_COLOR[o.key] })).filter(
    (slice) => slice.value > 0,
  );
}
