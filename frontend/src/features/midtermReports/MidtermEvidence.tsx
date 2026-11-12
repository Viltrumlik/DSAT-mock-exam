"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/features/console/ui";
import { MidtermResultsTable } from "./MidtermResultsTable";
import { Notice } from "./reportParts";
import { errText, midtermReportsApi } from "./api";
import type { MidtermReport } from "./types";

/**
 * The names behind one number: a classroom's roster against one paper.
 *
 * Lives here rather than in the statistics feature because it IS the existing admin report —
 * an admin who does not believe a pass rate has to be able to reach the students it was
 * computed from, and that path must land on the same table the console has always shown.
 *
 * Plain `useState` + axios, no React Query. The in-app browser pane reports
 * `visibilityState: "hidden"`, which pauses React Query's retries indefinitely and leaves a
 * failed fetch spinning forever; every ops surface fetches this way for that reason.
 */
export function MidtermEvidence({
  classroomId,
  midtermId,
  /**
   * How many retake papers this midterm has, from the caller's own payload. A fallback only:
   * this component's own response now carries `retakes[]`, which is the authority.
   */
  retakeCount,
}: {
  classroomId: number;
  midtermId: number;
  retakeCount?: number | null;
}) {
  const [report, setReport] = useState<MidtermReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await midtermReportsApi.midterm(classroomId, midtermId));
    } catch (e) {
      setReport(null);
      setError(errText(e, "Could not load the per-student results for this paper."));
    } finally {
      setLoading(false);
    }
  }, [classroomId, midtermId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportPdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      await midtermReportsApi.downloadPdf(classroomId, midtermId);
    } catch (e) {
      setPdfError(errText(e, "Could not generate the PDF."));
    } finally {
      setPdfBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-ms-shimmer h-9 rounded-ms-ctl" />
        ))}
      </div>
    );
  }

  // An error is an error. Rendering it as "no students" would report an empty classroom.
  if (error || !report) {
    return (
      <Notice
        tone="critical"
        role="alert"
        action={
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => void load()}>
            Try again
          </Button>
        }
      >
        <p className="font-semibold">{error ?? "Could not load the per-student results for this paper."}</p>
      </Notice>
    );
  }

  // This response is the authority on its own paper: the caller's count is a fallback for a
  // server too old to send the list. `?? 0` only after both have been asked — a caveat that
  // cannot count is not a caveat that counted one.
  const retakes = Array.isArray(report.retakes) ? report.retakes.length : (retakeCount ?? 0);
  // Two retakes scored out of different totals put two scales in one column. The table's own
  // mixed-scale warning compares the parent against the FIRST retake only, so it cannot see
  // this.
  const mixedRetakeScales =
    new Set((report.retakes ?? []).map((r) => r.score_ceiling)).size > 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 basis-[16rem] text-[13px] leading-[19px] text-ms-fg-2">
          Every student on the roster, as the record stood when they were scored. Nothing here
          re-grades anyone.
        </p>
        <Button
          variant="secondary"
          size="sm"
          icon="download"
          state={pdfBusy ? "busy" : "idle"}
          busyLabel="Preparing…"
          onClick={() => void exportPdf()}
        >
          Export PDF
        </Button>
      </div>

      {pdfError && (
        <Notice tone="critical" role="alert">
          {pdfError}
        </Notice>
      )}

      {/* ONE caveat now, and it states a fact rather than what it cannot rule out.
          `/reports/classrooms/<cid>/midterms/<mid>/` sends every retake, so this component
          counts them from its own response — the hedged version that used to run whenever the
          Records tab could not tell how many there were has nothing left to hedge about.

          What remains true with two or more: the rows below already resolve across ALL of them
          (`admin_report.resolve_retake` takes the first pass), but the column has one header
          and it names the oldest paper, ceiling included. So a cell can hold a score from a
          different paper than the one the column is titled after. */}
      {retakes > 1 ? (
        <Notice tone="attention">
          This paper has {retakes} retakes{report.retake ? `, headed below by ${report.retake.title}` : ""}.
          A student&rsquo;s retake score is whichever of the {retakes} decided their result, and
          the outcome counts a pass on any of them.
          {mixedRetakeScales
            ? " Those papers are not all scored out of the same total, so read a retake score against its own pass mark rather than against the column header."
            : ""}
        </Notice>
      ) : null}

      <MidtermResultsTable report={report} />
    </div>
  );
}
