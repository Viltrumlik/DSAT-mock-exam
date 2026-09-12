"use client";

import { AreaChart, ChartCard, DonutChart, StackedBarChart } from "@/components/ui/charts";
import { OUTCOME, outcomeSlices } from "./outcome";
import { monthLabel, plural } from "./format";
import { LEVEL_NOUN, isGapNode } from "./tree";
import type { MonthKey, MonthlyStats, TreeLevel, TreeNode, TrendPoint } from "./types";

/**
 * The three pictures this page earns, and no more.
 *
 * The page had exactly one chart and it drew the same percentages the table under it already
 * listed. These three each answer something a table cannot:
 *
 * * the **donut** — what the month is MADE of. "32% passed" hides whether the other 68% sat
 *   the exam and failed it or never turned up, and those are different problems.
 * * the **bars** — how the rows compare by size as well as by rate. A column of numbers reads
 *   91 and 74 as neighbours; a chart reads them as a gap, and a stacked bar shows a small
 *   class next to a large one without either pretending to be the other.
 * * the **line** — whether the school is getting better. Nothing on the page said anything
 *   about last month, so no reader could tell an unusual month from a normal one.
 */

const BAR_MAX = 12;
/**
 * Two is the floor, not three.
 *
 * The old rate chart needed three, and rightly: two bars whose only dimension is a
 * percentage say exactly what two rows of a table already said. These bars are stacked by
 * headcount, so even two of them carry something the table cannot — that this department is
 * three times the size of that one, and that its failures are absences rather than fails.
 * Three would also have meant this chart never appeared at all for a school with two
 * departments and two teachers in each, which is this one.
 */
const MIN_BARS = 2;

const STACK_SERIES = [
  { key: "passed", label: OUTCOME.passed.label, color: OUTCOME.passed.color },
  { key: "failed", label: OUTCOME.failed.label, color: OUTCOME.failed.color },
  { key: "absent", label: OUTCOME.absent.label, color: OUTCOME.absent.color },
];

/** Long names never fit under a bar; the tooltip carries the whole one. */
function shortName(name: string): string {
  return name.length <= 16 ? name : `${name.slice(0, 15)}…`;
}

export function ResultsDonut({ stats }: { stats: MonthlyStats }) {
  const t = stats.totals;
  const slices = outcomeSlices(t);
  return (
    <ChartCard
      title="What happened this month"
      description={`${monthLabel(stats.month)} · every student who was due to sit an exam.`}
    >
      <DonutChart
        data={slices}
        height={244}
        thickness={26}
        centerLabel="Passed"
        centerValue={t.pass_rate == null ? "—" : `${t.pass_rate}%`}
        valueFormatter={(v) => `${v} student${v === 1 ? "" : "s"}`}
        emptyMessage={{
          title: "Nothing to show",
          description: "Nobody was due to sit an exam in this month.",
        }}
      />
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {slices.map((slice) => (
          <li key={slice.name} className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} aria-hidden />
            <span className="truncate">{slice.name}</span>
            <span className="ml-auto font-bold tabular-nums text-foreground">{slice.value}</span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

export function LevelBars({
  nodes,
  level,
  month,
  scope,
}: {
  /** The rows on screen right now — the chart never plots a level the reader is not on. */
  nodes: readonly TreeNode[];
  level: TreeLevel;
  month: MonthKey | null;
  /** The node these rows are inside, named so the chart cannot be read as the whole school. */
  scope: string | null;
}) {
  const { one: noun, many: nounPlural } = LEVEL_NOUN[level];
  // "Unassigned" is a hole in the record rather than a competitor, and a chart cannot mark
  // it the way the table does — so it is counted in the caption instead of drawn.
  const plottable = nodes.filter((n) => !isGapNode(n) && (n.roster ?? 0) > 0);
  const hidden = nodes.length - plottable.length;
  const shown = plottable.slice(0, BAR_MAX);

  if (shown.length < MIN_BARS) return null;

  const data = shown.map((n) => ({
    name: shortName(n.name),
    full: n.name,
    passed: n.passed ?? 0,
    failed: n.failed ?? 0,
    absent: (n.absent ?? 0) + (n.pending ?? 0),
  }));

  return (
    <ChartCard
      title={`Every ${noun}${scope ? ` in ${scope}` : ""}`}
      description={
        <>
          {monthLabel(month)} · one bar per {noun}, as tall as the number of students it was
          due to sit.
          {hidden > 0 ? ` ${plural(hidden, noun, nounPlural)} left out: nobody was due to sit there.` : ""}
          {plottable.length > shown.length
            ? ` Showing the first ${shown.length}; the rest are in the table below.`
            : ""}
        </>
      }
      legend={STACK_SERIES}
    >
      <StackedBarChart
        data={data}
        xKey="name"
        series={STACK_SERIES}
        height={260}
        valueFormatter={(v) => `${v} student${v === 1 ? "" : "s"}`}
      />
    </ChartCard>
  );
}

export function TrendChart({
  points,
  loading,
  error,
}: {
  points: TrendPoint[];
  loading: boolean;
  /** A trend that failed leaves the chart out with a reason — never an empty chart. */
  error: string | null;
}) {
  if (error) {
    return (
      <ChartCard title="Month by month" description="Could not load the earlier months.">
        <p className="py-8 text-center text-[13px] text-muted-foreground">{error}</p>
      </ChartCard>
    );
  }
  // One point is not a trend, and drawing it as a line says the school has been flat.
  if (!loading && points.length < 2) return null;

  // The series key becomes an SVG gradient id (`area-<key>`), so it must be a single word:
  // "Pass rate" produced `url(#area-Pass rate)`, which is not a valid reference, and the
  // area under the line rendered as the browser's default grey instead of the brand tint.
  const data = points.map((p) => ({
    name: monthLabel(p.month).replace(/ \d{4}$/, ""),
    full: monthLabel(p.month),
    rate: p.pass_rate ?? 0,
  }));

  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  const move =
    latest && previous && latest.pass_rate != null && previous.pass_rate != null
      ? Math.round((latest.pass_rate - previous.pass_rate) * 10) / 10
      : null;

  return (
    <ChartCard
      title="Month by month"
      description={
        move == null
          ? "The share of students who passed, in every month the school has sat one."
          : `${monthLabel(latest.month)} is ${move === 0 ? "the same as" : `${Math.abs(move)} points ${move > 0 ? "above" : "below"}`} ${monthLabel(previous.month)}.`
      }
    >
      <AreaChart
        data={data}
        xKey="name"
        series={[{ key: "rate", label: "Pass rate", color: "var(--primary)" }]}
        height={200}
        loading={loading}
        valueFormatter={(v) => `${v}%`}
        emptyMessage={{ title: "No earlier months", description: "This is the first month with results." }}
      />
    </ChartCard>
  );
}
