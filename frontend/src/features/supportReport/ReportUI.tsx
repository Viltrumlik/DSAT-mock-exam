"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { NO_VALUE, STATUS_NOTE, formatRate, ratePercent, type StatusTone } from "./format";

/**
 * The presentation atoms the support report is built from.
 *
 * One small vocabulary rather than inline markup, for the same reason the midterm statistics
 * page has one: a rate looks like a rate everywhere here, a missing number looks like a
 * missing number everywhere here, and a failed request never wears the clothes of an empty
 * desk.
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
 * `rate` is the payload's own **fraction** (0…1), never a percentage — `formatRate` is what
 * scales it, in one place, so no caller can forget. The dash carries its reason as a `title`
 * AND as screen-reader text, because on this page it has exactly one meaning — "nobody was
 * settled either way" — and that meaning has to be recoverable without a mouse.
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
 * One neutral colour at every value: a red/amber/green ramp would invent attendance thresholds
 * the school has never set, and these rows are people.
 *
 * **A null rate draws no bar at all** — not an empty track. An empty track beside an em dash
 * is a picture of 0%, which is exactly the claim the dash exists to avoid.
 */
export function RateBar({ rate, className }: { rate: number | null; className?: string }) {
  const pct = ratePercent(rate);
  if (pct == null) return null;
  const width = Math.max(0, Math.min(100, pct));
  return (
    <span
      className={cn(
        "inline-block h-2 w-24 shrink-0 overflow-hidden rounded-full bg-surface-2 align-middle",
        className,
      )}
      aria-hidden
    >
      <span className="block h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
    </span>
  );
}

/** A rate with its bar and the counts it is made of — the whole cell, in one place. */
export function RateCell({
  rate,
  reason,
  detail,
}: {
  rate: number | null;
  reason: string;
  /** "9 of 10" — always shown, so a reader sees the fraction behind the percentage. */
  detail: string;
}) {
  return (
    <div className="flex items-center justify-end gap-3">
      <RateBar rate={rate} />
      <span className="text-right">
        <RateFigure rate={rate} reason={reason} className="font-bold text-foreground" />
        <span className="block text-[11px] tabular-nums text-muted-foreground">{detail}</span>
      </span>
    </div>
  );
}

/**
 * A plain number in a table cell. Zero is muted so the eye lands on what is not zero.
 *
 * `tone="warning"` is for the unsettled column only: a non-zero there is the one count on
 * this page that is a call to action rather than a fact about a month.
 */
export function Num({
  value,
  tone,
  className,
  title,
}: {
  value: number;
  tone?: "default" | "warning";
  className?: string;
  title?: string;
}) {
  const warn = tone === "warning" && value > 0;
  return (
    <span
      title={title}
      className={cn(
        "tabular-nums",
        warn
          ? "font-bold text-warning-foreground"
          : value === 0
            ? "text-muted-foreground"
            : "text-foreground",
        className,
      )}
    >
      {value}
    </span>
  );
}

const TONE_CLASS: Record<StatusTone, string> = {
  held: "border-success/25 bg-success-soft text-success-foreground",
  missed: "border-danger/25 bg-danger-soft text-danger-foreground",
  cancelled: "border-border bg-surface-2 text-muted-foreground",
  unsettled: "border-warning/30 bg-warning-soft text-warning-foreground",
  upcoming: "border-info/25 bg-info-soft text-info-foreground",
};

/**
 * A booking's outcome, in English and in colour.
 *
 * Never the raw enum: `NO_SHOW` on screen reads as a system fault rather than as a student
 * who did not arrive, and "Did not attend" is the school's own wording for it.
 */
export function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span
      title={STATUS_NOTE[tone]}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-bold",
        TONE_CLASS[tone],
      )}
    >
      {label}
      <span className="sr-only"> — {STATUS_NOTE[tone]}</span>
    </span>
  );
}

export type Column<T> = {
  key: string;
  header: ReactNode;
  align?: "left" | "right";
  /** Applied to both the header cell and every body cell in the column. */
  className?: string;
  cell: (row: T, index: number) => ReactNode;
};

/**
 * The one table shape on this page.
 *
 * Horizontal overflow is the table's own, never the page body's — an ops page that scrolls
 * sideways takes its sidebar with it.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  minWidthClass = "min-w-[820px]",
  footer,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  minWidthClass?: string;
  /** The school-wide total row, rendered inside the same table so its columns line up. */
  footer?: ReactNode;
}) {
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
        {footer ? <tfoot className="border-t-2 border-border">{footer}</tfoot> : null}
      </table>
    </div>
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
 * The error branch. **Never an empty state.**
 *
 * "No sessions" where a request failed is a lie about the school, and it is the house rule
 * this codebase has been bitten by: a reader who cannot tell the two apart concludes that a
 * support teacher did nothing all month.
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
        <p className="font-bold">Could not load the support report</p>
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

/** The empty branch: a month, or a filter, that genuinely holds no sessions. */
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
    <div className="space-y-2 p-5" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

/** One headline figure. The row of them is the month in five numbers. */
export function StatTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        tone === "warning" ? "border-warning/30 bg-warning-soft" : "border-border bg-card",
      )}
    >
      <p
        className={cn(
          "text-[10px] font-bold uppercase tracking-widest",
          tone === "warning" ? "text-warning-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 text-2xl font-extrabold tabular-nums",
          tone === "warning" ? "text-warning-foreground" : "text-foreground",
        )}
      >
        {value}
      </p>
      {detail ? (
        <p
          className={cn(
            "mt-0.5 text-[12px]",
            tone === "warning" ? "text-warning-foreground opacity-90" : "text-muted-foreground",
          )}
        >
          {detail}
        </p>
      ) : null}
    </div>
  );
}
