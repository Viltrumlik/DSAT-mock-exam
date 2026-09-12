"use client";

import { ChevronRight } from "lucide-react";
import { formatShare, rateReason, rosterNote } from "./format";
import { OUTCOME } from "./outcome";
import { SplitBar } from "./SplitBar";
import { EmptyPanel, Note, Num, RankedTable, RateCell } from "./StatsUI";
import type { RankedColumn } from "./StatsUI";
import type { ClassroomRow, GroupTally } from "./types";

/**
 * The column kit every ranked row on this page shares, and the one table that is not ranked.
 *
 * This file used to hold four flat sibling tables — Branches, Departments, Teachers, Classes
 * — drawn one under another with no relationship between them. That was the complexity the
 * owner asked us to remove; the drill-down in `HierarchyPanel` replaces all four, and takes
 * these columns with it so a row reads the same at every altitude.
 *
 * The counts are never optional: a reader must always be able to see the 9 of 10 behind the
 * 90%, since 100% of two students and 90% of thirty are not comparable facts however similar
 * the percentages look.
 */

/** The columns every ranked row shares: the rate, then the counts it was computed from. */
export function tallyColumns<T extends GroupTally>(showPending: boolean): RankedColumn<T>[] {
  const columns: RankedColumn<T>[] = [
    {
      key: "split",
      header: "How the month went",
      // Wide enough for a bar that can be read. The ops tables were leaving ~240px of dead
      // space between the name block and this column; the bar spends it.
      className: "w-[220px]",
      cell: (row) => (
        <SplitBar
          tally={row}
          height="h-2.5"
          // Not a second copy of the pass rate: the same width, divided by what actually
          // happened to the people who did not pass.
        />
      ),
    },
    {
      key: "rate",
      header: "Pass rate",
      align: "right",
      className: "w-[120px]",
      cell: (row) => (
        <RateCell
          rate={row.pass_rate}
          reason={rateReason("pass", row.roster)}
          detail={formatShare(row.passed, row.roster)}
          // The bar for this row is the split one, two columns to the left.
          bar={false}
          // "150 of 210" beside "180 students" is two denominators on one row. Say why.
          title={rosterNote(row.roster, row.distinct_students) ?? undefined}
        />
      ),
    },
    {
      key: "passed",
      header: "Passed",
      align: "right",
      cell: (row) => (
        <span title={`${row.passed_first} passed first time, ${row.passed_retake} after a retake`}>
          <Num value={row.passed} className={`font-bold ${OUTCOME.passed.text}`} />
        </span>
      ),
    },
    {
      key: "failed",
      header: "Failed",
      align: "right",
      cell: (row) => <Num value={row.failed} className={row.failed > 0 ? OUTCOME.failed.text : undefined} />,
    },
    {
      key: "absent",
      header: "Did not come",
      align: "right",
      cell: (row) => (
        <span title="Not coming counts the same as not passing.">
          <Num value={row.absent} className={row.absent > 0 ? OUTCOME.absent.text : undefined} />
        </span>
      ),
    },
  ];
  if (showPending) {
    columns.push({
      key: "pending",
      header: "Waiting",
      align: "right",
      cell: (row) => (
        <span title="Still sitting the exam, or sat it and not yet marked. The rate can only go up as these land.">
          <Num value={row.pending} />
        </span>
      ),
    });
  }
  return columns;
}

export const anyPending = (rows: readonly GroupTally[]) => rows.some((r) => r.pending > 0);

/**
 * The note under a table whose rows show two different denominators.
 *
 * Not a caveat about accuracy — both numbers are right — but about which one the rate is
 * over. `ClassroomMonthPanel` already explains exactly this on the drill-down; the ranked
 * table above it said nothing, so a reader who noticed "12 classes · 180 students" beside
 * "150 of 210" had no way to tell which figure to distrust. Rendered only when at least one
 * row actually disagrees with itself.
 */
export function DenominatorNote({ rows }: { rows: readonly GroupTally[] }) {
  const split = rows.some((r) => r.roster !== r.distinct_students);
  if (!split) return null;
  return (
    <div className="border-t border-border px-5 py-3">
      <Note>
        Some of these students sat more than one exam this month, and each exam counts. So a
        rate here is over the{" "}
        <strong className="font-bold">exams expected</strong> — the number beside the row&rsquo;s
        name — and not over the number of people.
      </Note>
    </div>
  );
}

/** The class's name and where it sits, as the button that opens its month. */
function ClassroomNameButton({
  row,
  onSelect,
}: {
  row: ClassroomRow;
  onSelect: (row: ClassroomRow) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      className="ds-ring group -mx-1 flex w-full min-w-0 items-center gap-2 rounded-lg px-1 py-0.5 text-left"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2 truncate font-bold text-foreground group-hover:text-primary">
          {row.name}
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary"
            aria-hidden
          />
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
          {[
            row.level_label,
            row.subject_label,
            row.teacher?.name ?? "No teacher assigned",
            row.branch?.name ?? "No branch set",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span className="sr-only">Open this class&rsquo;s month in detail</span>
    </button>
  );
}

/**
 * What a scheduled month has instead of a drill-down: who is booked, and for how many papers.
 *
 * Flat and unranked on purpose. Rank, pass rate, passed, failed and absent are all answers to
 * a question nobody has asked yet — a table ordered "best first" over a month nobody has sat
 * is a league table of a plan, and the order alone would be read as a finding. The hierarchy
 * is not drawn here for the same reason: there is nothing yet to compare a branch to a branch
 * on, so the one useful fact is simply which classes are booked.
 */
export function ScheduledClassroomTable({
  rows,
  onSelect,
}: {
  rows: ClassroomRow[];
  onSelect: (row: ClassroomRow) => void;
}) {
  const columns: RankedColumn<ClassroomRow>[] = [
    {
      key: "name",
      header: "Class",
      cell: (row) => <ClassroomNameButton row={row} onSelect={onSelect} />,
    },
    {
      key: "students",
      header: "Students",
      align: "right",
      cell: (row) => <Num value={row.distinct_students} />,
    },
    {
      key: "papers",
      header: "Papers booked",
      align: "right",
      cell: (row) => (
        <span title="Countable midterms timetabled for this class in this month. None has been sat.">
          <Num value={row.midterms} />
        </span>
      ),
    },
  ];
  return (
    <RankedTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      minWidthClass="min-w-[520px]"
      empty={
        <EmptyPanel
          title="Nothing is booked in this month"
          body="No class has a countable paper timetabled here. A paper appears in the month it was timetabled for."
        />
      }
    />
  );
}
