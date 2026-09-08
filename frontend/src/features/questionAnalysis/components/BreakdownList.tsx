import { cn } from "@/lib/cn";
import { Card, CardHeader, Pill } from "@/features/classroom/ui";
import { barWidth, formatCount, plural } from "../format";
import { RateValue } from "./Rate";

/** One normalised breakdown row, whichever endpoint it came from. */
export interface BreakdownRow {
  id: string;
  label: string;
  /** How many questions on the paper / in the class carry this tag. */
  questions: number;
  wrong: number;
  /** What `errorRate` divides by — "graded answers" or "answers", per endpoint. */
  denominator: number;
  errorRate: number | null;
  flagged: number;
  /**
   * Questions that carry no tag at all. Kept as its own row and marked as such: it is a
   * disclosure about the content, not a topic anyone can go and teach.
   */
  isUntagged: boolean;
}

/**
 * A ranked list with an inline bar — the compact form of a by-type breakdown.
 *
 * A ranked list rather than a plotted chart on purpose: these five breakdowns sit on one
 * screen, several of them carry a dozen skill names that no categorical axis renders legibly,
 * and a row whose rate is `null` has to show an em dash. A bar chart would have to either
 * drop those rows or plot them at zero, and plotting an unknown at zero is the one thing this
 * page may not do.
 */
export function BreakdownList({
  title,
  description,
  rows,
  denominatorNoun,
  note,
  emptyMessage,
  className,
}: {
  title: string;
  description?: string;
  rows: BreakdownRow[];
  /** What the denominator counts, e.g. "graded answers" or "answers". */
  denominatorNoun: string;
  /** Coverage disclosure shown under the header — render it, never an empty table. */
  note?: string | null;
  emptyMessage: string;
  className?: string;
}) {
  return (
    <Card className={cn("space-y-3", className)}>
      <CardHeader title={title} description={description} />
      {note ? (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {note}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const width = barWidth(row.errorRate);
            const flagged = row.flagged > 0;
            return (
              <li key={row.id} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "truncate text-sm font-medium",
                        row.isUntagged ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {row.label}
                    </span>
                    {row.isUntagged && (
                      <Pill tone="neutral" className="shrink-0">
                        No tag
                      </Pill>
                    )}
                  </span>
                  <RateValue
                    value={row.errorRate}
                    flagged={flagged}
                    className="shrink-0 text-sm font-bold"
                  />
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  {width ? (
                    <div
                      className={cn(
                        "h-full rounded-full",
                        flagged ? "bg-rose-500/70" : "bg-primary/70",
                      )}
                      style={{ width }}
                    />
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {plural(row.questions, "question")} ·{" "}
                  {`${formatCount(row.wrong)} wrong of ${formatCount(row.denominator)} ${denominatorNoun}`}
                  {row.flagged > 0 ? ` · ${row.flagged} to go over` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
