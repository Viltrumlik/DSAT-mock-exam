"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileText, ArrowRight, Coffee } from "lucide-react";
import { mockApi, type MockRow } from "@/lib/mockApi";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import MockSessionPanel from "./MockSessionPanel";

/** Student full-mock list — 4-module SAT simulations (2 English + 2 Math + a 10-min break). */

const C = { navy: "#0f1729", blue: "#2a68c0", slate: "#64748b", border: "#e7ebf3" };

function Row({ m }: { m: MockRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function enter() {
    setBusy(true);
    try {
      const attemptId = await mockApi.createAttempt(m.mock_id);
      // `welcome=1` only on a FRESH sitting. A resume drops straight back into the module
      // the server is holding — its clock has been running since the student left, so a
      // "click Start when you're ready" screen would just burn their remaining time.
      const qs = m.in_progress ? "?src=mock" : "?src=mock&welcome=1";
      router.push(`/exam/${attemptId}${qs}`);
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
      setBusy(false);
    }
  }

  const label = m.in_progress ? "Resume mock" : m.submitted ? "Retake mock" : "Start mock";

  return (
    <div className="flex items-center gap-4 rounded-2xl border bg-white px-5 py-4" style={{ borderColor: C.border }}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><FileText className="h-5 w-5" /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[16px] font-extrabold" style={{ color: C.navy }}>{m.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: C.slate }}>
          {m.module_count} modules · out of 1600
          <span className="inline-flex items-center gap-1"><Coffee className="h-3.5 w-3.5" /> {m.break_minutes}m break</span>
        </p>
      </div>
      {m.submitted && m.total_score != null && (
        <div className="text-right leading-none">
          <span className="text-[20px] font-extrabold" style={{ color: C.navy }}>{m.total_score}</span>
          <span className="text-[12px] font-semibold text-slate-400"> /1600</span>
        </div>
      )}
      {/* A finished sitting needs a way back to its score. The only button used to be
          "Retake", so the single click available to a student who had just completed a
          mock started a NEW attempt and buried the result they were looking for. */}
      {m.result_attempt_id != null && (
        <Link
          href={`/mock-exam/result/${m.result_attempt_id}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-[14px] py-[10px] text-sm font-bold transition hover:bg-slate-50"
          style={{ borderColor: C.border, color: C.navy }}
        >
          View result
        </Link>
      )}
      <button onClick={enter} disabled={busy} className="inline-flex shrink-0 items-center gap-2 rounded-xl px-[18px] py-[11px] text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60" style={{ background: C.blue }}>
        {busy ? "…" : label} <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function MockList() {
  const { data, isLoading } = useQuery({ queryKey: ["mock", "mine"], queryFn: mockApi.myMocks });
  const mocks = data ?? [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-8" style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}>
      <span className="text-[12px] font-extrabold tracking-[0.16em] text-slate-400">MOCK</span>
      <h1 className="mt-1 text-[34px] font-extrabold leading-tight" style={{ color: C.navy }}>Mock exam</h1>
      <p className="mt-2 max-w-2xl text-sm font-medium" style={{ color: C.slate }}>
        A full timed SAT simulation: 2 Reading &amp; Writing modules, a 10-minute break, then 2 Math modules — scored out of 1600.
      </p>

      {/* Two ways to sit the same paper. An invigilated sitting is run by a teacher with a
          code; practice below is the student's own, whenever they like. */}
      <div className="mt-6">
        <MockSessionPanel />
      </div>

      <p className="mt-8 text-[12px] font-extrabold tracking-[0.16em] text-slate-400">PRACTISE ON YOUR OWN</p>
      <div className="mt-3 space-y-3">
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : mocks.length === 0 ? (
          <p className="rounded-2xl border bg-white p-8 text-center text-sm text-slate-500" style={{ borderColor: C.border }}>No mocks available yet.</p>
        ) : (
          mocks.map((m) => <Row key={m.mock_id} m={m} />)
        )}
      </div>
    </div>
  );
}
