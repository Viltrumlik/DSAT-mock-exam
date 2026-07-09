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

// Present the live certificate at true A4-landscape proportions (like the PDF) and render
// it large so it fills the view as a full sheet. The card's native ratio (≈1.413) is a hair
// off A4 landscape (≈1.414), so the non-uniform stretch to fill is imperceptible.
const A4_LANDSCAPE_RATIO = 297 / 210; // ≈ 1.4143
const MAX_DISPLAY_W = 1040;

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
  // Square off the card's corners so the on-screen certificate is full-bleed, matching the
  // PDF (the box that frames it is edge-to-edge, so no rounded gaps show at the corners).
  const card = [...doc.querySelectorAll<HTMLElement>("div")]
    .filter((e) => {
      const r = e.getBoundingClientRect();
      return /Aziz Karimov/.test(e.textContent ?? "") && r.width > 500 && r.width < 1100 &&
        getComputedStyle(e).borderTopLeftRadius !== "0px";
    })
    .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
  if (card) card.style.borderRadius = "0";
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
    "No. MS-2026-0417": "No. " + d.certNo, // node is "No." (CSS uppercases it on screen)
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
  const [boxW, setBoxW] = useState(MAX_DISPLAY_W);
  const data = useMemo(() => injectData(c), [c]);

  // Fill the available width (up to MAX_DISPLAY_W); the sheet keeps A4-landscape ratio.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setBoxW(el.clientWidth);
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

  // A4-landscape box; the native card is stretched to fill it edge-to-edge (full-bleed).
  const boxH = boxW / A4_LANDSCAPE_RATIO;
  return (
    <div ref={wrapRef} style={{ width: "100%", maxWidth: MAX_DISPLAY_W }}>
      <div style={{ width: boxW, height: boxH, position: "relative", overflow: "hidden", boxShadow: "0 18px 48px rgba(15,23,41,.18)" }}>
        <iframe
          ref={frameRef}
          src={`/certificates/${variant}.html`}
          title="Certificate"
          scrolling="no"
          style={{ width: CARD_W, height: CARD_H, border: 0, position: "absolute", top: 0, left: 0, transform: `scale(${boxW / CARD_W}, ${boxH / CARD_H})`, transformOrigin: "top left" }}
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
