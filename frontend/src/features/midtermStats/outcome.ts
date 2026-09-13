/**
 * The four things that can happen to a student in a month, in one place: what each is
 * CALLED and what colour it is.
 *
 * Both halves used to be scattered. The words drifted into the reporting dialect the
 * database speaks — "roster places", "did not pass", "awaiting a verdict" — which an
 * administrator has to translate before they can read a number; the owner asked for the
 * words people actually use. The colours did not exist at all: the page was one shade of
 * blue, so "passed" and "absent" looked exactly alike and every chart had to be read
 * through its legend.
 *
 * One rule holds the vocabulary together: **every label is something that happened to a
 * person**, so a reader never has to ask what is being counted.
 */

import type { GroupTally, Tally } from "./types";

export type OutcomeKey = "passed" | "failed" | "absent" | "pending";

export type Outcome = {
  key: OutcomeKey;
  /** What the school calls it. Plain words, never the database's. */
  label: string;
  /** Tailwind text colour for the figure. */
  text: string;
  /** Tailwind background for a chip, tile or bar segment. */
  fill: string;
  /** The same colour for recharts, which needs a CSS value rather than a class. */
  color: string;
};

export const OUTCOMES: readonly Outcome[] = [
  { key: "passed", label: "Passed", text: "text-success-foreground", fill: "bg-success", color: "var(--success)" },
  { key: "failed", label: "Failed", text: "text-danger-foreground", fill: "bg-danger", color: "var(--danger)" },
  {
    key: "absent",
    // "Absent" is the register's word for it; "did not come" is everybody else's.
    label: "Did not come",
    text: "text-warning-foreground",
    fill: "bg-warning",
    color: "var(--warning)",
  },
  {
    key: "pending",
    label: "Waiting for a result",
    text: "text-muted-foreground",
    fill: "bg-border",
    color: "var(--chart-axis)",
  },
] as const;

export const OUTCOME: Record<OutcomeKey, Outcome> = Object.fromEntries(
  OUTCOMES.map((o) => [o.key, o]),
) as Record<OutcomeKey, Outcome>;

/** The month's outcomes as chart data, with the empty ones dropped. */
export function outcomeSlices(tally: Pick<Tally, OutcomeKey>) {
  return OUTCOMES.map((o) => ({ name: o.label, value: tally[o.key] ?? 0, color: o.color })).filter(
    (slice) => slice.value > 0,
  );
}

/**
 * How a pass rate should FEEL, for the one figure a reader looks at first.
 *
 * Thresholds are deliberately blunt and deliberately not a grade: green from half the class
 * up, amber from a quarter, red below. They colour the number, never replace it, and no
 * decision is taken from them — see the pass-rate definition, which the school owns.
 */
export function rateTone(rate: number | null | undefined): "good" | "fair" | "poor" | "none" {
  if (rate == null) return "none";
  if (rate >= 50) return "good";
  if (rate >= 25) return "fair";
  return "poor";
}

export const RATE_TONE_TEXT: Record<ReturnType<typeof rateTone>, string> = {
  good: "text-success-foreground",
  fair: "text-warning-foreground",
  poor: "text-danger-foreground",
  none: "text-muted-foreground",
};

export const RATE_TONE_FILL: Record<ReturnType<typeof rateTone>, string> = {
  good: "bg-success",
  fair: "bg-warning",
  poor: "bg-danger",
  none: "bg-border",
};

/**
 * Why the denominator is bigger than the headcount, in one plain sentence — or nothing.
 *
 * The figure every rate is over counts a student once per exam they were due to sit, so a
 * student who sat two is in it twice. That used to be disclosed as "roster places", which
 * says nothing to anyone; when the two numbers agree there is nothing to explain at all.
 */
export function expectedNote(roster: number, students: number): string | null {
  if (!roster || !students || roster === students) return null;
  const extra = roster - students;
  if (extra <= 0) return null;
  return `${roster} and not ${students}, because ${extra} ${extra === 1 ? "student sat" : "students sat"} more than one exam this month.`;
}

/** "16 of 50" — the two counts behind a percentage, never the percentage on its own. */
export function ofTotal(numerator: number, denominator: number): string {
  return `${numerator} of ${denominator}`;
}

/** Everyone who did not pass, however they failed to. */
export function notPassed(tally: Pick<GroupTally, "failed" | "absent">): number {
  return (tally.failed ?? 0) + (tally.absent ?? 0);
}
