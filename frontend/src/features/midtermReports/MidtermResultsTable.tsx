"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CircleDashed, Filter, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/cn";
import { OutcomeLegend, StatusPill } from "./StatusPill";
import {
  NOT_OFFERED,
  NOT_OFFERED_REASON,
  filterRows,
  formatScore,
  isFailed,
  isGraded,
  legendFor,
  outcomeFor,
  scoreText,
} from "./status";
import type { MidtermReport } from "./types";

/**
 * The per-student evidence behind a classroom's pass rate: one row per roster member.
 *
 * This table is what an admin who distrusts a percentage opens, so it is deliberately narrow:
 * the student, what they scored, what the retake changed, and ONE verdict. It used to carry
 * three verdict columns that printed the same word two or three times for most rows, a column
 * headed "Midterm" whose cells held a score, and an em dash that meant three different things
 * depending on which cell it was in. Each of those is gone rather than restyled.
 *
 * The "only failed" filter lives here, immediately above the rows it hides. It used to be a
 * page-level toggle that silently rewrote tables several screens further down.
 */
export function MidtermResultsTable({ report }: { report: MidtermReport }) {
  const { midterm, retake, summary, rows } = report;
  const graded = isGraded(midterm);
  const [onlyFailed, setOnlyFailed] = useState(false);

  const failedCount = useMemo(() => rows.filter(isFailed).length, [rows]);
  const visible = filterRows(rows, onlyFailed);
  const outcomes = useMemo(
    () => visible.map((row) => outcomeFor(row, graded)),
    [visible, graded],
  );
  const legend = useMemo(() => legendFor(outcomes), [outcomes]);

  // Every roster member is absent: the paper exists but the class has not sat it.
  const nobodySat = summary.students > 0 && summary.absent === summary.students;
  // 72 out of 100 and 640 out of 800 are not the same achievement. When the retake is scored
  // on a different ceiling from its parent, the two score columns must not be read across.
  const mixedScales =
    retake != null &&
    retake.score_ceiling != null &&
    retake.score_ceiling !== midterm.score_ceiling;

  /**
   * The ceilings the retake column's scores could be out of.
   *
   * A row's retake score is resolved across EVERY retake (`admin_report.resolve_retake`) but
   * the wire does not say which one produced it, and the column is headed by the oldest. With
   * two retakes scored out of different totals, printing "84 / 800" against the header's
   * ceiling invents a denominator: that 84 was out of 100. Now that `retakes[]` is on the
   * wire the ambiguity is at least VISIBLE, so the score is shown bare instead of under a
   * total it may not belong to.
   */
  const retakeCeilings = [
    ...new Set((report.retakes ?? []).map((r) => r.score_ceiling).filter((c) => c != null)),
  ];
  const ambiguousRetakeScale = retakeCeilings.length > 1;
  const retakeCeilingLabel = ambiguousRetakeScale
    ? retakeCeilings.join(" or ")
    : String(retake?.score_ceiling ?? "");
  const AMBIGUOUS_SCORE_REASON =
    "This paper has retakes scored out of different totals, and the record does not say which one this score came from — read it against that paper's own pass mark.";

  return (
    <div className="space-y-3">
      {/* What the numbers in this table are out of. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Users className="h-3.5 w-3.5" aria-hidden />
          {summary.students} student{summary.students === 1 ? "" : "s"} on the roster
        </span>
        <span className="font-semibold">
          Pass mark:{" "}
          <span className="text-foreground tabular-nums">
            {graded ? formatScore(summary.pass_mark, midterm.score_ceiling) : "not graded"}
          </span>
        </span>
        <span className="font-semibold">
          Class average:{" "}
          <span className="text-foreground tabular-nums">
            {summary.average_score == null
              ? "no scores yet"
              : formatScore(summary.average_score, midterm.score_ceiling)}
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
          This is a pre-midterm: it is scored but never pass/fail graded, so no student here can
          pass or fail it — and it is left out of every pass rate on the statistics page.
        </p>
      )}

      {mixedScales && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning-soft px-3 py-2 text-xs font-semibold text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          The midterm is scored out of {midterm.score_ceiling} and the retake out of{" "}
          {retake?.score_ceiling}. The two score columns are on different scales — compare each
          against its own pass mark, not against each other.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyRow
          title="No students on this roster"
          body="Nobody is enrolled in this classroom, so there is nothing to report."
        />
      ) : (
        <>
          {failedCount > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setOnlyFailed((v) => !v)}
                aria-pressed={onlyFailed}
                className={cn(
                  "ds-ring inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors",
                  onlyFailed
                    ? "border-danger/25 bg-danger-soft text-danger-foreground"
                    : "border-border bg-card text-foreground hover:bg-surface-2",
                )}
              >
                <Filter className="h-3.5 w-3.5" aria-hidden />
                Only students who failed ({failedCount})
              </button>
              {onlyFailed && (
                <span className="text-xs text-muted-foreground">
                  Showing {visible.length} of {rows.length} students in this table.
                </span>
              )}
            </div>
          )}

          {nobodySat && !onlyFailed && (
            <p className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs font-semibold text-muted-foreground">
              Nobody has sat this midterm yet — every student on the roster is marked absent, and
              every one of them counts as not passed.
            </p>
          )}

          {visible.length === 0 ? (
            <EmptyRow
              title="No failed students"
              body="Nobody in this classroom failed this midterm. Clear the filter to see everyone."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className={cn("w-full border-collapse text-sm", retake ? "min-w-[620px]" : "min-w-[460px]")}>
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="py-2 pr-3">
                        Student
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Midterm score
                        <span className="block font-semibold normal-case tracking-normal">
                          out of {midterm.score_ceiling}
                        </span>
                      </th>
                      {retake && (
                        <th scope="col" className="px-3 py-2 text-right">
                          Retake score
                          <span className="block font-semibold normal-case tracking-normal">
                            out of {retakeCeilingLabel}
                          </span>
                        </th>
                      )}
                      <th scope="col" className="px-3 py-2">
                        Outcome
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visible.map((row, i) => {
                      const outcome = outcomes[i];
                      return (
                        <tr key={row.student_id} className="align-middle">
                          <th scope="row" className="py-2.5 pr-3 text-left font-bold text-foreground">
                            <span className="flex items-center gap-2">
                              <Avatar
                                src={row.student_profile_image_url}
                                name={row.student_name}
                                size={24}
                              />
                              <span className="truncate">{row.student_name}</span>
                            </span>
                          </th>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                            {row.midterm_score == null ? (
                              <span className="text-[13px] not-italic">
                                {scoreText(null, midterm.score_ceiling, row.midterm_state)}
                              </span>
                            ) : (
                              <span className="text-foreground">
                                {formatScore(row.midterm_score, midterm.score_ceiling)}
                              </span>
                            )}
                          </td>
                          {retake && (
                            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                              {!row.retake_eligible ? (
                                <span className="text-[13px]" title={NOT_OFFERED_REASON}>
                                  {NOT_OFFERED}
                                </span>
                              ) : row.retake_score == null ? (
                                <span className="text-[13px]">
                                  {scoreText(null, retake.score_ceiling, row.retake_state)}
                                </span>
                              ) : (
                                <span
                                  className="text-foreground"
                                  title={ambiguousRetakeScale ? AMBIGUOUS_SCORE_REASON : undefined}
                                >
                                  {formatScore(
                                    row.retake_score,
                                    ambiguousRetakeScale ? null : retake.score_ceiling,
                                  )}
                                </span>
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2.5">
                            <StatusPill outcome={outcome} />
                            {outcome.detail && (
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                {outcome.detail}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <OutcomeLegend outcomes={legend} />
            </>
          )}
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
