"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Clock } from "lucide-react";
import { classesApi } from "@/lib/api";
import { midtermApi } from "@/lib/midtermApi";
import { downloadBlob } from "@/lib/download";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import MidtermErrorReport from "@/components/midterm/MidtermErrorReport";
import { errorReportApi } from "@/components/midterm/errorReportApi";

const C = { navy: "#0f1729", blue: "#2a68c0", slate: "#64748b", border: "#e7ebf3" };

export default function MidtermResultPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  const id = Number(attemptId);
  const { data, isLoading, error } = useQuery({
    queryKey: ["midterm", "review", id],
    queryFn: () => midtermApi.getReview(id),
    retry: 1,
  });
  // The breakdown is part of the released result, so it waits on the same gate the score does.
  const released = !!data?.released;
  const errorReport = useQuery({
    queryKey: ["midterm", "error-report", id],
    queryFn: () => errorReportApi.get(id),
    enabled: released,
    retry: 1,
  });
  const [busy, setBusy] = useState(false);

  async function download() {
    const code = data?.certificate?.code;
    if (!code) return;
    setBusy(true);
    window.open(`/certificate/${code}`, "_blank", "noopener");
    try {
      const blob = await classesApi.downloadCertificate(code);
      downloadBlob(blob, `certificate-${code}.pdf`);
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10" style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}>
      <Link href="/midterm" className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: C.slate }}>
        <ArrowLeft className="h-4 w-4" /> Back to midterms
      </Link>

      {isLoading ? (
        <p className="mt-8 text-sm text-slate-500">Loading your result…</p>
      ) : error || !data ? (
        <p className="mt-8 rounded-2xl border bg-white p-8 text-center text-sm text-slate-500" style={{ borderColor: C.border }}>
          Result not available yet.
        </p>
      ) : (
        <>
          <div className="mt-8 rounded-3xl border bg-white p-10 text-center" style={{ borderColor: C.border }}>
            <span className="text-[12px] font-extrabold tracking-[0.16em] text-slate-400">MIDTERM RESULT</span>
            {data.released ? (
              <>
                <div className="mt-6 flex items-end justify-center gap-1">
                  <span className="text-[64px] font-extrabold leading-none" style={{ color: C.navy }}>{data.total_score ?? "—"}</span>
                  <span className="mb-2 text-[20px] font-bold text-slate-400">/ {data.score_ceiling}</span>
                </div>
                {data.certificate?.rank != null && (
                  <p className="mt-3 text-sm font-semibold" style={{ color: C.slate }}>
                    Class rank {data.certificate.rank}{data.certificate.cohort_size ? ` of ${data.certificate.cohort_size}` : ""}
                  </p>
                )}
                {data.certificate?.available && (
                  <button
                    onClick={download}
                    disabled={busy}
                    className="mt-8 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                    style={{ background: C.blue }}
                  >
                    <Download className="h-4 w-4" /> {busy ? "…" : "Download certificate"}
                  </button>
                )}
              </>
            ) : (
              <div className="mt-8 flex flex-col items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <Clock className="h-7 w-7" />
                </div>
                <p className="text-[18px] font-extrabold" style={{ color: C.navy }}>Submitted</p>
                <p className="max-w-sm text-sm font-medium" style={{ color: C.slate }}>
                  Your answers are in. Your teacher will release the results and your certificate shortly.
                </p>
              </div>
            )}
          </div>

          {/* Stacked under the certificate, with its own download — the two are taken away separately. */}
          {released && errorReport.isLoading && (
            <p className="mt-6 text-sm text-slate-500">Loading your error report…</p>
          )}
          {released && errorReport.data && <MidtermErrorReport report={errorReport.data} />}
          {released && errorReport.isError && (
            <p className="mt-6 rounded-2xl border bg-white p-6 text-center text-sm text-slate-500" style={{ borderColor: C.border }}>
              Your error report is not available for this attempt.
            </p>
          )}
        </>
      )}
    </div>
  );
}
