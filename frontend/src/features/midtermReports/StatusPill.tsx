"use client";

import type { IconName } from "@/components/ui/Icon";
import { Badge, type BadgeTone } from "@/features/console/ui";
import type { Outcome, OutcomeTone } from "./status";

/**
 * Colour AND shape per tone, and the label is always spelled out — the things an admin
 * scanning this table has to tell apart (passed / failed / nobody sat it) must survive a
 * monochrome print-out and colour-blind eyes alike.
 *
 * Drawn as the console's verdict pill (design handoff v0.3): the console's own tokens, so dark
 * mode keeps its contrast, and a distinct icon per tone.
 */
const TONES: Record<OutcomeTone, { badge: BadgeTone; icon: IconName }> = {
  pass: { badge: "positive", icon: "ok" },
  fail: { badge: "critical", icon: "x" },
  absent: { badge: "neutral", icon: "minus" },
  waiting: { badge: "neutral", icon: "clock" },
  ungraded: { badge: "neutral", icon: "circle" },
};

export function StatusPill({ outcome, className }: { outcome: Outcome; className?: string }) {
  const { badge, icon } = TONES[outcome.tone];
  return (
    <span title={outcome.meaning} className="inline-flex">
      <Badge tone={badge} icon={icon} className={className}>
        {outcome.label}
      </Badge>
    </span>
  );
}

/**
 * The legend under a results table.
 *
 * Not decoration. Twelve labels in five tones with nothing anywhere explaining any of them is
 * the specific reason this page was called unreadable; a label a reader cannot define is
 * worse than no label.
 */
export function OutcomeLegend({ outcomes }: { outcomes: Outcome[] }) {
  if (outcomes.length === 0) return null;
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-2 rounded-ms-ctl bg-ms-surface px-3.5 py-3">
      {outcomes.map((o) => (
        <div key={o.label} className="flex min-w-0 items-start gap-2">
          <dt className="shrink-0">
            <StatusPill outcome={o} />
          </dt>
          <dd className="min-w-0 max-w-[38ch] text-[13px] leading-[18px] text-ms-fg-2">{o.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The compact "12 passed · 3 failed" tally shown on a collapsed midterm row. */
export function CountChip({
  tone,
  count,
  label,
  title,
}: {
  tone: OutcomeTone;
  count: number;
  label: string;
  title?: string;
}) {
  const { badge, icon } = TONES[tone];
  // A zero is drawn as an outline: present, so the row keeps its shape, but quiet.
  const muted = count === 0;
  return (
    <span title={title} className="inline-flex">
      <Badge tone={muted ? "line" : badge} icon={icon}>
        <span className="tabular-nums">{count}</span>
        {label}
      </Badge>
    </span>
  );
}
