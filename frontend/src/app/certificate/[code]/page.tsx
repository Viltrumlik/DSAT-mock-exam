"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { classesApi } from "@/lib/api";
import { downloadBlob } from "@/lib/download";
import AuthGuard from "@/components/AuthGuard";

interface CertData {
  code: string; number: string; student_name: string; midterm_title: string;
  subject: string; subject_label: string; score: number; score_ceiling: number;
  date: string; teacher_name: string;
  rank?: number | null; cohort_size?: number | null;
}

const FONT = "var(--font-plus-jakarta), 'Plus Jakarta Sans', system-ui, sans-serif";
const TRK = { letterSpacing: ".34em", textTransform: "uppercase" as const };
const TRK2 = { letterSpacing: ".2em", textTransform: "uppercase" as const };

/**
 * 1:1 port of the MasterSAT midterm certificate mockup — fixed 760×538 card,
 * rendered at native size and scaled to fit the viewport. Two variants:
 *   • classroom (rank present) → gold "Class Rank #N / of M students" chip
 *   • standalone (no rank)     → certificate number, no chip
 */
function Certificate({ c }: { c: CertData }) {
  const hasRank = c.rank != null && c.cohort_size != null;
  const glyph = c.subject === "MATH" ? "∑" : "A";

  return (
    <div
      style={{
        width: 760, height: 538, position: "relative", overflow: "hidden",
        boxShadow: "0 12px 34px rgba(15,23,41,.16)", borderRadius: 6,
        background: "#fff", display: "flex", fontFamily: FONT,
      }}
    >
      {/* ── Left blue rail ── */}
      <div
        style={{
          width: 150, flex: "none",
          background: "linear-gradient(180deg,#2a68c0,#173e7f)",
          position: "relative", overflow: "hidden", display: "flex",
          flexDirection: "column", alignItems: "center",
          justifyContent: "space-between", padding: "34px 0",
        }}
      >
        <div style={{ position: "absolute", top: 0, bottom: 0, width: 50, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent)" }} />
        <img src="/images/mastersat-cert-logo.png" alt="" style={{ height: 100, filter: "brightness(0) invert(1)" }} />
        <div style={{ ...TRK2, writingMode: "vertical-rl", transform: "rotate(180deg)", color: "rgba(255,255,255,.9)", fontSize: 18, fontWeight: 700 }}>
          MasterSAT Midterm
        </div>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: "rgba(255,255,255,.16)", border: "1px solid rgba(255,255,255,.3)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 22 }}>
          {glyph}
        </div>
      </div>

      {/* ── Right content ── */}
      <div style={{ flex: 1, padding: "40px 44px", display: "flex", flexDirection: "column", position: "relative" }}>
        <img src="/images/mastersat-shield-navy.png" alt="" style={{ position: "absolute", left: "52%", top: "50%", transform: "translate(-50%,-50%)", width: 420, opacity: 0.09, zIndex: 0, pointerEvents: "none" }} />

        {/* Header */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ ...TRK, fontSize: hasRank ? 20 : 10, color: "#2a68c0" }}>Certificate of Achievement</div>
          {!hasRank && <div style={{ ...TRK2, fontSize: 8.5, color: "#9aa3b2" }}>No. {c.number}</div>}
        </div>

        {/* Center cluster */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 34, flex: 1, marginTop: 6 }}>
          <div style={{ position: "relative", width: 174, height: 174, flex: "none" }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid #e4ecf7" }} />
            <div style={{ position: "absolute", inset: 11, borderRadius: "50%", background: "linear-gradient(135deg,#2a68c0,#173e7f)", boxShadow: "0 10px 24px rgba(42,104,192,.4)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 52, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{c.score}</div>
              <div style={{ ...TRK2, fontSize: 8.5, color: "rgba(255,255,255,.7)", marginTop: 3 }}>out of {c.score_ceiling}</div>
            </div>
            <div style={{ position: "absolute", left: "50%", bottom: -6, transform: "translateX(-50%)", background: "#0f1729", color: "#fff", fontSize: 10, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", padding: "5px 14px", borderRadius: 99, whiteSpace: "nowrap" }}>
              {c.subject_label}
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "#8a93a2" }}>Awarded to</div>
            <div style={{ fontSize: 34, fontWeight: 800, color: "#0f1729", letterSpacing: "-.02em", lineHeight: 1.05, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 360 }}>
              {c.student_name}
            </div>
            <div style={{ fontSize: 13.5, color: "#5b6473", marginTop: 12, lineHeight: 1.55 }}>
              for outstanding performance on the <b style={{ color: "#0f1729" }}>{c.midterm_title}</b>.
            </div>

            {hasRank && (
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#f4f8ff", border: "1px solid #d6e3f6", borderRadius: 12, padding: "9px 14px" }}>
                  <span style={{ color: "#e3a008", display: "flex" }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 4L12 4l3.5 5L21 5l-2 11H5zm0 3h14v2H5z" /></svg>
                  </span>
                  <div style={{ lineHeight: 1.1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#0f1729" }}>Class Rank #{c.rank}</div>
                    <div style={{ ...TRK2, fontSize: 7.5, color: "#9aa3b2", marginTop: 2 }}>of {c.cohort_size} students</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: hasRank ? 18 : 14, fontWeight: hasRank ? 800 : 700, color: "#0f1729" }}>{c.teacher_name}</div>
            <div style={{ ...TRK2, fontSize: 8, color: "#9aa3b2", marginTop: 2 }}>Instructor</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: hasRank ? 18 : 14, fontWeight: hasRank ? 800 : 700, color: "#0f1729" }}>{c.date}</div>
            <div style={{ ...TRK2, fontSize: 8, color: "#9aa3b2", marginTop: 2 }}>Date issued</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Scales the fixed 760×538 certificate down to fit narrow viewports, preserving 1:1 proportions. */
function ScaledCertificate({ c }: { c: CertData }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(Math.min(1, el.clientWidth / 760));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: "100%", maxWidth: 760 }}>
      <div style={{ height: 538 * scale, position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <Certificate c={c} />
        </div>
      </div>
    </div>
  );
}

export default function CertificatePage() {
  const params = useParams();
  const code = String(params?.code ?? "");
  const [cert, setCert] = useState<CertData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    classesApi.certificateDetail(code)
      .then((d) => { if (alive) setCert(d as CertData); })
      .catch(() => { if (alive) setError("This certificate is not available."); });
    return () => { alive = false; };
  }, [code]);

  async function downloadPdf() {
    setBusy(true);
    try {
      const blob = await classesApi.downloadCertificate(code);
      downloadBlob(blob, `certificate-${cert?.number ?? code}.pdf`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10" style={{ background: "#f0eee6", fontFamily: FONT }}>
        {error ? (
          <p className="rounded-xl bg-white px-6 py-4 text-sm font-medium text-slate-600 shadow">{error}</p>
        ) : !cert ? (
          <p className="text-sm text-slate-500">Loading certificate…</p>
        ) : (
          <>
            <ScaledCertificate c={cert} />
            <div className="flex gap-3 print:hidden">
              <button onClick={downloadPdf} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-[#2a68c0] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#21539e] disabled:opacity-60">
                <Download className="h-4 w-4" /> {busy ? "Preparing…" : "Download PDF"}
              </button>
              <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50">
                <Printer className="h-4 w-4" /> Print
              </button>
            </div>
          </>
        )}
      </div>
    </AuthGuard>
  );
}
