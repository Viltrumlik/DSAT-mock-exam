/**
 * The one line under each data graphic (design handoff v0.3, Graphics board · 2): what the shape says that
 * the numbers alone do not. Pure functions, so every sentence is tested.
 */
/** "none": a lesson day that passed with no mark (not held, or not marked) — not counted either way. */
export type Mark = "present" | "late" | "absent" | "excused" | "coming" | "none";
export type WeekdayRow = { day: string; marks: Mark[] };

const PLURAL_DAY: Record<string, string> = {
  Mon: "Mondays",
  Tue: "Tuesdays",
  Wed: "Wednesdays",
  Thu: "Thursdays",
  Fri: "Fridays",
  Sat: "Saturdays",
  Sun: "Sundays",
};
const days = (d: string) => PLURAL_DAY[d] ?? `${d}s`;
const and = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * "5 of 8 Fridays missed." — the weekday a learner keeps missing, out of the lessons already held (coming
 * ones don't count; excused ones count as held, not missed). Only said when it stands out: two misses or more
 * and at least 40 % of that day's lessons. `note` names the days that are fine.
 */
export function attendanceFinding(rows: readonly WeekdayRow[]): { line: string; note?: string } {
  const stats = rows.map((r) => {
    const held = r.marks.filter((m) => m !== "coming" && m !== "none");
    const missed = held.filter((m) => m === "absent").length;
    return { day: r.day, held: held.length, missed, rate: held.length ? missed / held.length : 0 };
  });
  const worst = [...stats].filter((s) => s.missed >= 2 && s.rate >= 0.4).sort((a, b) => b.rate - a.rate || b.missed - a.missed)[0];
  if (!worst) {
    const missed = stats.reduce((n, s) => n + s.missed, 0);
    return { line: missed ? "No weekday stands out." : "No lesson missed." };
  }
  const fine = stats.filter((s) => s !== worst && s.held > 0 && s.rate < 0.2).map((s) => days(s.day));
  return {
    line: `${worst.missed} of ${worst.held} ${days(worst.day)} missed.`,
    note: fine.length ? `${and(fine)} ${fine.length === 1 ? "is" : "are"} fine — worth asking the parent about ${days(worst.day)}.` : undefined,
  };
}

/** "+240 in 6 mocks, 160 to go." · "+80 in 4 mocks — target reached." · "−30 in 3 mocks, 220 to go." */
export function scoreFinding(totals: readonly number[], target: number | null): string {
  if (!totals.length) return "No mock yet.";
  const first = totals[0];
  const last = totals[totals.length - 1];
  const delta = last - first;
  const change = totals.length === 1 ? "1 mock so far" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta)} in ${totals.length} mocks`;
  if (target === null) return `${change}.`;
  return last >= target ? `${change} — target reached.` : `${change}, ${target - last} to go.`;
}

/** "Runs out in about 8 days" · "Runs out today" · "Lasts more than 30 days" — at the spend given. */
export function runwayFinding(balance: number, perDay: number, horizon = 30): string {
  if (perDay <= 0) return "Nothing was spent lately.";
  const d = Math.floor(balance / perDay);
  if (d <= 0) return "Runs out today";
  if (d > horizon) return `Lasts more than ${horizon} days`;
  return d === 1 ? "Runs out in about 1 day" : `Runs out in about ${d} days`;
}

/** Round a chart's top up to a friendly number: 37 → 40, 412 → 500, 0 → 1. */
export function niceMax(n: number): number {
  if (n <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  const f = n / p;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 4 ? 4 : f <= 5 ? 5 : 10;
  return step * p;
}
