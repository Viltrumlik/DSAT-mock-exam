"use client";

import type { Campaign } from "./smsApi";

const SIZE = 52;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * What a campaign's ring counts: delivered of everything that went out or was tried. Until it
 * finishes the result holds only the live delivered/undelivered counts, so those count as well.
 * Null before anything has gone out.
 */
export function ringOf(c: Pick<Campaign, "status" | "result">): { delivered: number; total: number } | null {
  if (c.status === "SCHEDULED" || c.status === "CANCELLED") return null;
  const r = c.result ?? {};
  const delivered = r.delivered ?? 0;
  const tried = (r.sent ?? 0) + (r.failed ?? 0) + (r.rejected ?? 0) + (r.uncertain ?? 0);
  const total = Math.max(tried, delivered + (r.undelivered ?? 0));
  return total > 0 ? { delivered, total } : null;
}

/** Delivered of total, drawn and written: the figure is its only label. */
export function DeliveryRing({ delivered, total }: { delivered: number; total: number }) {
  const share = total > 0 ? Math.min(1, delivered / total) : 0;
  return (
    <svg role="img" aria-label={`${delivered} of ${total} delivered`} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="block">
      <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-border" />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${share * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        className="stroke-success"
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={delivered >= 100 || total >= 100 ? 9.5 : 11} className="fill-foreground font-semibold tabular-nums">
        {delivered}/{total}
      </text>
    </svg>
  );
}
