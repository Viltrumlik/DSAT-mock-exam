"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
// The student photo keeps the shared Avatar: it falls back to initials when a photo URL is broken, which the
// console kit's Avatar does not do yet (the same choice as the people lists' peopleColumns).
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState, chipClass } from "@/features/console/ui";
import { cn } from "@/lib/cn";
import { Notice } from "./reportParts";
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
  // Graded if this class's sittings were judged — even when the midterm has since become a
  // pre-midterm, their verdicts stand.
  const graded = isGraded(midterm) || summary.pass_mark != null;
  // Out of what this class sat on; the midterm's own scale may have changed since.
  const ceiling = summary.score_ceiling ?? midterm.score_ceiling;
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
    retake.score_ceiling !== ceiling;

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
    <div className="flex flex-col gap-3">
      {/* What the numbers in this table are out of. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ms-fg-3">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="users" size="sm" className="size-3.5" />
          {summary.students} student{summary.students === 1 ? "" : "s"} on the roster
        </span>
        <span>
          Pass mark:{" "}
          <span className="font-medium text-ms-fg tabular-nums">
            {graded ? formatScore(summary.pass_mark, ceiling) : "not graded"}
          </span>
        </span>
        <span>
          Class average:{" "}
          <span className="font-medium text-ms-fg tabular-nums">
            {summary.average_score == null
              ? "no scores yet"
              : formatScore(summary.average_score, ceiling)}
          </span>
        </span>
        {retake && (
          <span>
            Retake: <span className="font-medium text-ms-fg">{retake.title}</span>
          </span>
        )}
      </div>

      {!graded && (
        <Notice icon="circle">
          This is a pre-midterm: it is scored but never pass/fail graded, so no student here can
          pass or fail it — and it is left out of every pass rate on the statistics page.
        </Notice>
      )}

      {mixedScales && (
        <Notice tone="attention">
          The midterm is scored out of {ceiling} and the retake out of{" "}
          {retake?.score_ceiling}. The two score columns are on different scales — compare each
          against its own pass mark, not against each other.
        </Notice>
      )}

      {summary.mixed_scales && (
        <Notice>
          Some students sat this midterm before its scale changed. Each row shows the score on the
          scale it was sat on; the class average converts them to {ceiling} points.
        </Notice>
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
                  chipClass(onlyFailed),
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ms-ring",
                )}
              >
                <Icon name="filter" size="sm" className="size-3.5" />
                Only students who failed ({failedCount})
              </button>
              {onlyFailed && (
                <span className="text-[13px] text-ms-fg-3">
                  Showing {visible.length} of {rows.length} students in this table.
                </span>
              )}
            </div>
          )}

          {nobodySat && !onlyFailed && (
            <Notice icon="minus">
              Nobody has sat this midterm yet — every student on the roster is marked absent, and
              every one of them counts as not passed.
            </Notice>
          )}

          {visible.length === 0 ? (
            <EmptyRow
              title="No failed students"
              body="Nobody in this classroom failed this midterm. Clear the filter to see everyone."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className={cn("w-full border-collapse text-[14px] text-ms-fg", retake ? "min-w-[620px]" : "min-w-[460px]")}>
                  <thead>
                    <tr className="border-b border-ms-border text-left text-[13px] font-medium text-ms-fg-3">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Student
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Midterm score
                        <span className="block text-[12px] font-normal">
                          out of {ceiling}
                        </span>
                      </th>
                      {retake && (
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Retake score
                          <span className="block text-[12px] font-normal">
                            out of {retakeCeilingLabel}
                          </span>
                        </th>
                      )}
                      <th scope="col" className="px-3 py-2 font-medium">
                        Outcome
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ms-line">
                    {visible.map((row, i) => {
                      const outcome = outcomes[i];
                      return (
                        <tr key={row.student_id} className="ms-transition align-middle hover:bg-ms-surface">
                          <th scope="row" className="py-2.5 pr-3 text-left font-semibold text-ms-fg">
                            <span className="flex items-center gap-2">
                              <Avatar
                                src={row.student_profile_image_url}
                                name={row.student_name}
                                size={24}
                              />
                              <span className="truncate">{row.student_name}</span>
                            </span>
                          </th>
                          <td className="px-3 py-2.5 text-right tabular-nums text-ms-fg-3">
                            {row.midterm_score == null ? (
                              <span className="text-[13px]">
                                {scoreText(null, midterm.score_ceiling, row.midterm_state)}
                              </span>
                            ) : (
                              <span className="text-ms-fg">
                                {formatScore(row.midterm_score, row.midterm_score_ceiling ?? midterm.score_ceiling)}
                              </span>
                            )}
                          </td>
                          {retake && (
                            <td className="px-3 py-2.5 text-right tabular-nums text-ms-fg-3">
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
                                  className="text-ms-fg"
                                  title={
                                    ambiguousRetakeScale && row.retake_score_ceiling == null
                                      ? AMBIGUOUS_SCORE_REASON
                                      : undefined
                                  }
                                >
                                  {formatScore(
                                    row.retake_score,
                                    // The sitting says its own scale; only without it is the
                                    // column's header a guess worth withholding.
                                    row.retake_score_ceiling ??
                                      (ambiguousRetakeScale ? null : retake.score_ceiling),
                                  )}
                                </span>
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2.5">
                            <StatusPill outcome={outcome} />
                            {outcome.detail && (
                              <span className="mt-0.5 block text-[12px] text-ms-fg-3">
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
  return <EmptyState icon="users" title={title} detail={body} />;
}
