"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

// The certificate card's native size (matches the design template + the PDF).
const CARD_W = 760;
const CARD_H = 538;

/** "June 21, 2026" → "June 2026" (the midterm period shown in the description). */
function monthYearOf(dateStr: string): string {
  const m = /([A-Za-z]+)\s+\d{1,2},?\s+(\d{4})/.exec(dateStr || "");
  if (m) return `${m[1]} ${m[2]}`;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? dateStr : d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** The values swapped over the template's fixed placeholder text nodes. */
function injectData(c: CertData) {
  const subjectShort = /math/i.test(c.subject) ? "Math" : /read|engl/i.test(c.subject) ? "Reading" : (c.subject_label || "Math");
  return {
    score: String(c.score),
    ceiling: String(c.score_ceiling),
    subjectFull: c.subject_label || "Mathematics",
    subjectShort,
    name: c.student_name,
    monthYear: monthYearOf(c.date),
    rank: String(c.rank ?? ""),
    cohort: String(c.cohort_size ?? ""),
    instructor: c.teacher_name,
    dateIssued: c.date,
    certNo: c.number,
  };
}

/** Replace the template's placeholder text nodes with the student's data (same
 *  mapping the backend PDF renderer uses). */
function applyInjection(doc: Document, d: ReturnType<typeof injectData>): boolean {
  if (!doc.body || !/Aziz Karimov/.test(doc.body.innerText)) return false;
  const repl: Record<string, string> = {
    "740": d.score,
    "out of 800": "out of " + d.ceiling,
    "Mathematics": d.subjectFull,
    "Aziz Karimov": d.name,
    "for outstanding performance on the MasterSAT June 2026 ":
      "for outstanding performance on the MasterSAT " + d.monthYear + " ",
    "Math": d.subjectShort,
    "Class Rank #3": "Class Rank #" + d.rank,
    "of 24 students": "of " + d.cohort + " students",
    "Dr. Sarah Chen": d.instructor,
    "June 21, 2026": d.dateIssued,
    "NO. MS-2026-0417": "NO. " + d.certNo,
  };
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  for (const node of nodes) {
    const v = node.nodeValue ?? "";
    if (Object.prototype.hasOwnProperty.call(repl, v)) node.nodeValue = repl[v];
  }
  // Remove the subject-icon box (Σ / A) — hidden so the rail's text stays centered.
  const icon = [...doc.querySelectorAll<HTMLElement>("*")].find(
    (e) => e.children.length === 0 && e.textContent?.trim() === "∑",
  );
  if (icon) icon.style.visibility = "hidden";
  return true;
}

/**
 * Live certificate = the ready design template (public/certificates/{variant}.html)
 * shown in a same-origin iframe, with the student's data injected the moment the
 * template renders — so the entrance animation plays with the real values. Two
 * variants: ranked (classroom) → Class Rank chip; norank (standalone) → cert number.
 */
function IframeCertificate({ c }: { c: CertData }) {
  const variant = c.rank != null && c.cohort_size != null ? "ranked" : "norank";
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const data = useMemo(() => injectData(c), [c]);

  // Scale the fixed-size card down to fit narrow viewports (1:1 proportions).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setScale(Math.min(1, el.clientWidth / CARD_W));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Inject data as soon as the bundled template renders (poll fast so the swap
  // happens while the entrance animation is still running).
  useEffect(() => {
    const iframe = frameRef.current;
    if (!iframe) return;
    let done = false;
    let iv: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      let tries = 0;
      iv = setInterval(() => {
        const doc = iframe.contentDocument;
        if (done || tries++ > 120) { if (iv) clearInterval(iv); return; }
        try {
          if (doc && applyInjection(doc, data)) { done = true; if (iv) clearInterval(iv); }
        } catch { /* cross-origin shouldn't happen (same origin) */ }
      }, 50);
    };
    iframe.addEventListener("load", start);
    // In case it already loaded.
    if (iframe.contentDocument?.readyState === "complete") start();
    return () => { done = true; if (iv) clearInterval(iv); iframe.removeEventListener("load", start); };
  }, [data]);

  return (
    <div ref={wrapRef} style={{ width: "100%", maxWidth: CARD_W }}>
      <div style={{ height: CARD_H * scale, position: "relative", borderRadius: 6, overflow: "hidden", boxShadow: "0 12px 34px rgba(15,23,41,.16)" }}>
        <iframe
          ref={frameRef}
          src={`/certificates/${variant}.html`}
          title="Certificate"
          scrolling="no"
          style={{ width: CARD_W, height: CARD_H, border: 0, position: "absolute", top: 0, left: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}
        />
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
            <IframeCertificate c={cert} />
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
