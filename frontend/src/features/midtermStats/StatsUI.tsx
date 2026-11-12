"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Badge, Button, EmptyState } from "@/features/console/ui";
import { cn } from "@/lib/cn";
import { NO_VALUE, SCHEDULED, formatRate, monthLabel, plural, titleList } from "./format";
import type { MonthKey, RetakeBrief } from "./types";

/**
 * The presentation atoms the statistics page is built from.
 *
 * They exist as one small vocabulary rather than as inline markup because the page's whole
 * problem was inconsistency: the same idea drawn five ways is what made the old midterms
 * page unreadable. A rate looks like a rate everywhere here, a missing number looks like a
 * missing number everywhere here, and neither is spelled out twice.
 *
 * Drawn in the console's look (design handoff v0.3): cards on the page, hairline tables,
 * notices in the verdict colours with their icon.
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
  index,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Position on the page, so a screenful of cards arrives in order rather than at once. */
  index?: number;
}) {
  return (
    <section
      className={cn("animate-ms-card-in relative overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1", className)}
      style={{ animationDelay: `${(index ?? 0) * 80}ms` }}
    >
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
      className={cn("inline-block h-2 w-28 shrink-0 overflow-hidden rounded-full bg-ms-surface-2 align-middle", className)}
      aria-hidden
    >
      <span className="block h-full rounded-full bg-ms-primary" style={{ width: `${width}%` }} />
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
  bar = true,
}: {
  rate: number | null;
  reason: string;
  /** "9 of 10" — always shown, so a reader can see the fraction behind the percentage. */
  detail: string;
  /**
   * Whether to draw the rate's own bar. Off wherever the row already carries a bar of what
   * actually happened: two bars on one row, one of them merely restating the percentage
   * printed between them, is decoration — and this school has rejected exactly that before.
   */
  bar?: boolean;
  /**
   * Why this denominator is not the headcount printed beside the row's name, when the two
   * differ. Every ranked row shows both numbers; without this it reconciles neither.
   */
  title?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-3" title={title}>
      {bar ? <RateBar rate={rate} /> : null}
      <span className="text-right">
        <RateFigure rate={rate} reason={reason} className="font-semibold text-ms-fg" />
        <span className="block text-[12px] tabular-nums text-ms-fg-3">{detail}</span>
      </span>
    </div>
  );
}

/** A plain number in a table cell. Zero is muted so the eye lands on what is not zero. */
export function Num({ value, className }: { value: number; className?: string }) {
  return <span className={cn("tabular-nums", value === 0 ? "text-ms-fg-3" : "text-ms-fg", className)}>{value}</span>;
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
            <tr
              key={rowKey(row, i)}
              className="animate-ms-fade-in ms-transition align-middle hover:bg-ms-surface"
              // Capped: a long table must not make its last row wait a second and a half
              // for its turn, and past a dozen rows nobody reads the stagger anyway.
              style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn(TD, c.align === "right" ? "text-right" : "text-left", c.className)}>
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
  return <span className="tabular-nums text-ms-fg-3">{index + 1}</span>;
}

/**
 * A row whose identity is a known gap in the record ("Unassigned").
 *
 * Marked rather than hidden: dropping these rows would quietly shrink the school's own total
 * below the sum of its branches, with nothing on screen to say why.
 */
