"use client";

import { Icon } from "@/components/ui/Icon";
import { useChanged } from "@/features/console/useChanged";
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
  delivered: "bg-ms-positive-soft text-ms-positive-fg",
  undelivered: "bg-ms-attention-soft text-ms-attention-fg",
  rejected: "bg-ms-critical-soft text-ms-critical-fg",
  pending: "bg-ms-neutral-soft text-ms-neutral-fg",
};

/** The fill each state wears in a chart. */
export const TONE_COLOR: Record<Tone, string> = {
  delivered: "var(--ms-positive)",
  undelivered: "var(--ms-attention)",
  rejected: "var(--ms-critical)",
  pending: "var(--ms-fg-3)",
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

/**
 * Delivery ticks (design handoff v0.3, Motion board): sent = one tick, delivered = two — the second
 * slides in when a delivery lands while you watch; a failure turns them into "!".
 */
function Ticks({ tone, fresh }: { tone: Tone; fresh: boolean }) {
  if (tone === "undelivered" || tone === "rejected") return <Icon name="alert" size="sm" className="size-3.5 shrink-0" />;
  return (
    <span aria-hidden="true" data-ticks={tone === "delivered" ? 2 : 1} className="relative inline-flex h-3.5 w-[19px] shrink-0">
      <Icon name="check" size="sm" className="absolute left-0 top-0 size-3.5" />
      {tone === "delivered" ? (
        <Icon name="check" size="sm" className={`absolute left-[5px] top-0 size-3.5 ${fresh ? "animate-ms-tick-in" : ""}`} />
      ) : null}
    </span>
  );
}

/** Where an SMS stands, in words, in its state's colour. */
export function StatusPill({ message }: { message: PillMessage }) {
  const tone = toneOf(message.status);
  const fresh = useChanged(tone);
  return (
    <span
      data-tone={tone}
      className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[12px] font-semibold ${TONE_CLASS[tone]}`}
    >
      <Ticks tone={tone} fresh={fresh} />
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
  default: "text-ms-fg",
  good: "text-ms-positive-fg",
  warn: "text-ms-attention-fg",
  bad: "text-ms-critical-fg",
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
    <div className="animate-ms-card-in flex min-w-0 flex-col gap-1.5 rounded-[16px] bg-ms-surface p-4">
      <div className="text-[13px] font-medium text-ms-fg-2">{label}</div>
      <div className={`text-[24px] font-bold leading-7 tabular-nums sm:text-[28px] sm:leading-8 ${TILE_TONE[tone]}`}>
        {value === null ? "—" : format(shown)}
      </div>
      {hint ? <div className="text-[13px] text-ms-fg-3">{hint}</div> : null}
    </div>
  );
}
