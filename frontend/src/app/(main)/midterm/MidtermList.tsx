"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, ArrowRight, Download, Lock } from "lucide-react";
import { classesApi } from "@/lib/api";
import { downloadBlob } from "@/lib/download";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { useMyMidterms, type MyMidterm } from "@/features/classroom/hooks";
import { classroomKeys } from "@/features/classroom/queryKeys";

/**
 * Student midterm page — matches the MasterSAT "Midterm" mockup 1:1 (filter tabs +
 * timeline sections). Schedule-aware states: Available (Enter) · Scheduled (countdown) ·
 * Past (score + certificate once released).
 */

const C = { navy: "#0f1729", blue: "#2a68c0", blueHover: "#21539e", slate: "#64748b", border: "#e7ebf3" };

function useCountdown(targetIso: string | null) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    if (!targetIso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [targetIso]);
  if (!targetIso || now === 0) return { done: !targetIso, label: "" };
  const ms = new Date(targetIso).getTime() - now;
  if (ms <= 0) return { done: true, label: "" };
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return { done: false, label: d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s` };
}

const fmtDuration = (min: number) => (!min ? null : min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);
const scaleMax = (s: string) => (s === "SCALE_800" ? 800 : 100);

function Badge({ text, bg, color }: { text: string; bg: string; color: string }) {
  return <span className="rounded-md px-2.5 py-0.5 text-[11px] font-bold" style={{ background: bg, color }}>{text}</span>;
}

function Row({ m, kind, onUnlock }: { m: MyMidterm; kind: "available" | "scheduled" | "past"; onUnlock: () => void }) {
  const router = useRouter();
  const cd = useCountdown(kind === "scheduled" ? m.available_at : null);
  const [busy, setBusy] = useState(false);
  const unlocked = kind === "scheduled" && cd.done;
  // Fire the unlock refetch at most once per row. `onUnlock` is recreated every
  // render, so without this latch a scheduled midterm that stays in the bucket
  // (closed/undated window) would refetch → re-render → refetch in a tight loop.
  const unlockFiredRef = useRef(false);
  useEffect(() => {
    if (unlocked && !unlockFiredRef.current) {
      unlockFiredRef.current = true;
      onUnlock();
    }
  }, [unlocked, onUnlock]);

  const meta = [fmtDuration(m.duration_minutes), m.question_count ? `${m.question_count} questions` : null, m.subject_label]
    .filter(Boolean).join(" · ");

  const dot = kind === "available" ? C.blue : kind === "past" ? "#0b7a4f" : "#94a3b8";
  const enter = () => router.push(`/mock/${m.mock_exam_id}?midterm=1`);

  async function download() {
    if (!m.certificate.code) return;
    setBusy(true);
    window.open(`/certificate/${m.certificate.code}`, "_blank", "noopener");
    try {
      const blob = await classesApi.downloadCertificate(m.certificate.code);
      downloadBlob(blob, `certificate-${m.certificate.code}.pdf`);
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative pl-7">
      <span className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 bg-white" style={{ borderColor: dot }} />
      <div className="flex items-center gap-4 rounded-2xl border bg-white px-5 py-4" style={{ borderColor: C.border }}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><FileText className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[16px] font-extrabold" style={{ color: C.navy }}>{m.title}</p>
            {kind === "available" && <Badge text="Available" bg="#e7effb" color="#21539e" />}
            {kind === "scheduled" && !unlocked && <Badge text="Scheduled" bg="#f1f5f9" color={C.slate} />}
            {kind === "past" && <Badge text="Completed" bg="#dcf2e3" color="#0b7a4f" />}
          </div>
          <p className="mt-0.5 text-[13px] font-semibold" style={{ color: C.slate }}>{meta}</p>
        </div>

        {/* Right action */}
        {kind === "available" || unlocked ? (
          <button onClick={enter} className="inline-flex shrink-0 items-center gap-2 rounded-xl px-[18px] py-[11px] text-sm font-bold text-white transition hover:opacity-90" style={{ background: C.blue }}>
            {m.has_attempt ? "Resume timed mock" : "Enter timed mock"} <ArrowRight className="h-4 w-4" />
          </button>
        ) : kind === "scheduled" ? (
          <div className="shrink-0 text-right">
            <span className="inline-flex items-center gap-1.5 rounded-xl border px-[18px] py-[11px] text-sm font-semibold" style={{ borderColor: C.border, color: "#94a3b8" }}>
              <Lock className="h-3.5 w-3.5" /> {m.available_at ? `Opens ${new Date(m.available_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "Scheduled"}
            </span>
            {cd.label && <p className="mt-1 text-[11px] font-semibold" style={{ color: C.slate }}>starts in {cd.label}</p>}
          </div>
        ) : m.results_visible ? (
          <div className="flex shrink-0 items-center gap-4">
            <div className="text-right leading-none">
              <span className="text-[20px] font-extrabold" style={{ color: C.navy }}>{m.score ?? "—"}</span>
              <span className="text-[12px] font-semibold text-slate-400"> /{scaleMax(m.scoring_scale)}</span>
            </div>
            {m.certificate.available && (
              <button onClick={download} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition hover:bg-slate-50 disabled:opacity-60" style={{ borderColor: C.border, color: C.navy }}>
                <Download className="h-4 w-4" /> {busy ? "…" : "Download"}
              </button>
            )}
          </div>
        ) : (
          <span className="shrink-0 rounded-xl border px-[18px] py-[11px] text-sm font-semibold" style={{ borderColor: C.border, color: "#94a3b8" }}>Awaiting results</span>
        )}
      </div>
    </div>
  );
}

