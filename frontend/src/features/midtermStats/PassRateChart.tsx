"use client";

import { BarChart, ChartCard } from "@/components/ui/charts";
import { monthLabel } from "./format";
import type { BranchRow, MonthlyStats, TeacherRow } from "./types";

/**
 * One chart, and only where a chart beats a number.
 *
 * A ranked table already answers "who is highest"; a bar chart answers "by how much", which
 * a column of percentages genuinely does not — the eye reads 91 and 74 as neighbours in a
 * list and as a gap in a chart. That is worth one chart. It is not worth a donut of two
 * values, or a second copy of a table with axes on it, so there is exactly one here.
 *
 * Which comparison it draws is decided by the data, not by a control: branches when there is
 * more than one branch to compare, otherwise teachers. A page whose chart silently changes
 * subject under a toggle is the fault this rebuild exists to remove.
 */

const MAX_BARS = 12;

type Plotted = { name: string; pass_rate: number };

function plot(rows: (BranchRow | TeacherRow)[]): Plotted[] {
  return rows
    .filter((r): r is (BranchRow | TeacherRow) & { pass_rate: number } => r.pass_rate != null)
    .slice(0, MAX_BARS)
    .map((r) => ({ name: r.name, pass_rate: r.pass_rate }));
}

export function PassRateChart({ stats }: { stats: MonthlyStats }) {
  const branchBars = plot(stats.branches);
  const teacherBars = plot(stats.teachers);

  const useBranches = branchBars.length >= 2;
  const data = useBranches ? branchBars : teacherBars;
  if (data.length < 2) return null;

  const source = useBranches ? stats.branches : stats.teachers;
  const omitted = source.filter((r) => r.pass_rate == null).length;
  const truncated = Math.max(0, source.length - omitted - data.length);

  return (
    <ChartCard
      title={useBranches ? "Pass rate by branch" : "Pass rate by teacher"}
      description={
        <>
          {monthLabel(stats.month)} · pooled — each bar is that group&rsquo;s passers over its
          rosters.
          {omitted > 0
            ? ` ${omitted} ${omitted === 1 ? "group has" : "groups have"} no roster this month and cannot be plotted.`
            : ""}
          {truncated > 0 ? ` Showing the top ${data.length}; ${truncated} more are in the table below.` : ""}
        </>
      }
    >
      <BarChart
        data={data}
        xKey="name"
        series={[{ key: "pass_rate", label: "Pass rate" }]}
        height={260}
        valueFormatter={(v) => `${v}%`}
        emptyMessage={{
          title: "Nothing to plot",
          description: "No group in this month has a pass rate.",
        }}
      />
    </ChartCard>
  );
}
