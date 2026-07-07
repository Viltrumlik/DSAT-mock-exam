"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { classesApi } from "@/lib/api";
import { downloadBlob } from "@/lib/download";
import AuthGuard from "@/components/AuthGuard";

interface CertData {
  code: string; number: string; student_name: string; midterm_title: string;
  subject: string; subject_label: string; score: number; score_ceiling: number;
  date: string; teacher_name: string;
}

const FONT = "var(--font-plus-jakarta), system-ui, sans-serif";

/** The MasterSAT sigma mark (Math) as a clean stroke, matching the certificate mockup. */
function SigmaMark() {
  return (
    <svg viewBox="0 0 40 40" width="22" height="22" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="28,29 12,29 20,20 12,11 28,11" />
    </svg>
  );
}

function Certificate({ c }: { c: CertData }) {
  return (
    <div
      style={{ fontFamily: FONT }}
      className="relative flex aspect-[1.46/1] w-full max-w-[1000px] overflow-hidden rounded-[18px] bg-white shadow-[0_18px_50px_rgba(15,23,41,0.18)]"
    >
      {/* Left blue band */}
      <div className="relative flex w-[14%] min-w-[110px] flex-col items-center justify-between py-6" style={{ background: "linear-gradient(165deg,#2a68c0,#173e7f)" }}>
        <img src="/images/mastersat-shield-white.png" alt="" className="w-[46%] max-w-[52px]" />
        <div className="flex-1 flex items-center justify-center">
          <span
            className="whitespace-nowrap text-[11px] font-bold tracking-[0.32em]"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", color: "#dbe6f7" }}
          >
            MASTERSAT MIDTERM
          </span>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-[12px]" style={{ background: "#5b8ed4" }}>
          {c.subject === "MATH" ? <SigmaMark /> : <span className="text-lg font-extrabold text-white">A</span>}
        </div>
      </div>

      {/* Main area — three blocks distributed vertically (robust at any card height). */}
      <div className="relative flex flex-1 flex-col justify-between px-[5%] py-[4.5%]">
        {/* Watermark */}
        <img src="/images/mastersat-shield-navy.png" alt="" className="pointer-events-none absolute right-[8%] top-1/2 w-[38%] -translate-y-1/2 opacity-[0.06]" />

        {/* Header */}
        <div className="relative flex items-start justify-between">
          <span className="text-[clamp(9px,1.1vw,13px)] font-extrabold tracking-[0.18em]" style={{ color: "#2a68c0" }}>CERTIFICATE OF ACHIEVEMENT</span>
          <span className="text-[clamp(9px,1vw,12px)] font-medium tracking-wide" style={{ color: "#8a93a2" }}>NO. {c.number}</span>
        </div>

        {/* Center cluster */}
        <div className="relative flex items-center gap-[5%]">
          <div className="flex shrink-0 flex-col items-center">
            <div
              className="flex aspect-square w-[clamp(88px,12vw,140px)] flex-col items-center justify-center rounded-full text-white"
              style={{ background: "linear-gradient(135deg,#2a68c0,#173e7f)" }}
            >
              <span className="text-[clamp(28px,4.8vw,50px)] font-extrabold leading-none">{c.score}</span>
              <span className="mt-1 text-[clamp(7px,0.8vw,10px)] font-bold tracking-[0.18em] text-[#cdddf5]">OUT OF {c.score_ceiling}</span>
            </div>
            <span className="mt-3 rounded-full px-4 py-1.5 text-[clamp(8px,0.85vw,10px)] font-bold tracking-[0.16em] text-white" style={{ background: "#0f1729" }}>
              {c.subject_label}
            </span>
          </div>

          <div className="min-w-0">
            <p className="text-[clamp(11px,1.4vw,16px)]" style={{ color: "#8a93a2" }}>Awarded to</p>
            <h1 className="mt-1 truncate text-[clamp(22px,3.8vw,40px)] font-extrabold tracking-[-0.02em]" style={{ color: "#0f1729" }}>{c.student_name}</h1>
            <p className="mt-2 text-[clamp(10px,1.25vw,15px)] leading-snug" style={{ color: "#5b6473" }}>
              for outstanding performance on the {c.midterm_title}.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="relative flex items-end justify-between">
          <div>
            <p className="text-[clamp(11px,1.3vw,15px)] font-bold" style={{ color: "#0f1729" }}>{c.teacher_name}</p>
            <p className="text-[clamp(8px,0.9vw,10px)] font-medium tracking-[0.16em]" style={{ color: "#8a93a2" }}>INSTRUCTOR</p>
          </div>
          <div className="text-right">
            <p className="text-[clamp(11px,1.3vw,15px)] font-bold" style={{ color: "#0f1729" }}>{c.date}</p>
            <p className="text-[clamp(8px,0.9vw,10px)] font-medium tracking-[0.16em]" style={{ color: "#8a93a2" }}>DATE ISSUED</p>
          </div>
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
            <Certificate c={cert} />
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
