"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { addDaysIso, formatDay } from "../ui/DateField";
import { attendanceFinding, niceMax, runwayFinding, scoreFinding, type Mark, type WeekdayRow } from "./findings";

/**
 * Data graphics (design handoff v0.3, DataDisplay · Chart and Graphics · 2): only where the shape is the
 * answer. Every one has a one-line insight under it, a "Table" view with the exact values (for screen
 * readers too), and a link to the filtered list. Colours: brand blue, critical red only for failures, the
 * blue score bands for scores (never red for a low score). No pies, gauges or bars that repeat a number.
 */
export type ChartTable = { head: string[]; rows: ReactNode[][] };

export function ChartFrame({
  title,
  sub,
  insight,
  note,
  table,
  link,
  action,
  className,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** The one line: what the shape says. */
  insight?: ReactNode;
  note?: ReactNode;
  table: ChartTable;
  link?: { href: string; label: string };
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className={cn("flex min-w-0 flex-col gap-3", className)}>
      <figcaption className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold text-ms-fg">{title}</span>
          {sub ? <span className="text-[13px] text-ms-fg-3">{sub}</span> : null}
        </span>
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => setAsTable((t) => !t)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-ms-fg-2 hover:bg-ms-surface-2 focus-visible:outline-2 focus-visible:outline-ms-ring"
        >
          <Icon name={asTable ? "sigma" : "columns"} size="sm" />
          {asTable ? "Chart" : "Table"}
        </button>
      </figcaption>
      {asTable ? (
        <div className="animate-ms-fade-in max-h-72 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-[13.5px]">
            <thead>
              <tr>
                {table.head.map((h, i) => (
                  <th key={i} scope="col" className={cn("sticky top-0 h-9 border-b border-ms-border bg-ms-card px-2 font-medium text-ms-fg-3", i === 0 ? "text-left" : "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={cn("h-9 border-b border-ms-line px-2 tabular-nums", j === 0 ? "text-left text-ms-fg" : "text-right text-ms-fg-2")}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="animate-ms-fade-in min-w-0">{children}</div>
      )}
      {insight || note || link || action ? (
        <div className="flex flex-col gap-1">
          {insight ? <p className="text-[14px] font-semibold text-ms-fg">{insight}</p> : null}
          {note ? <p className="text-[13.5px] text-ms-fg-2">{note}</p> : null}
          {link || action ? (
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {action}
              {link ? (
                <Link href={link.href} className="inline-flex items-center gap-1 text-[14px] font-semibold text-ms-primary-text hover:underline">
                  {link.label}
                  <Icon name="right" size="sm" />
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </figure>
  );
}

// ─── Attendance pattern ──────────────────────────────────────────────────────

const MARK: Record<Mark, { glyph: string; word: string; cls: string }> = {
  present: { glyph: "✓", word: "Present", cls: "bg-ms-positive-soft text-ms-positive-fg" },
  late: { glyph: "L", word: "Late", cls: "bg-ms-attention-soft text-ms-attention-fg" },
  absent: { glyph: "✕", word: "Absent", cls: "bg-ms-critical-soft text-ms-critical-fg" },
  excused: { glyph: "–", word: "Excused", cls: "bg-ms-neutral-soft text-ms-neutral-fg" },
  coming: { glyph: "·", word: "Coming", cls: "bg-ms-surface text-ms-fg-3" },
  none: { glyph: "", word: "Not marked", cls: "bg-ms-surface-2 text-ms-fg-3" },
};

/** Weeks × weekdays: the weekday a learner keeps missing shows as a row of crosses. */
export function AttendancePattern({ title, sub, weeks, rows, link }: { title: ReactNode; sub?: ReactNode; weeks: string[]; rows: WeekdayRow[]; link?: { href: string; label: string } }) {
  const f = attendanceFinding(rows);
  const labelAt = new Set([0, Math.floor((weeks.length - 1) / 2), weeks.length - 1]);
  return (
    <ChartFrame
      title={title}
      sub={sub}
      insight={f.line}
      note={f.note}
      link={link}
      table={{ head: ["Week", ...rows.map((r) => r.day)], rows: weeks.map((w, i) => [w, ...rows.map((r) => MARK[r.marks[i] ?? "coming"].word)]) }}
    >
      <div className="overflow-x-auto">
        <div className="inline-grid gap-1" style={{ gridTemplateColumns: `2.5rem repeat(${weeks.length}, 1.75rem)` }}>
          <span />
          {weeks.map((w, i) => (
            <span key={w + i} className="h-5 whitespace-nowrap text-[11.5px] leading-5 text-ms-fg-3">{labelAt.has(i) ? w : ""}</span>
          ))}
          {rows.map((r) => (
            <div key={r.day} className="contents">
              <span className="text-[13px] font-medium leading-7 text-ms-fg-2">{r.day}</span>
              {weeks.map((w, i) => {
                const m = MARK[r.marks[i] ?? "coming"];
                return (
                  <span key={w + i} title={`${r.day}, ${w}: ${m.word}`} className={cn("grid size-7 place-items-center rounded-[7px] text-[13px] font-semibold", m.cls)}>
                    {m.glyph}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-ms-fg-3">
        {(Object.keys(MARK) as Mark[]).filter((k) => k !== "none" || rows.some((r) => r.marks.includes("none"))).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cn("grid size-4 place-items-center rounded-[4px] text-[10px] font-semibold", MARK[k].cls)}>{MARK[k].glyph}</span>
            {MARK[k].word}
          </span>
        ))}
      </div>
    </ChartFrame>
  );
}

// ─── Mock scores towards a target ────────────────────────────────────────────

/** Mock totals over the blue score bands with the target line: is the score climbing towards it? */
export function ScoreTrend({
  title,
  sub,
  points,
  target,
  min = 800,
  max = 1600,
  link,
}: {
  title: ReactNode;
  sub?: ReactNode;
  points: { label: string; total: number }[];
  target: number | null;
  min?: number;
  max?: number;
  link?: { href: string; label: string };
}) {
  const W = 560;
  const L = 44;
  const R = 544;
  const y = (s: number) => 10 + ((max - Math.min(max, Math.max(min, s))) * 190) / (max - min);
  const x = (i: number) => L + ((i + 0.5) * (R - L)) / Math.max(1, points.length);
  const bands = [
    { lo: 1400, hi: max, cls: "fill-ms-band4-bg", op: 0.14 },
    { lo: 1200, hi: 1400, cls: "fill-ms-band3-bg", op: 0.14 },
    { lo: 1000, hi: 1200, cls: "fill-ms-band2-bg", op: 0.4 },
    { lo: min, hi: 1000, cls: "fill-ms-band1-bg", op: 0.6 },
  ];
  const ticks = [1400, 1200, 1000, 800].filter((t) => t >= min && t <= max);
  const last = points[points.length - 1];
  return (
    <ChartFrame
      title={title}
      sub={sub}
      insight={scoreFinding(points.map((p) => p.total), target)}
      link={link}
      table={{ head: ["Mock", "Total"], rows: points.map((p) => [p.label, p.total]) }}
    >
      <svg viewBox={`0 0 ${W} 230`} role="img" aria-label={`${points.length} mock totals${target ? `, target ${target}` : ""}`} className="h-auto w-full font-ms-sans">
        {bands.map((b) => (
          <rect key={b.lo} x={L} y={y(b.hi)} width={R - L} height={y(b.lo) - y(b.hi)} className={b.cls} opacity={b.op} />
        ))}
        {ticks.map((t) => (
          <text key={t} x={36} y={y(t) + 4} textAnchor="end" className="fill-ms-fg-3 text-[12px] tabular-nums">
            {t}
          </text>
        ))}
        {target ? (
          <>
            <path d={`M${L} ${y(target)}H${R}`} className="stroke-ms-primary" strokeWidth={1.5} strokeDasharray="6 5" />
            <text x={R - 4} y={y(target) - 6} textAnchor="end" className="fill-ms-primary-text text-[12px] font-semibold">
              Target {target}
            </text>
          </>
        ) : null}
        {points.length > 1 ? (
          <polyline
            points={points.map((p, i) => `${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ")}
            className="animate-ms-wipe-in fill-none stroke-ms-primary"
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.total)} r={5} className="fill-ms-card stroke-ms-primary" strokeWidth={2.5}>
            <title>{`${p.label}: ${p.total}`}</title>
          </circle>
        ))}
        {last ? (
          <text x={x(points.length - 1)} y={y(last.total) - 12} textAnchor="middle" className="fill-ms-fg text-[13px] font-bold tabular-nums">
            {last.total}
          </text>
        ) : null}
        {points.map((p, i) => (
          <text key={`l${i}`} x={x(i)} y={222} textAnchor="middle" className="fill-ms-fg-3 text-[12px]">
            {p.label}
          </text>
        ))}
      </svg>
    </ChartFrame>
  );
}

// ─── A balance and when it runs out ──────────────────────────────────────────

/**
 * The balance (solid, as far as it is known) and its forecast to zero at the recent spend (dashed). With no
 * history (top-ups unknown) only the forecast is drawn — nothing is invented.
 */
export function BalanceRunway({
  balance,
  perDay,
  today,
  past = [],
  horizon = 30,
  format = (n: number) => String(Math.round(n)),
  framed = true,
  title = "Balance",
  sub,
  action,
  link,
}: {
  balance: number;
  perDay: number;
  /** Today in Tashkent, "2026-11-11". */
  today: string;
  /** Known balances, oldest first, ending today (optional). */
  past?: number[];
  horizon?: number;
  format?: (n: number) => string;
  /** Without the frame (a card that already has its own title and line). */
  framed?: boolean;
  title?: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  link?: { href: string; label: string };
}) {
  const days = perDay > 0 ? Math.floor(balance / perDay) : Infinity;
  const ahead = Math.min(horizon, Number.isFinite(days) ? Math.max(days, 0) : horizon);
  const known = past.length >= 2 ? past : [balance];
  const span = known.length - 1 + Math.max(ahead, 1);
  const top = Math.max(balance, ...known, 1);
  const X0 = 8;
  const X1 = 352;
  const x = (d: number) => X0 + ((X1 - X0) * d) / span;
  const y = (v: number) => 92 - (78 * Math.max(0, v)) / top;
  const tx = x(known.length - 1);
  const endBalance = Math.max(0, balance - perDay * ahead);
  const ex = x(known.length - 1 + Math.max(ahead, 1));
  const runsOutIn = Number.isFinite(days) && days <= horizon;
  const endLabel = !Number.isFinite(days) ? "no spend" : runsOutIn ? (days <= 0 ? "today" : `≈ ${formatDay(addDaysIso(today, days)).replace(/ \d{4}$/, "")}`) : `${horizon}+ days`;
  const svg = (
    <svg viewBox="0 0 360 110" role="img" aria-label={`Balance ${format(balance)}, ${runwayFinding(balance, perDay, horizon).toLowerCase()}`} className="h-[110px] w-full font-ms-sans">
      <path d="M8 92H352" className="stroke-ms-border-strong" strokeWidth={1} />
      {known.length >= 2 ? (
        <polyline points={known.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} className="fill-none stroke-ms-primary" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      ) : null}
      {Number.isFinite(days) ? (
        <path className="animate-ms-wipe-in stroke-ms-attention" d={`M${tx.toFixed(1)} ${y(balance).toFixed(1)} L${ex.toFixed(1)} ${y(endBalance).toFixed(1)}`} strokeWidth={2.5} strokeDasharray="5 5" strokeLinecap="round" fill="none" />
      ) : null}
      <circle cx={tx} cy={y(balance)} r={4.5} className="fill-ms-primary" />
      {Number.isFinite(days) ? <circle cx={ex} cy={y(endBalance)} r={4.5} className="fill-ms-card stroke-ms-attention" strokeWidth={2.5} /> : null}
      <text x={Math.max(tx, 24)} y={y(balance) - 10} textAnchor={tx < 40 ? "start" : "middle"} className="fill-ms-fg-3 text-[12px]">
        today
      </text>
      <text x={Math.min(Math.max(ex, 90), 352)} y={Math.min(y(endBalance), 92) - 18} textAnchor="end" className="fill-ms-attention-fg text-[12px] font-semibold">
        {endLabel}
      </text>
    </svg>
  );
  if (!framed) return svg;
  const forecastRows: ReactNode[][] = [
    ...known.map((v, i) => [i === known.length - 1 ? "Today" : formatDay(addDaysIso(today, i - (known.length - 1))), format(v)]),
    ...(Number.isFinite(days) ? [[formatDay(addDaysIso(today, ahead)), format(endBalance)]] : []),
  ];
  return (
    <ChartFrame title={title} sub={sub} insight={runwayFinding(balance, perDay, horizon)} action={action} link={link} table={{ head: ["Day", "Balance"], rows: forecastRows }}>
      {svg}
    </ChartFrame>
  );
}

// ─── Shares: where something sits ───────────────────────────────────────────

/** Where a total sits, largest first: the top rows as bars, the rest as one quiet bar; each row may link. */
export function ShareBars({
  rows,
  top = 4,
  format = (n: number) => String(n),
  restNoun = ["group", "groups"],
  tone = "critical",
  delay = 0,
}: {
  rows: { label: string; value: number; href?: string }[];
  top?: number;
  format?: (n: number) => string;
  restNoun?: [string, string];
  tone?: "critical" | "primary";
  delay?: number;
}) {
  const sorted = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, top);
  const rest = sorted.slice(top);
  const restSum = rest.reduce((s, r) => s + r.value, 0);
  const max = head[0]?.value || 1;
  const bar = tone === "critical" ? "bg-ms-critical" : "bg-ms-primary";
  const num = tone === "critical" ? "text-ms-critical-fg" : "text-ms-fg";
  return (
    <div className="flex flex-col gap-2.5">
      {head.map((r, i) => {
        const body = (
          <>
            <span className="truncate text-ms-fg" title={r.label}>{r.label}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-ms-surface-2">
              <span className={cn("animate-ms-wipe-in block h-full rounded-full", bar)} style={{ width: `${(r.value / max) * 100}%`, animationDelay: `${delay + 120 + i * 60}ms` }} />
            </span>
            <span className={cn("text-right font-semibold tabular-nums", num)}>{format(r.value)}</span>
          </>
        );
        const cls = "grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_auto] items-center gap-2.5 text-[13.5px]";
        return r.href ? (
          <Link key={r.label} href={r.href} className={cn(cls, "-mx-1.5 rounded-[8px] px-1.5 py-0.5 hover:bg-ms-surface")}>
            {body}
          </Link>
        ) : (
          <div key={r.label} className={cls}>
            {body}
          </div>
        );
      })}
      {rest.length ? (
        <div className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_auto] items-center gap-2.5 text-[13.5px] text-ms-fg-2">
          <span>
            {rest.length} more {rest.length === 1 ? restNoun[0] : restNoun[1]}
          </span>
          <span className="h-2.5 overflow-hidden rounded-full bg-ms-surface-2">
            <span className="block h-full rounded-full bg-ms-surface-3" style={{ width: `${Math.min(100, (restSum / max) * 100)}%` }} />
          </span>
          <span className="text-right tabular-nums">{format(restSum)}</span>
        </div>
      ) : null}
    </div>
  );
}

// ─── Bars by day ─────────────────────────────────────────────────────────────

export type BarSeries = { label: string; tone: "primary" | "critical" | "positive" | "attention" | "neutral" };
const SERIES_FILL: Record<BarSeries["tone"], string> = {
  primary: "fill-ms-primary",
  critical: "fill-ms-critical",
  positive: "fill-ms-positive",
  attention: "fill-ms-attention",
  neutral: "fill-ms-surface-3",
};
const SERIES_BG: Record<BarSeries["tone"], string> = {
  primary: "bg-ms-primary",
  critical: "bg-ms-critical",
  positive: "bg-ms-positive",
  attention: "bg-ms-attention",
  neutral: "bg-ms-surface-3",
};

/** Stacked bars, one per day; each bar opens that day's list, its values in the tooltip and the table. */
export function BarChart({
  title,
  sub,
  series,
  bars,
  insight,
  note,
  link,
}: {
  title: ReactNode;
  sub?: ReactNode;
  series: BarSeries[];
  /** Oldest first: a label under the bar, its values in series order (bottom up). */
  bars: { label: string; full?: string; href?: string; values: number[] }[];
  insight?: ReactNode;
  note?: ReactNode;
  link?: { href: string; label: string };
}) {
  const top = niceMax(Math.max(0, ...bars.map((b) => b.values.reduce((s, v) => s + v, 0))));
  const H = 150;
  const B = 130; // the baseline
  const slot = 28;
  const W = 36 + bars.length * slot + 4;
  const y = (v: number) => B - (v / top) * (B - 12);
  const every = bars.length > 20 ? 3 : bars.length > 10 ? 2 : 1;
  return (
    <ChartFrame
      title={title}
      sub={sub}
      insight={insight}
      note={note}
      link={link}
      table={{ head: ["Day", ...series.map((s) => s.label)], rows: bars.map((b) => [b.full ?? b.label, ...series.map((_, i) => b.values[i] ?? 0)]) }}
    >
      <div className="mb-2 flex flex-wrap gap-3 text-[12.5px] text-ms-fg-2">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-[3px]", SERIES_BG[s.tone])} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={typeof title === "string" ? title : "Bar chart"} className="h-auto w-full font-ms-sans" style={{ minWidth: Math.min(W, 520) }}>
          {[0, top / 2, top].map((t) => (
            <g key={t}>
              <path d={`M32 ${y(t)}H${W - 2}`} className={t === 0 ? "stroke-ms-border-strong" : "stroke-ms-line"} strokeWidth={1} />
              <text x={26} y={y(t) + 4} textAnchor="end" className="fill-ms-fg-3 text-[12px] tabular-nums">
                {Math.round(t)}
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const x0 = 36 + i * slot + 5;
            let acc = 0;
            const tip = `${b.full ?? b.label}: ${series.map((s, k) => `${b.values[k] ?? 0} ${s.label.toLowerCase()}`).join(", ")}`;
            const rects = series.map((s, k) => {
              const v = b.values[k] ?? 0;
              const yTop = y(acc + v);
              const h = y(acc) - yTop;
              acc += v;
              return v > 0 ? <rect key={k} x={x0} y={yTop} width={slot - 10} height={Math.max(h, 1)} rx={3} className={SERIES_FILL[s.tone]} /> : null;
            });
            const body = (
              <g className="animate-ms-fade-in" style={{ animationDelay: `${i * 25}ms` }}>
                <title>{tip}</title>
                <rect x={x0 - 4} y={8} width={slot - 2} height={B - 8} className="fill-transparent" />
                {rects}
              </g>
            );
            return (
              <g key={i}>
                {b.href ? (
                  <a href={b.href} aria-label={tip}>
                    {body}
                  </a>
                ) : (
                  body
                )}
                {i % every === 0 ? (
                  <text x={x0 + (slot - 10) / 2} y={B + 16} textAnchor="middle" className="fill-ms-fg-3 text-[12px] tabular-nums">
                    {b.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </ChartFrame>
  );
}