export function GapMarker({ note }: { note: string }) {
  return (
    <span title={note} className="inline-flex shrink-0">
      <Badge tone="attention" icon="info">
        Data gap
        <span className="sr-only"> — {note}</span>
      </Badge>
    </span>
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
 * The banner over a month nobody has sat yet.
 *
 * This is the rendered half of `is_future`, and it exists because of a specific misreading a
 * director could not have detected: every teacher assign path writes a `starts_at`, so a paper
 * booked for next month dates into next month, its whole roster is absent, absent counts as
 * not passed — and the pooled formula returns a flawless **0.0%** for work nobody has done.
 * Nothing in the shape of that answer says it is a plan. The backend stopped such a month
 * being the default; the picker still offers it, so this says what it is.
 *
 * Loud on purpose (`role="note"`, warning tone, top of the page): the figures under it are
 * about to look exactly like results, and a reader who scrolls past a quiet line is left with
 * the school's own console telling them a class scored nothing.
 */
export function ScheduledBanner({
  month,
  thisMonth,
  latestMonth,
  onOpenLatest,
  detail,
}: {
  month: MonthKey;
  /** The school's own current month — the payload computes it; the browser must not. */
  thisMonth?: MonthKey | null;
  /** The newest month actually sat, offered as somewhere real to go. */
  latestMonth?: MonthKey | null;
  onOpenLatest?: () => void;
  /** What IS known about the month: how many papers, for how many classes. */
  detail?: ReactNode;
}) {
  return (
    <div
      role="note"
      className="animate-ms-fade-in flex flex-wrap items-start gap-3 rounded-ms-card border border-ms-attention-line bg-ms-attention-soft px-4 py-3.5 text-[14px] leading-5 text-ms-attention-fg"
    >
      <Icon name="cal" size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1 basis-[18rem]">
        <p className="font-semibold">
          {monthLabel(month)} is scheduled — nobody has sat these papers yet
        </p>
        <p className="mt-0.5">
          There are no results for a month the learning center has not reached
          {thisMonth ? `; it is ${monthLabel(thisMonth)} now` : ""}. Every student on these
          class lists is still counted as not having come, which counts as not passed — so a rate
          here would come out at zero for work nobody has done. Nothing on this page is a
          score for {monthLabel(month)}.
        </p>
        {detail ? <p className="mt-1 text-[13px] leading-[18px] text-ms-fg-2">{detail}</p> : null}
      </div>
      {onOpenLatest && latestMonth ? (
        <Button variant="secondary" size="sm" onClick={onOpenLatest}>
          Show {monthLabel(latestMonth)} instead
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Where a rate would go in a scheduled month: the word, not a percentage.
 *
 * The alternative — printing the real 0% in a muted colour — still leaves a number on the page
 * that a reader can quote, screenshot or paste into a message with the caveat left behind.
 */
export function ScheduledFigure({ className }: { className?: string }) {
  return (
    <span className={cn("text-ms-fg-3", className)}>
      {SCHEDULED}
      <span className="sr-only"> — nobody has sat this yet, so there is no rate</span>
    </span>
  );
}

/**
 * The retake papers left out of every figure, named.
 *
 * A parentless RETAKE is excluded from the whole aggregation: it cannot be counted (only
 * students who did not pass are ever given one, so its denominator would be a class it was
 * never offered to) and it cannot be folded into a parent that does not exist. Silence was the
 * bug — a paper somebody can see in the builder simply went missing from the table.
 */
export function OrphanRetakeNote({
  month,
  papers,
}: {
  month: MonthKey | null;
  papers: RetakeBrief[];
}) {
  if (papers.length === 0) return null;
  const one = papers.length === 1;
  return (
    <div
      role="note"
      className="animate-ms-fade-in rounded-ms-card border border-ms-attention-line bg-ms-attention-soft px-4 py-3 text-[14px] leading-5 text-ms-attention-fg"
    >
      <p className="flex items-start gap-2 font-semibold">
        <Icon name="warn" size="sm" className="mt-0.5" />
        <span>
          {plural(papers.length, "retake paper")} left out of every figure
          {month ? ` for ${monthLabel(month)}` : ""}
        </span>
      </p>
      <p className="mt-1 pl-6">
        {titleList(papers.map((p) => p.title))} {one ? "has" : "have"} no main exam to belong
        to, so {one ? "it counts" : "they count"} nowhere. Give {one ? "it" : "each"} a main
        exam in the builder and {one ? "it joins" : "they join"} that exam&rsquo;s numbers.
      </p>
    </div>
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
        "animate-ms-fade-in flex flex-wrap items-start gap-3 rounded-ms-card border border-ms-critical-line bg-ms-critical-soft px-4 py-3.5 text-[14px] leading-5 text-ms-critical-fg",
        className,
      )}
    >
      <Icon name="alert" size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1 basis-[16rem]">
        <p className="font-semibold">Could not load these figures</p>
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

/** The empty branch: a month that genuinely holds no midterms. */
export function EmptyPanel({ title, body }: { title: string; body: string }) {
  return <EmptyState icon="ms-midterm" title={title} detail={body} />;
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
