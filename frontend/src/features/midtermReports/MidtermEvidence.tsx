"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";
import { cn } from "@/lib/cn";
import { MidtermResultsTable } from "./MidtermResultsTable";
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
  /** How many retake papers this midterm has, when the caller knows. See the note below. */
  retakeCount,
}: {
  classroomId: number;
  midtermId: number;
  retakeCount?: number;
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
      <div className="space-y-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
    );
  }

  // An error is an error. Rendering it as "no students" would report an empty classroom.
  if (error || !report) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-start gap-3 rounded-xl border border-danger/25 bg-danger-soft p-3 text-sm text-danger-foreground"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 font-semibold">
          {error ?? "Could not load the per-student results for this paper."}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="ds-ring shrink-0 rounded-lg border border-danger/30 px-2.5 py-1 text-xs font-bold hover:bg-danger/10"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">
          Every student on the roster, as the record stood when they were scored. Nothing here
          re-grades anyone.
        </p>
        <button
          type="button"
          onClick={() => void exportPdf()}
          disabled={pdfBusy}
          className="ds-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          <Download className={cn("h-3.5 w-3.5", pdfBusy && "animate-pulse")} aria-hidden />
          {pdfBusy ? "Preparing…" : "Export PDF"}
        </button>
      </div>

      {pdfError && (
        <p
          role="alert"
          className="rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-xs font-semibold text-danger-foreground"
        >
          {pdfError}
        </p>
      )}

      {/* The report endpoint reads only the FIRST retake of a paper; the statistics count a
          pass on any of them. Say so rather than let the two surfaces disagree in silence. */}
      {retakeCount != null && retakeCount > 1 && (
        <p className="rounded-xl border border-warning/25 bg-warning-soft px-3 py-2 text-xs font-semibold text-warning-foreground">
          This paper has {retakeCount} retakes. The table below shows the first one only, while
          the pass rate above counts a student who passed any of them.
        </p>
      )}

      <MidtermResultsTable report={report} />
    </div>
  );
}
