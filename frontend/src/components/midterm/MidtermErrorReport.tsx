"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Download, Info } from "lucide-react";
import { downloadBlob } from "@/lib/download";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import SkillMistakeChart from "./SkillMistakeChart";
import { ErrorReportStyles } from "./errorReportStyles";
import { accuracyPercent } from "./chartGeometry";
import { errorReportApi, type ErrorReport } from "./errorReportApi";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="mer-tile rounded-2xl px-4 py-3.5">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.12em]" style={{ color: "var(--mer-text-muted)" }}>
        {label}
      </p>
      <p className="mt-1 text-[24px] font-extrabold leading-none" style={{ color: "var(--mer-text)" }}>
        {value}
      </p>
      {sub && (
        <p className="mt-1.5 text-[12px] font-semibold" style={{ color: "var(--mer-text-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/** Nothing to chart is two very different situations, and conflating them would mislead. */
function EmptyState({ report }: { report: ErrorReport }) {
  const unclassified = report.unclassified_total > 0;
  return (
    <div className="mer-tile mt-4 flex flex-col items-center gap-2 rounded-2xl px-6 py-10 text-center">
      {!unclassified && <CheckCircle2 className="h-8 w-8" style={{ color: "var(--mer-series)" }} />}
      <p className="text-[16px] font-extrabold" style={{ color: "var(--mer-text)" }}>
        {unclassified ? "No skill breakdown for this midterm" : "A clean paper"}
      </p>
      <p className="max-w-sm text-[13px] font-medium" style={{ color: "var(--mer-text-2)" }}>
        {unclassified
          ? "These questions have not been classified by skill yet, so your mistakes cannot be broken down. Ask your teacher to walk through the paper with you."
          : "You did not miss a single question, so there is nothing to plot here. Keep the same routine for the next one."}
      </p>
    </div>
  );
}

/**
 * The student-facing per-skill error report: the same payload the PDF is built from,
 * rendered under the certificate with its own download so the two can be taken away
 * independently.
 */
export default function MidtermErrorReport({ report }: { report: ErrorReport }) {
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const mistakes = Math.max(0, report.total_count - report.correct_count);
  const focus = report.skills.slice(0, 3);

  /** Print-to-PDF of this card alone; the print stylesheet hides everything around it. */
  function printReport() {
    cardRef.current?.querySelectorAll("details").forEach((d) => (d.open = true));
    window.print();
  }

  async function download() {
    setBusy(true);
    try {
      const blob = await errorReportApi.downloadPdf(report.attempt_id);
      downloadBlob(blob, `error-report-${report.attempt_id}.pdf`);
    } catch (e) {
      const err = normalizeApiError(e);
      // Not every deployment serves the rendered PDF yet. Falling back to the browser's own
      // print-to-PDF keeps the button from being a dead end.
      if (err.status === 404) printReport();
      else pushGlobalToast({ tone: "error", message: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section ref={cardRef} className="mer-card mt-6 rounded-3xl p-6 sm:p-8">
      <ErrorReportStyles />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-[12px] font-extrabold tracking-[0.16em]" style={{ color: "var(--mer-text-muted)" }}>
            ERROR REPORT
          </span>
          <h2 className="mt-2 text-[22px] font-extrabold leading-tight" style={{ color: "var(--mer-text)" }}>
            {report.midterm.title}
          </h2>
          <p className="mt-1 text-[13px] font-semibold" style={{ color: "var(--mer-text-2)" }}>
            {report.student_name} · {report.midterm.subject_label} · {report.date}
          </p>
        </div>
        <button
          onClick={download}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-60"
          style={{ background: "var(--mer-series)" }}
        >
          <Download className="h-4 w-4" /> {busy ? "…" : "Download report"}
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {report.is_graded && report.score != null && (
          <Tile
            label="Score"
            value={`${report.score}`}
            sub={report.pass_mark != null ? `Pass mark ${report.pass_mark}` : `of ${report.midterm.score_ceiling}`}
          />
        )}
        <Tile
          label="Correct"
          value={`${report.correct_count}/${report.total_count}`}
          sub={`${accuracyPercent(report.total_count, mistakes)}% accuracy`}
        />
        <Tile label="Mistakes" value={`${mistakes}`} />
        <Tile
          label="Weak skills"
          value={`${report.skills.length}`}
          sub={report.skills.length === 1 ? "skill to work on" : "skills to work on"}
        />
      </div>

      <div className="mt-8">
        <h3 className="text-[15px] font-extrabold" style={{ color: "var(--mer-text)" }}>
          Mistakes by skill
        </h3>
        <p className="mt-1 text-[13px] font-medium" style={{ color: "var(--mer-text-2)" }}>
          Only skills you actually missed questions on, ordered from most to least.
        </p>
        {report.skills.length === 0 ? <EmptyState report={report} /> : <div className="mt-5"><SkillMistakeChart skills={report.skills} /></div>}
      </div>

      {focus.length > 0 && (
        <div className="mt-8">
          <h3 className="text-[15px] font-extrabold" style={{ color: "var(--mer-text)" }}>
            Priority focus areas
          </h3>
          <ol className="mt-3 flex flex-col gap-2">
            {focus.map((s, i) => (
              <li key={`${s.skill_id ?? s.skill}`} className="mer-tile flex items-center gap-3 rounded-2xl px-4 py-3">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold text-white"
                  style={{ background: "var(--mer-series)" }}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold" style={{ color: "var(--mer-text)" }}>
                    {s.skill}
                  </span>
                  <span className="block truncate text-[12px] font-semibold" style={{ color: "var(--mer-text-muted)" }}>
                    {s.domain}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-extrabold tabular-nums" style={{ color: "var(--mer-text-2)" }}>
                  {s.wrong} of {s.total} missed
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {report.unclassified_wrong > 0 && (
        <p className="mt-6 flex items-start gap-2 text-[12px] font-semibold" style={{ color: "var(--mer-text-muted)" }}>
          <Info className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            {report.unclassified_wrong} of your {mistakes} mistakes came from questions that are not tagged to a skill
            yet, so they are not in the chart above.
          </span>
        </p>
      )}
    </section>
  );
}
