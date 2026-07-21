"use client";

import { CircleDashed, Users } from "lucide-react";
import { StatusPill } from "./StatusPill";
import { filterRows, finalPill, formatScore, isGraded, sittingPill } from "./status";
import type { MidtermReport } from "./types";

/** A cell with nothing to say — a student who never had a retake to sit, or an unsat paper. */
function Blank({ reason }: { reason: string }) {
  return (
    <span className="text-muted-foreground" title={reason}>
      —<span className="sr-only"> {reason}</span>
    </span>
  );
}

export function MidtermResultsTable({
  report,
  onlyFailed,
}: {
  report: MidtermReport;
  onlyFailed: boolean;
}) {
  const { midterm, retake, summary, rows } = report;
  const graded = isGraded(midterm);
  const visible = filterRows(rows, onlyFailed);
  // Every roster member is absent: the paper exists but the class has not sat it.
  const nobodySat = summary.students > 0 && summary.absent === summary.students;

  return (
    <div className="space-y-3">
      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Users className="h-3.5 w-3.5" aria-hidden />
          {summary.students} student{summary.students === 1 ? "" : "s"}
        </span>
        <span className="font-semibold">
          Pass mark:{" "}
          {graded ? (
            <span className="text-foreground tabular-nums">{summary.pass_mark}</span>
          ) : (
            <span className="text-foreground">not graded</span>
          )}
        </span>
        <span className="font-semibold">
          Class average:{" "}
          <span className="text-foreground tabular-nums">
            {summary.average_score ?? "—"}
          </span>
        </span>
        {retake && (
          <span className="font-semibold">
            Retake: <span className="text-foreground">{retake.title}</span>
          </span>
        )}
      </div>

      {!graded && (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs font-semibold text-muted-foreground">
          <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          This is a pre-midterm: it is scored but never pass/fail graded, so no student here
          can pass or fail it.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyRow
          title="No students on this roster"
          body="Nobody is enrolled in this classroom, so there is nothing to report."
        />
      ) : visible.length === 0 ? (
        <EmptyRow
          title={onlyFailed ? "No failed students" : "Nothing to show"}
          body={
            onlyFailed
              ? "Nobody in this classroom failed this midterm. Clear the filter to see everyone."
              : "This midterm has no rows to display."
          }
        />
      ) : (
        <>
          {nobodySat && !onlyFailed && (
            <p className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs font-semibold text-muted-foreground">
              Nobody has sat this midterm yet — every student on the roster is marked absent.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-3">Student</th>
                  <th scope="col" className="px-3 py-2">Midterm</th>
                  <th scope="col" className="px-3 py-2">Result</th>
                  <th scope="col" className="px-3 py-2">Retake</th>
                  <th scope="col" className="px-3 py-2">Retake result</th>
                  <th scope="col" className="px-3 py-2">Final</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((row) => (
                  <tr key={row.student_id} className="align-middle">
                    <th
                      scope="row"
                      className="py-2.5 pr-3 text-left font-bold text-foreground"
                    >
                      {row.student_name}
                    </th>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                      {row.midterm_score == null ? (
                        <Blank reason="no score recorded" />
                      ) : (
                        formatScore(row.midterm_score, midterm.score_ceiling)
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill
                        pill={sittingPill(graded, row.midterm_passed, row.midterm_state)}
                      />
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                      {!row.retake_eligible ? (
                        <Blank
                          reason={
                            retake
                              ? "not eligible — only students who failed sit the retake"
                              : "no retake exists for this midterm"
                          }
                        />
                      ) : row.retake_score == null ? (
                        <Blank reason="no score recorded" />
                      ) : (
                        formatScore(row.retake_score, retake?.score_ceiling)
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {row.retake_eligible ? (
                        <StatusPill
                          pill={sittingPill(
                            retake ? isGraded(retake) : false,
                            row.retake_passed,
                            row.retake_state,
                          )}
                        />
                      ) : (
                        <Blank
                          reason={
                            retake
                              ? "not eligible — only students who failed sit the retake"
                              : "no retake exists for this midterm"
                          }
                        />
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill pill={finalPill(row, graded)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
