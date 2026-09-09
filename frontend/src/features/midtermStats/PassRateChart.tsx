"use client";

import { ChartCard } from "@/components/ui/charts";
import { MIN_CHART_GROUPS, chartBars, formatRate, monthLabel, plural } from "./format";
import type { ChartBar } from "./format";
import type { BranchRow, MonthlyStats, TeacherRow } from "./types";

/**
 * One chart, and only where a chart beats a number.
 *
 * A ranked table already answers "who is highest"; a chart answers "by how much", which a
 * column of percentages genuinely does not — the eye reads 91 and 74 as neighbours in a list
 * and as a gap in a chart. That is worth one chart. It is not worth a donut of two values, or
 * a second copy of a table with axes on it, so there is exactly one here.
 *
 * Which comparison it draws is decided by the data, not by a control: branches when there are
 * enough branches to compare, otherwise teachers. A page whose chart silently changes subject
 * under a toggle is the fault this rebuild exists to remove.
 *
 * Three rules the first version broke:
 *
 * 1. **The "Unassigned" bucket is never a bar.** It is a hole in the record (see
 *    {@link chartBars}), and a chart cannot mark it the way the table does — so it is left
 *    out and counted in the caption instead.
 * 2. **Fewer than three groups is not a chart.** Two bars beside a two-row table are the
 *    same fact drawn twice, and one real branch plus the gap bucket used to clear the old
 *    two-bar bar.
 * 3. **The axis carries its unit.** Bare `0 20 40 60 80` on a page whose other numbers are
 *    scores out of 800 is an invitation to misread. Every number here ends in a `%`.
 *
 * Drawn from spans and a grid rather than the shared recharts `BarChart` on purpose: with
 * four groups that component spends 260px of height on empty plot area, and its Y axis takes
 * no formatter, so the unit could not be shown at all.
 */

const MAX_BARS = 12;

/** The gridlines, and the only numbers on the axis. Quarters read without being counted. */
const TICKS = [0, 25, 50, 75, 100];

function Bars({ bars }: { bars: ChartBar[] }) {
  return (
    <div>
      <ol className="space-y-2">
        {bars.map((bar) => (
          <li key={bar.name} className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3">
            <span className="truncate text-[13px] font-bold text-foreground" title={bar.name}>
              {bar.name}
            </span>
            {/* The track is the full 0–100 scale, always drawn, so a short bar reads as a
                low rate rather than as a narrow chart. */}
            <span className="relative block h-5 overflow-hidden rounded-md bg-surface-2">
              {TICKS.slice(1, -1).map((t) => (
                <span
                  key={t}
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-border"
                  style={{ left: `${t}%` }}
                />
              ))}
              <span
                className="absolute inset-y-0 left-0 rounded-md bg-primary"
                style={{ width: `${Math.max(0, Math.min(100, bar.rate))}%` }}
              />
            </span>
            <span className="w-14 text-right text-[13px] font-bold tabular-nums text-foreground">
              {formatRate(bar.rate)}
            </span>
          </li>
        ))}
      </ol>

      {/* The axis, under the bars and aligned to the track column. */}
      <div className="mt-2 grid grid-cols-[minmax(0,140px)_1fr_auto] gap-3" aria-hidden>
        <span />
        <span className="relative block h-4">
          {TICKS.map((t) => (
            <span
              key={t}
              className="absolute top-0 -translate-x-1/2 text-[11px] tabular-nums text-muted-foreground"
              style={{ left: `${t}%` }}
            >
              {t}%
            </span>
          ))}
        </span>
        <span className="w-14" />
      </div>
    </div>
  );
}

export function PassRateChart({ stats }: { stats: MonthlyStats }) {
  const byBranch = chartBars<BranchRow>(stats.branches, MAX_BARS);
  const byTeacher = chartBars<TeacherRow>(stats.teachers, MAX_BARS);

  const useBranches = byBranch.bars.length >= MIN_CHART_GROUPS;
  const picked = useBranches ? byBranch : byTeacher;
  // Below three plottable groups the table says everything a chart would, and says it with
  // the counts attached. Draw nothing rather than a chart that adds only decoration.
  if (picked.bars.length < MIN_CHART_GROUPS) return null;

  const noun = useBranches ? "branch" : "teacher";
  const nounPlural = useBranches ? "branches" : "teachers";

  return (
    <ChartCard
      title={`Pass rate by ${noun}`}
      description={
        <>
          {monthLabel(stats.month)} · pooled — each bar is that {noun}&rsquo;s passers over its
          rosters.
          {picked.gaps > 0
            ? ` The unassigned bucket is left out: it is a gap in the record, not a ${noun}, and it is listed in the table below.`
            : ""}
          {picked.unrated > 0
            ? ` ${plural(picked.unrated, noun, nounPlural)} ${picked.unrated === 1 ? "has" : "have"} no roster this month and cannot be plotted.`
            : ""}
          {picked.truncated > 0
            ? ` Showing the top ${picked.bars.length}; ${picked.truncated} more are in the table below.`
            : ""}
        </>
      }
    >
      <Bars bars={picked.bars} />
    </ChartCard>
  );
}
