"use client";

import { ChevronRight } from "lucide-react";
import {
  UNASSIGNED_BRANCH_NOTE,
  UNASSIGNED_TEACHER_NOTE,
  formatShare,
  isUnassigned,
  plural,
  rateReason,
} from "./format";
import { EmptyPanel, GapMarker, Num, RankedTable, RateCell, Rank } from "./StatsUI";
import type { RankedColumn } from "./StatsUI";
import type {
  BranchRow,
  ClassroomRow,
  DepartmentRow,
  GroupTally,
  TeacherRow,
} from "./types";

/**
 * The four ranked tables: branches, departments, teachers, classrooms.
 *
 * Every one is the same shape on purpose — rank, name, pass rate, and the counts the rate is
 * made of — because they are the same question asked at four altitudes, and the school reads
 * them side by side. The counts are never optional: a reader must always be able to see the
 * 9 of 10 behind the 90%, since 100% of two students and 90% of thirty are not comparable
 * facts however similar the percentages look.
 */

/** The columns every table shares: the rate, then the counts it was computed from. */
function tallyColumns<T extends GroupTally>(showPending: boolean): RankedColumn<T>[] {
  const columns: RankedColumn<T>[] = [
    {
      key: "rate",
      header: "Pass rate",
      align: "right",
      className: "w-[150px]",
      cell: (row) => (
        <RateCell
          rate={row.pass_rate}
          reason={rateReason("pass", row.roster)}
          detail={formatShare(row.passed, row.roster)}
        />
      ),
    },
    {
      key: "passed",
      header: "Passed",
      align: "right",
      cell: (row) => (
        <span title={`${row.passed_first} at the first sitting, ${row.passed_retake} on a retake`}>
          <Num value={row.passed} className="font-bold" />
        </span>
      ),
    },
    {
      key: "failed",
      header: "Failed",
      align: "right",
      cell: (row) => <Num value={row.failed} />,
    },
    {
      key: "absent",
      header: "Absent",
      align: "right",
      cell: (row) => (
        <span title="Absent counts as not passed: in the denominator, not the numerator.">
          <Num value={row.absent} />
        </span>
      ),
    },
  ];
  if (showPending) {
    columns.push({
      key: "pending",
      header: "Awaiting",
      align: "right",
      cell: (row) => (
        <span title="Still sitting, or sat and not yet given a verdict. Counted in the denominator, so the rate can only go up.">
          <Num value={row.pending} />
        </span>
      ),
    });
  }
  return columns;
}

const anyPending = (rows: GroupTally[]) => rows.some((r) => r.pending > 0);

function NameCell({
  name,
  sub,
  gap,
}: {
  name: string;
  sub?: string;
  gap?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-2 truncate font-bold text-foreground">
        {name}
        {gap ? <GapMarker note={gap} /> : null}
      </p>
      {sub ? <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function BranchTable({ rows }: { rows: BranchRow[] }) {
  const columns: RankedColumn<BranchRow>[] = [
    { key: "rank", header: "#", className: "w-10", cell: (_r, i) => <Rank index={i} /> },
    {
      key: "name",
      header: "Branch",
      cell: (row) => (
        <NameCell
          name={row.name}
          sub={`${plural(row.classrooms, "class", "classes")} · ${plural(row.distinct_students, "student")}`}
          gap={isUnassigned(row) ? UNASSIGNED_BRANCH_NOTE : undefined}
        />
      ),
    },
    ...tallyColumns<BranchRow>(anyPending(rows)),
  ];
  return (
    <RankedTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id ?? "unassigned"}
      empty={
        <EmptyPanel
          title="No branches to rank"
          body="No classroom sat a midterm this month, so there is nothing to group by branch."
        />
      }
    />
  );
}

export function DepartmentTable({ rows }: { rows: DepartmentRow[] }) {
  const columns: RankedColumn<DepartmentRow>[] = [
    { key: "rank", header: "#", className: "w-10", cell: (_r, i) => <Rank index={i} /> },
    {
      key: "name",
      header: "Department",
      cell: (row) => (
        <NameCell
          name={row.label}
          sub={`${plural(row.classrooms, "class", "classes")} · ${plural(row.distinct_students, "student")}`}
        />
      ),
    },
    ...tallyColumns<DepartmentRow>(anyPending(rows)),
  ];
  return (
    <RankedTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.subject}
      empty={
        <EmptyPanel
          title="No departments to rank"
          body="No classroom sat a midterm this month, so neither department has a figure."
        />
      }
    />
  );
}

export function TeacherTable({ rows }: { rows: TeacherRow[] }) {
  const columns: RankedColumn<TeacherRow>[] = [
    { key: "rank", header: "#", className: "w-10", cell: (_r, i) => <Rank index={i} /> },
    {
      key: "name",
      header: "Teacher",
      cell: (row) => (
        <NameCell
          name={row.name}
          sub={
            [row.subject_label, row.branch].filter(Boolean).join(" · ") ||
            plural(row.classrooms, "class", "classes")
          }
          gap={isUnassigned(row) ? UNASSIGNED_TEACHER_NOTE : undefined}
        />
      ),
    },
    ...tallyColumns<TeacherRow>(anyPending(rows)),
    {
      key: "classes",
      header: "Classes",
      align: "right",
      cell: (row) => <Num value={row.classrooms} />,
    },
  ];
  return (
    <RankedTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id ?? "unassigned"}
      minWidthClass="min-w-[780px]"
      empty={
        <EmptyPanel
          title="No teachers to rank"
          body="No classroom sat a midterm this month, so no teacher has a figure for it."
        />
      }
    />
  );
}

export function ClassroomTable({
  rows,
  onSelect,
}: {
  rows: ClassroomRow[];
  onSelect: (row: ClassroomRow) => void;
}) {
  const columns: RankedColumn<ClassroomRow>[] = [
    { key: "rank", header: "#", className: "w-10", cell: (_r, i) => <Rank index={i} /> },
    {
      key: "name",
      header: "Class",
      cell: (row) => (
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
      ),
    },
    ...tallyColumns<ClassroomRow>(anyPending(rows)),
    {
      key: "papers",
      header: "Papers",
      align: "right",
      cell: (row) => (
        <span title="Countable midterms this class sat in this month. Pre-midterms and retake papers are not counted separately.">
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
      minWidthClass="min-w-[820px]"
      empty={
        <EmptyPanel
          title="No classes sat a midterm this month"
          body="Pick another month above. A class appears here in the month its paper was timetabled for, or — when it was never timetabled — the month somebody first sat it."
        />
      }
    />
  );
}
