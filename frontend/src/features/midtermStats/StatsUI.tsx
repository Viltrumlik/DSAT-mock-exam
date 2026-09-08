"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { NO_VALUE, formatRate } from "./format";

/**
 * The presentation atoms the statistics page is built from.
 *
 * They exist as one small vocabulary rather than as inline markup because the page's whole
 * problem was inconsistency: the same idea drawn five ways is what made the old midterms
 * page unreadable. A rate looks like a rate everywhere here, a missing number looks like a
 * missing number everywhere here, and neither is spelled out twice.
 */

/** The ops dialect's card. The ops shell already supplies the page width; never re-centre. */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-base font-bold tracking-tight text-foreground">{title}</h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * A percentage, or the em dash when there is none.
 *
 * The dash carries its reason as a `title` AND as screen-reader text, because on this page it
 * has exactly one meaning — "there was nothing to divide by" — and that meaning has to be
 * recoverable without a mouse.
 */
export function RateFigure({
  rate,
  reason,
  className,
}: {
  rate: number | null;
  reason: string;
  className?: string;
}) {
  if (rate == null) {
    return (
      <span className={cn("text-muted-foreground", className)} title={reason}>
        {NO_VALUE}
        <span className="sr-only"> {reason}</span>
      </span>
    );
  }
  return <span className={cn("tabular-nums", className)}>{formatRate(rate)}</span>;
}

/**
 * The proportional bar beside a rate.
 *
 * Deliberately one neutral colour at every value: a red/amber/green ramp would invent
 * pass-rate thresholds the school has never set, and these rows are teachers.
 *
 * **A null rate draws no bar at all** — not an empty track. An empty track beside an em dash
 * is a picture of 0%, which is exactly the claim the dash exists to avoid: an unassigned
 * bucket with nobody on its roster looked like a group that failed everyone. `barWidth()` in
 * `questionAnalysis` already gets this right; this matches it.
 *
 * Wide enough to be read rather than decorate: at the old 56px, 68% and 63% differed by three
 * pixels and the bar carried no information a reader could actually use.
 */
export function RateBar({ rate, className }: { rate: number | null; className?: string }) {
  if (rate == null) return null;
  const width = Math.max(0, Math.min(100, rate));
  return (
    <span
      className={cn(
        "inline-block h-2 w-28 shrink-0 overflow-hidden rounded-full bg-surface-2 align-middle",
        className,
      )}
      aria-hidden
    >
      <span className="block h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
    </span>
  );
}

/**
 * A rate with its bar and the counts it is made of — the whole cell, in one place.
 *
 * The bar sits to the LEFT of the number so the number lands on the column's right edge,
 * under the right-aligned "Pass rate" header. With the bar last, the header lined up with the
 * end of a bar and the percentage floated somewhere in the middle of its own column.
 */
export function RateCell({
  rate,
  reason,
  detail,
  title,
}: {
  rate: number | null;
  reason: string;
  /** "9 of 10" — always shown, so a reader can see the fraction behind the percentage. */
  detail: string;
  /**
   * Why this denominator is not the headcount printed beside the row's name, when the two
   * differ. Every ranked row shows both numbers; without this it reconciles neither.
   */
  title?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-3" title={title}>
      <RateBar rate={rate} />
      <span className="text-right">
        <RateFigure rate={rate} reason={reason} className="font-bold text-foreground" />
        <span className="block text-[11px] tabular-nums text-muted-foreground">{detail}</span>
      </span>
    </div>
  );
}

/** A plain number in a table cell. Zero is muted so the eye lands on what is not zero. */
export function Num({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn("tabular-nums", value === 0 ? "text-muted-foreground" : "text-foreground", className)}
    >
      {value}
    </span>
  );
}

export type RankedColumn<T> = {
  key: string;
  header: ReactNode;
  align?: "left" | "right";
  /** Applied to both the header cell and every body cell in the column. */
  className?: string;
  cell: (row: T, index: number) => ReactNode;
};

/**
 * The one table shape on this page: a rank, a name, a rate, and the counts behind the rate.
 *
 * Horizontal overflow is the table's own, never the page body's — an ops page that scrolls
 * sideways takes its sidebar with it.
 */
export function RankedTable<T>({
  columns,
  rows,
  rowKey,
  minWidthClass = "min-w-[720px]",
  empty,
}: {
  columns: RankedColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  minWidthClass?: string;
  empty: ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", minWidthClass)}>
        <thead>
          <tr className="border-b border-border text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "px-3 py-2.5 first:pl-5 last:pr-5",
                  c.align === "right" ? "text-right" : "text-left",
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="align-middle hover:bg-surface-2">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-3 py-2.5 first:pl-5 last:pr-5",
                    c.align === "right" ? "text-right" : "text-left",
                    c.className,
                  )}
                >
                  {c.cell(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The rank number, muted — it orders the table without competing with the names. */
export function Rank({ index }: { index: number }) {
  return <span className="tabular-nums text-muted-foreground">{index + 1}</span>;
}

/**
 * A row whose identity is a known gap in the record ("Unassigned").
 *
 * Marked rather than hidden: dropping these rows would quietly shrink the school's own total
 * below the sum of its branches, with nothing on screen to say why.
 */
export function GapMarker({ note }: { note: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-warning/25 bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning-foreground"
      title={note}
    >
      <Info className="h-3 w-3 shrink-0" aria-hidden />
      Data gap
      <span className="sr-only"> — {note}</span>
    </span>
  );
}

/** A quiet aside: a caveat about the numbers above it, not a failure. */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/**
 * The error branch. Never an empty state: "no data" where a request failed is the bug this
 * page has had before, and a reader who cannot tell the two apart draws the wrong conclusion
 * about a class.
 */
export function ErrorPanel({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-2xl border border-danger/25 bg-danger-soft p-4 text-sm text-danger-foreground",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-bold">Could not load these figures</p>
        <p className="mt-0.5 font-semibold">{message}</p>
        <p className="mt-1 text-[13px] font-normal opacity-90">
          Nothing here is empty — it is unknown. Retry before reading anything into a blank
          table.
        </p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="ds-ring shrink-0 rounded-lg border border-danger/30 px-3 py-1.5 text-[13px] font-bold hover:bg-danger/10"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** The empty branch: a month that genuinely holds no midterms. */
export function EmptyPanel({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">{body}</p>
    </div>
  );
}

/** The loading branch. Shaped like the thing it is standing in for. */
export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}
