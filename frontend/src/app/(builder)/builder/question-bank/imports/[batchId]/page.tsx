"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Upload } from "lucide-react";

import { useQbBatch, useQbCandidates, useQbPromoteBatch } from "@/domains/questionBank/hooks";
import {
  BatchStatusBadge,
  CandidateValidationBadge,
} from "@/domains/questionBank/components/ImportStatusBadge";
import { normalizeApiError } from "@/lib/apiError";
import type { QbValidation } from "@/domains/questionBank/types";

type TabKey = "all" | "ERROR" | "DUPLICATE";

export default function ImportBatchDetailPage() {
  const params = useParams<{ batchId: string }>();
  const batchId = Number(params?.batchId);
  const [tab, setTab] = useState<TabKey>("all");
  const [banner, setBanner] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const { data: batch, isLoading } = useQbBatch(batchId);
  const validationFilter: QbValidation | undefined = tab === "all" ? undefined : tab;
  const { data: candData, isLoading: candLoading } = useQbCandidates(batchId, validationFilter);
  const promote = useQbPromoteBatch();

  const candidates = candData?.results ?? [];

  async function onPromote() {
    try {
      const updated = await promote.mutateAsync(batchId);
      setConfirming(false);
      setBanner({ tone: "ok", text: `Promoted ${updated.promoted_count} candidate(s) into triage.` });
    } catch (e) {
      setBanner({ tone: "error", text: normalizeApiError(e).message || "Promote failed." });
    }
  }

  if (isLoading || !batch) return <div className="py-16 text-center text-muted-foreground">Loading…</div>;

  const counts = batch.candidate_counts;

  return (
    <div className="space-y-5">
      <Link
        href="/builder/question-bank/imports"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Imports
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">
            Batch #{batch.id} <span className="text-muted-foreground">{batch.filename}</span>
          </h1>
          <BatchStatusBadge label={batch.status_display} />
        </div>
        <button
          type="button"
          disabled={promote.isPending || counts.valid + counts.warning === 0}
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          <Upload className="h-4 w-4" /> Promote to triage
        </button>
      </div>

      {banner ? (
        <div
          className={
            banner.tone === "ok"
              ? "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800"
              : "rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700"
          }
        >
          {banner.text}
        </div>
      ) : null}

      {/* Counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Valid" value={counts.valid} />
        <Stat label="Warnings" value={counts.warning} />
        <Stat label="Errors" value={counts.error} />
        <Stat label="Duplicates" value={counts.duplicate} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([
          { key: "all", label: `All (${batch.total_candidates})` },
          { key: "ERROR", label: `Validation errors (${counts.error})` },
          { key: "DUPLICATE", label: `Duplicates (${counts.duplicate})` },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              tab === t.key
                ? "border-b-2 border-primary px-4 py-2 text-sm font-bold text-primary"
                : "border-b-2 border-transparent px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Candidate list */}
      {candLoading ? (
        <div className="py-10 text-center text-muted-foreground">Loading…</div>
      ) : candidates.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground">No candidates in this view.</div>
      ) : (
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li key={c.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    #{c.order + 1} · {c.subject || "—"}
                    {c.page_start ? ` · p.${c.page_start}` : ""}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-foreground">{c.question_text || "(no text)"}</p>
                </div>
                <CandidateValidationBadge status={c.validation_status} />
              </div>
              {c.validation_messages.length > 0 ? (
                <ul className="mt-2 list-inside list-disc text-xs text-rose-600">
                  {c.validation_messages.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              ) : null}
              {c.duplicate_of_qb_id ? (
                <p className="mt-2 text-xs text-sky-700">Duplicate of {c.duplicate_of_qb_id}</p>
              ) : null}
              {c.promoted_question_qb_id ? (
                <p className="mt-2 text-xs text-emerald-700">Promoted → {c.promoted_question_qb_id}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* Promote confirm */}
      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h2 className="text-base font-bold text-foreground">Promote candidates?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {counts.valid + counts.warning} valid candidate(s) will be created in the bank as TRIAGE
              (never auto-approved). Errors are skipped; duplicates are not re-created.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold text-muted-foreground hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={promote.isPending}
                onClick={() => void onPromote()}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {promote.isPending ? "Promoting…" : "Promote"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-foreground tabular-nums">{value}</p>
    </div>
  );
}
