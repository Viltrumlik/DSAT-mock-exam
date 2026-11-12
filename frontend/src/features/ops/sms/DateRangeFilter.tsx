"use client";

import { todayInTashkent } from "./format";
import { rangeDates } from "./RangePicker";

/**
 * The journal's dates: from–to (inclusive Tashkent days) and three quick ranges. Both ends live in
 * the address as `from` / `to`, beside the journal's other filters.
 */
export function DateRangeFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string | null; to: string | null }) => void;
}) {
  const today = todayInTashkent();
  const quick = (preset: "7d" | "30d") => onChange(rangeDates(preset, today));
  const chip = "rounded-full border border-ms-border px-2 py-0.5 text-[12px] text-ms-fg-3 hover:text-ms-fg";
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <button type="button" className={chip} onClick={() => onChange({ from: today, to: today })}>
        Today
      </button>
      <button type="button" className={chip} onClick={() => quick("7d")}>
        7 days
      </button>
      <button type="button" className={chip} onClick={() => quick("30d")}>
        30 days
      </button>
      <input
        type="date"
        aria-label="From"
        value={from}
        max={to || undefined}
        onChange={(e) => onChange({ from: e.target.value || null, to: to || null })}
        className="ms-transition h-8 rounded-ms-ctl border border-ms-border-input bg-ms-card px-1.5 outline-none focus:border-ms-primary"
      />
      <span className="text-ms-fg-3">–</span>
      <input
        type="date"
        aria-label="To"
        value={to}
        min={from || undefined}
        onChange={(e) => onChange({ from: from || null, to: e.target.value || null })}
        className="ms-transition h-8 rounded-ms-ctl border border-ms-border-input bg-ms-card px-1.5 outline-none focus:border-ms-primary"
      />
    </div>
  );
}
