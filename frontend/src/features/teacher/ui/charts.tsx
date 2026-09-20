"use client";

/**
 * The kit's charts, drawn as plain SVG.
 *
 * The product already has a chart abstraction over recharts, and it costs a ~356KB async
 * chunk the first time a page draws anything. This screen is the one a teacher opens every
 * day, a fifth of the time on a phone, and what it needs are three shapes with at most a
 * dozen values each. So they are drawn here: same `--dz-*` tokens, no dependency, no chunk.
 *
 * Every chart states its numbers in text as well as in colour — a bar whose value is only
 * legible as a length is a picture, not a figure.
 */

import type { ReactNode } from "react";
import { TONE_INK, TONE_WASH, type Tone } from "./tones";
import { EmptyState } from "./states";

export type Slice = { label: string; value: number; tone: Tone };

/** A donut: shares of one total. Slices under 1% are still drawn, never dropped silently. */
export function Donut({ slices, centerValue, centerLabel, empty }: {
  slices: Slice[];
  centerValue: ReactNode;
  centerLabel: string;
  empty?: ReactNode;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return <>{empty ?? <EmptyState title="Nothing to show yet" />}</>;

  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
      <svg viewBox="0 0 140 140" style={{ width: 140, height: 140, flexShrink: 0 }} role="img" aria-label={centerLabel}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--dz-neutral-soft)" strokeWidth="18" />
        {slices.map((s) => {
          const length = (s.value / total) * C;
          const dash = <circle
            key={s.label}
            cx="70" cy="70" r={R} fill="none"
            stroke={TONE_INK[s.tone]} strokeWidth="18"
            strokeDasharray={`${length} ${C - length}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 70 70)"
          />;
          offset += length;
          return dash;
        })}
        <text x="70" y="66" textAnchor="middle" style={{ fontSize: 22, fontWeight: 800, fill: "var(--dz-ink)" }}>
          {centerValue}
        </text>
        <text x="70" y="84" textAnchor="middle" style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", fill: "var(--dz-faint)" }}>
          {centerLabel.toUpperCase()}
        </text>
      </svg>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8, minWidth: 160, flex: 1 }}>
        {slices.map((s) => (
          <li key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: TONE_INK[s.tone], flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, color: "var(--dz-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.label}
            </span>
            <span style={{ fontWeight: 800, color: "var(--dz-ink)" }}>{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type BarRow = { label: string; segments: { value: number; tone: Tone }[]; note?: string };

/**
 * Horizontal stacked bars, one per row. Horizontal because the labels are class names and
 * this has to survive a 375px screen, where vertical bars turn their labels sideways.
 */
export function BarRows({ rows, max: fixedMax, empty }: { rows: BarRow[]; max?: number; empty?: ReactNode }) {
  // Without `max` the longest row fills the width and the others read against it, which is
  // what you want for counts. Pass `max` (100, typically) when the values are already shares
  // and each bar has to be read against the whole rather than against its neighbour.
  const max = fixedMax ?? Math.max(1, ...rows.map((r) => r.segments.reduce((s, x) => s + x.value, 0)));
  if (rows.length === 0) return <>{empty ?? <EmptyState title="Nothing to show yet" />}</>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
      {rows.map((row) => {
        const total = row.segments.reduce((s, x) => s + x.value, 0);
        return (
          <li key={row.label}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--dz-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.label}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--dz-mute)", whiteSpace: "nowrap" }}>
                {row.note ?? total}
              </span>
            </div>
            <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "var(--dz-neutral-soft)" }}>
              {row.segments.map((seg, i) =>
                seg.value > 0 ? (
                  <span key={i} style={{ width: `${(seg.value / max) * 100}%`, background: TONE_INK[seg.tone] }} />
                ) : null,
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A small line over time. Reads as a shape; the last value is also printed. */
export function TrendLine({ points, suffix = "", empty }: {
  points: { label: string; value: number }[];
  suffix?: string;
  empty?: ReactNode;
}) {
  if (points.length < 2) return <>{empty ?? <EmptyState title="Not enough days yet" hint="A line needs at least two days of marks." />}</>;

  const W = 320, H = 96, PAD = 6;
  const values = points.map((p) => p.value);
  const top = Math.max(100, ...values);
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (points.length - 1);
  const y = (v: number) => H - PAD - (v / top) * (H - PAD * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
  const last = points[points.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 96 }} role="img" aria-label="Trend over time" preserveAspectRatio="none">
        <path d={area} fill={TONE_WASH.info} />
        <path d={line} fill="none" stroke={TONE_INK.info} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r="3.5" fill={TONE_INK.info} />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--dz-mute)", marginTop: 4 }}>
        <span>{points[0].label}</span>
        <span style={{ fontWeight: 800, color: "var(--dz-ink)" }}>{last.value}{suffix} on {last.label}</span>
      </div>
    </div>
  );
}
