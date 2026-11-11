"use client";

import { useState } from "react";

import type { DebtEffectMonth } from "../smsApi";

/**
 * What the debt warning makes people do, per month: of the students it reached, how many had paid
 * by the end of day 1, 3 and 5 of their first warning — and how many had not by then (the freeze
 * takes them on day 6). Each bar is that share of the warned; the figures are counts. During the
 * warning days some still have time: they are shown apart, never as "did not pay".
 */

const STEPS: { key: "paid_1" | "paid_3" | "paid_5"; label: string }[] = [
  { key: "paid_1", label: "Paid in 1 day" },
  { key: "paid_3", label: "Paid in 3 days" },
  { key: "paid_5", label: "Paid in 5 days" },
];

const monthLabel = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};

function Step({ label, count, warned, color, strong }: { label: string; count: number; warned: number; color: string; strong?: string }) {
  return (
    <li className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2">
      <span className="text-ms-fg-3">{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-ms-surface-2">
        <span
          data-debt-bar
          className="block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500"
          style={{ width: warned ? `${(count / warned) * 100}%` : "0%", background: color }}
        />
      </span>
      <span className={`text-right font-semibold tabular-nums ${strong ?? ""}`}>{count}</span>
    </li>
  );
}

export function DebtEffect({ months }: { months: DebtEffectMonth[] }) {
  const [index, setIndex] = useState(months.length - 1);
  const month = months[Math.min(Math.max(index, 0), months.length - 1)];
  if (!month) return <p className="px-3 py-3 text-[13px] text-ms-fg-3">No debt warning in this range.</p>;

  return (
    <div className="space-y-3 px-3 py-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-ms-fg">{`${month.warned} warned`}</span>
        {months.length > 1 ? (
          <span className="inline-flex flex-wrap items-center gap-1" role="group" aria-label="Month">
            {months.map((m, i) => (
              <button
                key={m.month}
                type="button"
                aria-pressed={m.month === month.month}
                onClick={() => setIndex(i)}
                className={`rounded-full border px-2 py-0.5 text-[12px] ${m.month === month.month ? "border-[var(--sms-accent)] text-ms-fg" : "border-ms-border text-ms-fg-3"}`}
              >
                {monthLabel(m.month)}
              </button>
            ))}
          </span>
        ) : (
          <span className="text-ms-fg-3">{monthLabel(month.month)}</span>
        )}
      </div>
      <ul className="space-y-2">
        {STEPS.map((s) => (
          <Step key={s.key} label={s.label} count={month[s.key]} warned={month.warned} color="var(--ms-positive)" />
        ))}
        {month.open > 0 ? (
          <Step label="Still have time" count={month.open} warned={month.warned} color="var(--text-secondary)" />
        ) : null}
        <Step label="Did not pay" count={month.unpaid} warned={month.warned} color="var(--ms-critical)" strong="text-ms-critical-fg" />
      </ul>
      <p className="text-ms-fg-3">
        {month.open > 0
          ? `${month.open} still have time · ${month.unpaid} did not pay within their 5 days so far.`
          : `${month.unpaid} did not pay within 5 days of the first warning.`}
      </p>
    </div>
  );
}
