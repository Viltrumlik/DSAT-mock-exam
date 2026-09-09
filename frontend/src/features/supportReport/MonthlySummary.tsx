"use client";

import type { ReactNode } from "react";

import {
  STATUS_LABEL,
  UNSETTLED_LABEL,
  attendanceReason,
  formatRate,
  formatShare,
  monthLabel,
  personName,
  plural,
  settledCount,
  teacherSubline,
} from "./format";
import {
  Column,
  DataTable,
  EmptyPanel,
  Note,
  Num,
  RateCell,
  RateFigure,
  SectionCard,
  StatTile,
} from "./ReportUI";
import type { MonthKey, MonthlyTeacherRow, SupportMonthlyReport, SupportStatus } from "./types";

/**
 * The monthly report: how many hours the desk ran, how many students came, and what state the
 * rest are in — the owner's second question, answered per support teacher and then for the
 * school.
 *
 * One row per teacher rather than one per session, because the question is about people's
 * months. **Pooled, never averaged**: the school row is the sum of the numerators over the sum
 * of the denominators, so a teacher who ran two sessions cannot move it as far as one who ran
 * forty. The one figure that is *not* summed is the headcount — a student who saw two support
 * teachers is one student helped, not two, and the backend counts distinct heads school-wide
 * for exactly that reason.
 */

/** The label for a status, preferring the backend's own vocabulary over ours. */
function label(report: SupportMonthlyReport, status: SupportStatus): string {
  return report.status_labels?.[status] || STATUS_LABEL[status];
}

/** The month in six numbers, before anyone reads a table. */
function Headline({ report }: { report: SupportMonthlyReport }) {
  const t = report.total;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <StatTile
        label="Attendance"
        value={
          <RateFigure
            rate={t.attendance_rate}
            reason={attendanceReason(t)}
            className="text-2xl font-extrabold"
          />
        }
        detail={`${formatShare(t.held, settledCount(t))} settled either way`}
      />
      <StatTile
        label="Sessions held"
        value={t.held}
        detail={`out of ${plural(t.bookings, "booking")}`}
      />
      <StatTile
        label="Students who came"
        value={t.students_helped}
        detail={
          t.students_booked !== t.students_helped
            ? `${plural(t.students_booked, "student")} booked`
            : "Counted once each"
        }
      />
      <StatTile
        label={label(report, "NO_SHOW")}
        value={t.no_show}
        detail="Took a seat and did not turn up"
      />
      <StatTile
        label={label(report, "CANCELLED")}
        value={t.cancelled}
        detail="Called off before the hour"
      />
      {/* Amber whenever it is not zero — the one tile here that is a call to action. */}
      <StatTile
        label={UNSETTLED_LABEL}
        value={t.unsettled}
        tone={t.unsettled > 0 ? "warning" : "default"}
        detail={
          t.unsettled > 0
            ? "This month's hours that paid nobody"
            : "Every past hour is settled"
        }
      />
    </div>
  );
}

/** The columns, shared by the teacher rows and by the school-wide total under them. */
function columns(report: SupportMonthlyReport): Column<MonthlyTeacherRow>[] {
  return [
    {
      key: "teacher",
      header: "Support teacher",
      cell: (row) => (
        <div className="min-w-0">
          {/* Wraps rather than truncates: Uzbek names run long, and a list of support
              teachers whose surnames are cut off is useless precisely when two of them
              share a first name. */}
          <span className="block font-semibold leading-snug text-foreground">
            {personName(row.support_teacher)}
          </span>
          <span className="block text-[11px] text-muted-foreground">{teacherSubline(row)}</span>
        </div>
      ),
    },
    {
      key: "rate",
      header: "Attendance",
      align: "right",
      className: "w-[220px]",
      cell: (row) => (
        <RateCell
          rate={row.attendance_rate}
          reason={attendanceReason(row)}
          detail={formatShare(row.held, settledCount(row))}
        />
      ),
    },
    {
      key: "held",
      header: "Held",
      align: "right",
      cell: (row) => (
        <Num
          value={row.held}
          className="font-bold"
          title="Sessions the teacher confirmed the student attended. The only outcome that pays points."
        />
      ),
    },
    {
      key: "students",
      header: "Students",
      align: "right",
      cell: (row) => (
        <Num
          value={row.students_helped}
          title={
            row.students_helped === row.held
              ? "Distinct students who attended."
              : `Distinct students who attended — ${plural(row.held, "session")} between them, so somebody came more than once.`
          }
        />
      ),
    },
    {
      key: "no_show",
      header: label(report, "NO_SHOW"),
      align: "right",
      cell: (row) => (
        <Num
          value={row.no_show}
          title="Settled as missed: the seat was taken and nobody turned up. It pays nothing."
        />
      ),
    },
    {
      key: "cancelled",
      header: label(report, "CANCELLED"),
      align: "right",
      cell: (row) => (
        <Num
          value={row.cancelled}
          title="Called off before the hour, so the seat went back to the calendar. Not in the attendance rate."
        />
      ),
    },
    {
      key: "unsettled",
      header: UNSETTLED_LABEL,
      align: "right",
      cell: (row) => (
        <Num
          value={row.unsettled}
          tone="warning"
          title={
            row.backlog_unsettled > row.unsettled
              ? `This month's unsettled hours. All time this teacher has ${row.backlog_unsettled}.`
              : "Past hours nobody marked. They paid nobody, and they are in none of the other figures on this row."
          }
        />
      ),
    },
  ];
}

