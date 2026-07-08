"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { mockApi } from "@/lib/mockApi";

const C = { navy: "#0f1729", slate: "#64748b", border: "#e7ebf3" };

function ScorePill({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-2xl border bg-white px-6 py-4 text-center" style={{ borderColor: C.border }}>
      <p className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-[28px] font-extrabold" style={{ color: C.navy }}>{value ?? "—"}<span className="text-[14px] font-bold text-slate-400"> /800</span></p>
    </div>
  );
}

export default function MockResultPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  const id = Number(attemptId);
  const { data, isLoading, error } = useQuery({ queryKey: ["mock", "result", id], queryFn: () => mockApi.getResults(id), retry: 1 });

  return (
    <div className="mx-auto max-w-2xl px-6 py-10" style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}>
      <Link href="/mock-exam" className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: C.slate }}>
        <ArrowLeft className="h-4 w-4" /> Back to mocks
      </Link>

      {isLoading ? (
        <p className="mt-8 text-sm text-slate-500">Loading your result…</p>
      ) : error || !data ? (
        <p className="mt-8 rounded-2xl border bg-white p-8 text-center text-sm text-slate-500" style={{ borderColor: C.border }}>Result not available yet.</p>
      ) : (
        <div className="mt-8 rounded-3xl border bg-white p-10 text-center" style={{ borderColor: C.border }}>
          <span className="text-[12px] font-extrabold tracking-[0.16em] text-slate-400">MOCK RESULT</span>
          <p className="mt-2 text-[15px] font-bold" style={{ color: C.slate }}>{data.title}</p>
          <div className="mt-6 flex items-end justify-center gap-1">
            <span className="text-[64px] font-extrabold leading-none" style={{ color: C.navy }}>{data.total_score ?? "—"}</span>
            <span className="mb-2 text-[20px] font-bold text-slate-400">/ 1600</span>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4">
            <ScorePill label="Reading & Writing" value={data.english_score} />
            <ScorePill label="Math" value={data.math_score} />
          </div>
        </div>
      )}
    </div>
  );
}