function Section({ title, count, dot, children }: { title: string; count: number; dot: string; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
        <h2 className="text-[14px] font-bold" style={{ color: C.slate }}>{title}</h2>
        <span className="text-[13px] font-semibold text-slate-400">{count}</span>
      </div>
      <div className="relative space-y-3">
        <span className="absolute left-[5px] top-4 bottom-4 w-px bg-slate-200" />
        {children}
      </div>
    </section>
  );
}

type Tab = "all" | "available" | "scheduled" | "past";

export default function MidtermList() {
  const { data, isLoading } = useMyMidterms();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("all");
  const refetch = () => qc.invalidateQueries({ queryKey: classroomKeys.myMidterms() });

  const midterms = useMemo(() => data?.midterms ?? [], [data]);
  const available = midterms.filter((m) => m.is_open && !m.submitted);
  const scheduled = midterms.filter((m) => !m.is_open && !m.submitted);
  const past = midterms.filter((m) => m.submitted);

  const tabs: { id: Tab; label: string }[] = [
    { id: "all", label: "All" }, { id: "available", label: "Available now" },
    { id: "scheduled", label: "Scheduled" }, { id: "past", label: "Past" },
  ];
  const show = (t: Tab) => tab === "all" || tab === t;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8" style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}>
      <span className="text-[12px] font-extrabold tracking-[0.16em] text-slate-400">MIDTERM</span>
      <h1 className="mt-1 text-[34px] font-extrabold leading-tight" style={{ color: C.navy }}>Midterm</h1>

      <div className="mt-5 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="rounded-[11px] border px-[17px] py-[10px] text-sm font-semibold transition"
            style={tab === t.id
              ? { background: C.blue, borderColor: C.blue, color: "#fff" }
              : { background: "#fff", borderColor: C.border, color: C.slate }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : midterms.length === 0 ? (
          <p className="rounded-2xl border bg-white p-8 text-center text-sm text-slate-500" style={{ borderColor: C.border }}>No midterms assigned yet.</p>
        ) : (
          <>
            {show("available") && (
              <Section title="Available now" count={available.length} dot={C.blue}>
                {available.map((m) => <Row key={m.mock_exam_id} m={m} kind="available" onUnlock={refetch} />)}
              </Section>
            )}
            {show("scheduled") && (
              <Section title="Scheduled" count={scheduled.length} dot="#94a3b8">
                {scheduled.map((m) => <Row key={m.mock_exam_id} m={m} kind="scheduled" onUnlock={refetch} />)}
              </Section>
            )}
            {show("past") && (
              <Section title="Past attempts" count={past.length} dot="#0b7a4f">
                {past.map((m) => <Row key={m.mock_exam_id} m={m} kind="past" onUnlock={refetch} />)}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
