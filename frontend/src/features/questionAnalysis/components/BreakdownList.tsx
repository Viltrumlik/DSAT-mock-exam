import { cn } from "@/lib/cn";
import { Card, CardHeader } from "@/features/classroom/ui";
import { HELD_OUT_RATE_TITLE, barWidth, formatCount, heldOutNote, plural } from "../format";
import { RateValue } from "./Rate";
import { TAG_TONES, Tag } from "./Tag";

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
   * Questions counted in `questions` but held out of everything else on the row, because
   * their answer key is likelier broken than the topic is hard. Past papers only — the
   * assessments endpoint has no such concept, so it leaves this undefined and the row renders
   * exactly as it always did.
   */
  heldOut?: number;
  /** `questions - heldOut`: what the rate and counts on this row actually cover. */
  analysedQuestions?: number;
  /**
   * Questions that carry no tag at all. Kept as its own row and marked as such: it is a
   * disclosure about the content, not a topic anyone can go and teach.
   */
  isUntagged: boolean;
}

/**
 * The track every bar on the page is drawn in.
 *
 * Fixed width, not `w-full`. When the track was the card's width and one card spanned two
 * grid columns, a 63% bar rendered ~410px beside a 65% bar at ~185px — the longer bar was
 * the smaller number, in a section whose only job is comparison. A fixed track means a
 * percentage is the same length wherever it appears, and it is the reason the cards no
 * longer need to be the same width to be comparable.
 *
 * `max-w-full` so the narrowest phone still clips nothing.
 */
export const BAR_TRACK_CLASS = "h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-surface-2";

/**
 * The grid these cards sit in.
 *
 * `auto-fit` over a `lg:grid-cols-3` breakpoint because the breakpoint measured the WRONG
 * box: `lg:` fires at a 1024px viewport, but the teacher shell's sidebar leaves the page
 * about 752px, so three columns arrived ~110px wide and truncated skill names like
 * "Cross-Text Connections". This tracks the container instead of the window, so the column
 * count follows the space the cards actually have. `min(100%, 18rem)` keeps a single column
 * from overflowing a phone.
 *
 * `align-items: start` is the other half: stretched rows gave "Question type" and "Format"
 * 250–350px of dead space each, because a grid row is as tall as its tallest card.
 */
export const BREAKDOWN_GRID_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))",
  alignItems: "start",
};

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
            const heldOut = row.heldOut ?? 0;
            // Falls back to the full count, so an endpoint with no hold-out concept reads
            // "all of them" rather than "none of them".
            const analysedQuestions = row.analysedQuestions ?? row.questions;
            const allHeldOut = heldOut > 0 && analysedQuestions <= 0;
            const note = heldOutNote(heldOut, analysedQuestions);
            return (
              <li key={row.id} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {/* Wraps rather than truncates: the skill name is the answer this row
                        exists to give, and half of "Cross-Text Connect…" is not it. */}
                    <span
                      data-breakdown-label
                      className={cn(
                        "text-sm font-medium",
                        row.isUntagged ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {row.label}
                    </span>
                    {row.isUntagged && (
                      <Tag tone="neutral" className="shrink-0">
                        No tag
                      </Tag>
                    )}
                  </span>
                  <RateValue
                    value={row.errorRate}
                    flagged={flagged}
                    // A dash here has two possible reasons and they ask for opposite
                    // actions — wait for answers, or go and read the answer key.
                    emptyTitle={allHeldOut ? HELD_OUT_RATE_TITLE : undefined}
                    className="shrink-0 text-sm font-bold"
                  />
                </div>
                <div data-bar-track className={BAR_TRACK_CLASS}>
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
                <p data-breakdown-counts className="text-xs text-muted-foreground">
                  {plural(row.questions, "question")}
                  {/* The count of what was held out sits with the count it was held out of,
                      so the rate above never quietly covers fewer questions than the row
                      says it has. */}
                  {heldOut > 0 ? ` (${formatCount(heldOut)} held out)` : ""} ·{" "}
                  {allHeldOut
                    ? "nothing left to average"
                    : `${formatCount(row.wrong)} wrong of ${formatCount(row.denominator)} ${denominatorNoun}`}
                  {row.flagged > 0 ? ` · ${row.flagged} to go over` : ""}
                </p>
                {note ? (
                  /* `TAG_TONES.warning`'s ink, which `contrast.test.ts` measures in both
                     themes — this is the one line on the row that a teacher must read. */
                  <p
                    data-held-out-note
                    className={cn(
                      "rounded-lg px-2 py-1 text-xs leading-relaxed",
                      TAG_TONES.warning,
                    )}
                  >
                    {note}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
