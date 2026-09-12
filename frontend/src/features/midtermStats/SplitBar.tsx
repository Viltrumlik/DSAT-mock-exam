"use client";

import { cn } from "@/lib/cn";
import { OUTCOMES, type OutcomeKey } from "./outcome";
import type { Tally } from "./types";

/**
 * One row's month as a proportional bar: passed | failed | did not come | waiting.
 *
 * Deliberately NOT a pass-rate bar. A bar whose width is the percentage printed next to it
 * restates a number the reader has already read, which is exactly the kind of decoration
 * this school has rejected before. This one answers what the percentage cannot: of the
 * people who did not pass, how many sat the exam and failed it and how many never turned
 * up — two different problems with two different remedies, and the same percentage.
 *
 * Rendered as a `<span>` list with a text alternative, so a screen reader gets the counts
 * rather than "image".
 */
export function SplitBar({
  tally,
  className,
  height = "h-2",
}: {
  tally: Pick<Tally, OutcomeKey | "roster">;
  className?: string;
  height?: string;
}) {
  const total = tally.roster ?? 0;
  const parts = OUTCOMES.map((o) => ({ ...o, count: tally[o.key] ?? 0 })).filter((p) => p.count > 0);

  if (!total || parts.length === 0) {
    return (
      <span
        className={cn("block w-full rounded-full bg-surface-2", height, className)}
        title="Nobody was due to sit an exam here this month."
      />
    );
  }

  return (
    <span
      className={cn("flex w-full overflow-hidden rounded-full bg-surface-2", height, className)}
      role="img"
      aria-label={parts.map((p) => `${p.label}: ${p.count} of ${total}`).join(", ")}
    >
      {parts.map((p) => (
        <span
          key={p.key}
          className={p.fill}
          style={{ width: `${(p.count / total) * 100}%` }}
          title={`${p.label}: ${p.count} of ${total}`}
        />
      ))}
    </span>
  );
}

/** What the colours mean. Shown once per screen, never once per bar. */
export function SplitLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {OUTCOMES.map((o) => (
        <li key={o.key} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className={cn("h-2.5 w-2.5 rounded-full", o.fill)} aria-hidden />
          {o.label}
        </li>
      ))}
    </ul>
  );
}
