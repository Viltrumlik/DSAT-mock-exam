"use client";

import type { ReactNode } from "react";

import { reasonOf } from "./format";
import { useCountUp } from "./motion";
import type { SmsMessage, SmsStatus } from "./smsApi";

/**
 * The SMS panel's look (plan 2026-11-01-sms-v2, Task 7). One colour per state everywhere — green
 * delivered, amber not delivered, red refused or failed, grey on its way — and one per operator,
 * the same in every chart and list, so a glance at Uzmobile's colour finds Uzmobile.
 */

export type Tone = "delivered" | "undelivered" | "rejected" | "pending";

export function toneOf(status: SmsStatus | string): Tone {
  if (status === "DELIVERED") return "delivered";
  if (status === "UNDELIVERED") return "undelivered";
  if (status === "REJECTED" || status === "FAILED") return "rejected";
  return "pending";
}

const TONE_CLASS: Record<Tone, string> = {
  delivered: "bg-success-soft text-success",
  undelivered: "bg-warning-soft text-warning",
  rejected: "bg-danger-soft text-danger",
  pending: "bg-surface-2 text-muted-foreground",
};

/** The fill each state wears in a chart. */
export const TONE_COLOR: Record<Tone, string> = {
  delivered: "var(--success)",
  undelivered: "var(--warning)",
  rejected: "var(--danger)",
  pending: "var(--text-secondary)",
};

/** Each operator's colour, fixed (the chart ramp, so it follows the light and dark themes). */
export const OPERATOR_COLOR: Record<string, string> = {
  Beeline: "var(--chart-4)",
  Ucell: "var(--chart-6)",
  Uzmobile: "var(--chart-1)",
  Mobiuz: "var(--chart-5)",
  Perfectum: "var(--chart-2)",
  Humans: "var(--chart-3)",
  Other: "var(--text-secondary)",
};

export function operatorColor(operator: string): string {
  return OPERATOR_COLOR[operator] ?? OPERATOR_COLOR.Other;
}

type PillMessage = Pick<SmsMessage, "status" | "eskiz_status" | "error" | "attempts" | "checked_at">;

/** Where an SMS stands, in words, in its state's colour. */
export function StatusPill({ message }: { message: PillMessage }) {
  const tone = toneOf(message.status);
  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium ${TONE_CLASS[tone]}`}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {reasonOf(message)}
    </span>
  );
}

export function OperatorDot({ operator }: { operator: string }) {
  return (
    <span
      role="img"
      aria-label={operator}
      title={operator}
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ background: operatorColor(operator) }}
    />
  );
}

/** A dot that breathes while something is going out now. */
export function LiveDot({ label = "Sending now" }: { label?: string }) {
  return (
    <span role="img" aria-label={label} title={label} className="relative inline-flex size-2">
      <span className="sms-pulse absolute inset-0 rounded-full bg-[var(--sms-accent)]" />
      <span className="relative inline-block size-2 rounded-full bg-[var(--sms-accent)]" />
    </span>
  );
}

const TILE_TONE: Record<"default" | "good" | "warn" | "bad", string> = {
  default: "text-foreground",
  good: "text-success",
  warn: "text-warning",
  bad: "text-danger",
};

/** One figure the overview leads with; it counts up to its value. */
export function StatTile({
  label,
  value,
  format = (n) => String(n),
  hint,
  tone = "default",
}: {
  label: string;
  value: number | null;
  format?: (n: number) => string;
  hint?: ReactNode;
  tone?: keyof typeof TILE_TONE;
}) {
  const shown = useCountUp(value ?? 0);
  return (
    <div className="border border-border bg-card px-4 py-3">
      <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-[21px] font-semibold leading-tight tabular-nums sm:text-[26px] ${TILE_TONE[tone]}`}>
        {value === null ? "—" : format(shown)}
      </div>
      {hint ? <div className="mt-0.5 text-[12px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
