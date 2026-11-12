"use client";

import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Badge, Button, EmptyState, type BadgeTone } from "@/features/console/ui";
import { cn } from "@/lib/cn";
import { NO_VALUE, STATUS_NOTE, formatRate, ratePercent, type StatusTone } from "./format";

/**
 * The presentation atoms the support report is built from.
 *
 * One small vocabulary rather than inline markup, for the same reason the midterm statistics
 * page has one: a rate looks like a rate everywhere here, a missing number looks like a
 * missing number everywhere here, and a failed request never wears the clothes of an empty
 * desk.
 *
 * Drawn in the console's look (design handoff v0.3): cards on the page, hairline tables, verdicts
 * as words with a dot or an icon.
 */

/** A table head cell, and a body cell; a column's alignment is added beside, never set twice. */
const TH = "h-10 border-b border-ms-border px-3 text-[13px] font-medium text-ms-fg-3 first:pl-5 last:pr-5";
const TD = "px-3 py-2.5 first:pl-5 last:pr-5";

/**
 * The console's card. The ops shell already supplies the page width; never re-centre.
 *
 * `relative overflow-hidden`: a row's hover stays inside the rounded corners, and a cell's sr-only
 * words are positioned inside the card rather than against the page.
 */
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
    <section className={cn("animate-ms-card-in relative overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ms-line px-5 py-4">
          <div className="min-w-0 flex-1 basis-[18rem]">
            {title ? <h2 className="text-ms-h text-ms-fg">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-[14px] leading-5 text-ms-fg-2">{description}</p> : null}
          </div>
          {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
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
      <span className={cn("text-ms-fg-3", className)} title={reason}>
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
      className={cn("inline-block h-2 w-24 shrink-0 overflow-hidden rounded-full bg-ms-surface-2 align-middle", className)}
      aria-hidden
    >
      <span className="block h-full rounded-full bg-ms-primary" style={{ width: `${width}%` }} />
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
        <RateFigure rate={rate} reason={reason} className="font-semibold text-ms-fg" />
        <span className="block text-[12px] tabular-nums text-ms-fg-3">{detail}</span>
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
        warn ? "font-semibold text-ms-attention-fg" : value === 0 ? "text-ms-fg-3" : "text-ms-fg",
        className,
      )}
    >
      {value}
    </span>
  );
}

/** Each outcome as the console's verdict pill: green held, amber late or unsettled, red missed. */
const TONE_BADGE: Record<StatusTone, BadgeTone> = {
  held: "positive",
  late: "attention",
  missed: "critical",
  cancelled: "neutral",
  unsettled: "attention",
  upcoming: "info",
};

/**
 * A booking's outcome, in English and in colour.
 *
 * Never the raw enum: `NO_SHOW` on screen reads as a system fault rather than as a student
 * who did not arrive, and "Did not attend" is the school's own wording for it.
 */
export function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span title={STATUS_NOTE[tone]} className="inline-flex">
      <Badge tone={TONE_BADGE[tone]} dot>
        {label}
        <span className="sr-only"> — {STATUS_NOTE[tone]}</span>
      </Badge>
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
      <table className={cn("w-full border-collapse text-[14px] text-ms-fg", minWidthClass)}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn(TH, c.align === "right" ? "text-right" : "text-left", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ms-line">
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="ms-transition align-middle hover:bg-ms-surface">
              {columns.map((c) => (
                <td key={c.key} className={cn(TD, c.align === "right" ? "text-right" : "text-left", c.className)}>
                  {c.cell(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot className="border-t border-ms-border">{footer}</tfoot> : null}
      </table>
    </div>
  );
}

/** A quiet aside: a caveat about the numbers above it, not a failure. */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-[13px] leading-[19px] text-ms-fg-2", className)}>
      <Icon name="info" size="sm" className="mt-0.5 size-3.5 text-ms-fg-3" />
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
        "animate-ms-fade-in flex flex-wrap items-start gap-3 rounded-ms-card border border-ms-critical-line bg-ms-critical-soft px-4 py-3.5 text-[14px] leading-5 text-ms-critical-fg",
        className,
      )}
    >
      <Icon name="alert" size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1 basis-[16rem]">
        <p className="font-semibold">Could not load the support report</p>
        <p className="mt-0.5">{message}</p>
        <p className="mt-1 text-[13px] leading-[18px] text-ms-fg-2">
          Nothing here is empty — it is unknown. Retry before reading anything into a blank
          table.
        </p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** The empty branch: a month, or a filter, that genuinely holds no sessions. */
export function EmptyPanel({ title, body, icon = "ms-support" }: { title: string; body: string; icon?: IconName }) {
  return <EmptyState icon={icon} title={title} detail={body} />;
}

/** The loading branch. Shaped like the thing it is standing in for. */
export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-5" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="animate-ms-shimmer h-9 rounded-ms-ctl" />
      ))}
    </div>
  );
}

/** One headline figure. The row of them is the month in six numbers. */
export function StatTile({
  label,
  value,
  detail,
  tone,
  delay = 0,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "default" | "warning";
  /** When it arrives, in ms, so the row comes in left to right. */
  delay?: number;
}) {
  const warn = tone === "warning";
  return (
    <div
      className={cn(
        "animate-ms-card-in flex min-w-0 flex-col gap-1 rounded-ms-card p-4",
        warn ? "border border-ms-attention-line bg-ms-attention-soft" : "bg-ms-card shadow-ms-1",
      )}
      style={{ animationDelay: `${delay}ms` } as CSSProperties}
    >
      <p className={cn("flex items-center gap-1.5 text-[13.5px] leading-5", warn ? "font-medium text-ms-attention-fg" : "text-ms-fg-2")}>
        {warn ? <Icon name="warn" size="sm" className="size-3.5" /> : null}
        {label}
      </p>
      <p className={cn("text-[28px] font-bold leading-8 tabular-nums", warn ? "text-ms-attention-fg" : "text-ms-fg")}>{value}</p>
      {detail ? <p className={cn("text-[13px] leading-[18px]", warn ? "text-ms-attention-fg" : "text-ms-fg-3")}>{detail}</p> : null}
    </div>
  );
}
