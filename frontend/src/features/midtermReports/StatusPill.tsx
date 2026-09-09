"use client";

import { CheckCircle2, CircleDashed, Clock, MinusCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Outcome, OutcomeTone } from "./status";

/**
 * Colour AND shape per tone, and the label is always spelled out — the things an admin
 * scanning this table has to tell apart (passed / failed / nobody sat it) must survive a
 * monochrome print-out and colour-blind eyes alike.
 *
 * The colours are the design system's semantic tokens, not raw palette classes: this console
 * is used in dark mode, and `bg-emerald-50` is the same near-white in both themes.
 */
const TONES: Record<OutcomeTone, { cls: string; icon: React.ElementType }> = {
  pass: {
    cls: "border-success/25 bg-success-soft text-success-foreground",
    icon: CheckCircle2,
  },
  fail: { cls: "border-danger/25 bg-danger-soft text-danger-foreground", icon: XCircle },
  absent: { cls: "border-border bg-surface-2 text-muted-foreground", icon: MinusCircle },
  waiting: { cls: "border-border bg-surface-2 text-muted-foreground", icon: Clock },
  ungraded: { cls: "border-border bg-surface-2 text-muted-foreground", icon: CircleDashed },
};

export function StatusPill({ outcome, className }: { outcome: Outcome; className?: string }) {
  const { cls, icon: Icon } = TONES[outcome.tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-bold whitespace-nowrap",
        cls,
        className,
      )}
      title={outcome.meaning}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {outcome.label}
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
    <dl className="flex flex-wrap gap-x-5 gap-y-1.5 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
      {outcomes.map((o) => (
        <div key={o.label} className="flex min-w-0 items-start gap-2">
          <dt className="shrink-0">
            <StatusPill outcome={o} />
          </dt>
          <dd className="min-w-0 max-w-[38ch] text-[12px] leading-snug text-muted-foreground">
            {o.meaning}
          </dd>
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
  const { cls, icon: Icon } = TONES[tone];
  const muted = count === 0;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold whitespace-nowrap",
        muted ? "border-border bg-card text-muted-foreground" : cls,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="tabular-nums">{count}</span>
      {label}
    </span>
  );
}