export function MonthlySummary({
  report,
  monthPicker,
}: {
  report: SupportMonthlyReport;
  /** The month `<select>`, rendered in the card header where a reader looks for it. */
  monthPicker?: ReactNode;
}) {
  const rows = report.teachers;
  const total = report.total;
  const shown = monthLabel(report.month);

  /**
   * A month the desk genuinely held nothing in. Distinct from a failed request, which never
   * reaches this component — the page keeps those two apart on purpose.
   *
   * Note this is not `rows.length === 0`: every support teacher gets a row whether or not they
   * ran anything, so an honest row of zeros is the normal state of a quiet month and the
   * table is still worth showing. It is bookings that make a month a month.
   */
  const empty = total.bookings === 0 && total.slots_published === 0;

  const cols = columns(report);

  return (
    <div className="space-y-4">
      {empty ? null : <Headline report={report} />}

      <SectionCard
        title={shown ? `The desk in ${shown}` : "The desk this month"}
        description="Each support teacher's month, and the school pooled underneath. Attendance is the students who came over everyone settled either way — an hour nobody settled is in neither."
        actions={monthPicker}
      >
        {empty ? (
          <div className="p-5">
            <EmptyPanel
              title={`No support hours in ${shown || "this month"}`}
              body="Nobody published an hour and nobody booked one in this month. Pick another month above — the picker lists every month the desk has had hours on the calendar."
            />
          </div>
        ) : (
          <>
            <DataTable
              columns={cols}
              rows={rows}
              rowKey={(row) => row.support_teacher_id}
              minWidthClass="min-w-[900px]"
              footer={
                <tr className="bg-surface-2 align-middle">
                  <td className="px-3 py-3 pl-5 text-left">
                    <span className="font-bold text-foreground">The whole school</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {teacherSubline(total)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <RateCell
                      rate={total.attendance_rate}
                      reason={attendanceReason(total)}
                      detail={formatShare(total.held, settledCount(total))}
                    />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Num value={total.held} className="font-bold" />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Num
                      value={total.students_helped}
                      title="Distinct students school-wide. A student who saw two support teachers is one student, not two — this is not the sum of the column above."
                    />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Num value={total.no_show} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Num value={total.cancelled} />
                  </td>
                  <td className="px-3 py-3 pr-5 text-right">
                    <Num value={total.unsettled} tone="warning" />
                  </td>
                </tr>
              }
            />

            <div className="space-y-2 border-t border-border px-5 py-4">
              <Note>
                Attendance is {formatRate(total.attendance_rate)} for the school:{" "}
                {formatShare(total.held, settledCount(total))} settled either way, pooled across
                every teacher rather than averaged over them. Cancelled hours are in neither
                half — the seat went back to the calendar — and unsettled ones are in neither
                either, which is why clearing the backlog can move this number in both
                directions.
              </Note>
              <Note>
                The students column counts heads, not sessions: school-wide it is distinct
                students, so it is deliberately not the sum of the rows above it.
              </Note>
              {total.upcoming > 0 ? (
                <Note>
                  {plural(total.upcoming, "booking")} in this month{" "}
                  {total.upcoming === 1 ? "is" : "are"} still to come. Nothing is owed on{" "}
                  {total.upcoming === 1 ? "it" : "them"} yet, and{" "}
                  {total.upcoming === 1 ? "it is" : "they are"} in none of the figures above.
                </Note>
              ) : null}
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}

/** The month `<select>`'s options. Newest first, exactly as the backend ordered them. */
export function monthOptions(months: MonthKey[]) {
  return months.map((m) => (
    <option key={m} value={m}>
      {monthLabel(m)}
    </option>
  ));
}

export default MonthlySummary;
