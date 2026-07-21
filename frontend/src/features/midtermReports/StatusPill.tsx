"use client";

import { CheckCircle2, CircleDashed, Clock, MinusCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Pill, PillTone } from "./status";

/**
 * Colour AND shape per tone, and the label is always spelled out — the three things an
 * admin scanning this table has to tell apart (passed / failed / nobody sat it) must survive
 * a monochrome print-out and colour-blind eyes alike.
 */
const TONES: Record<PillTone, { cls: string; icon: React.ElementType }> = {
  pass: { cls: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  fail: { cls: "border-red-200 bg-red-50 text-red-700", icon: XCircle },
  absent: { cls: "border-border bg-surface-2 text-muted-foreground", icon: MinusCircle },
  waiting: { cls: "border-border bg-surface-2 text-muted-foreground", icon: Clock },
  ungraded: { cls: "border-border bg-surface-2 text-muted-foreground", icon: CircleDashed },
};

export function StatusPill({ pill, className }: { pill: Pill; className?: string }) {
  const { cls, icon: Icon } = TONES[pill.tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-bold whitespace-nowrap",
        cls,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {pill.label}
    </span>
  );
}

/** The compact "12 passed · 3 failed" tally shown on a collapsed midterm row. */
export function CountChip({
  tone,
  count,
  label,
}: {
  tone: PillTone;
  count: number;
  label: string;
}) {
  const { cls, icon: Icon } = TONES[tone];
  const muted = count === 0;
  return (
    <span
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
