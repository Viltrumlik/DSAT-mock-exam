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
import {
  STUDIO_BTN_PRIMARY,
  STUDIO_BTN_SECONDARY,
  STUDIO_CARD,
  STUDIO_ERROR_BANNER,
  STUDIO_LINK,
  STUDIO_OK_BANNER,
  STUDIO_PAGE_TITLE,
  STUDIO_SECTION_GAP,
  STUDIO_TAB,
} from "@/components/studio/primitives";
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

  if (isLoading || !batch) return <div className="py-10 text-center text-[13px] text-muted-foreground">Loading…</div>;

  const counts = batch.candidate_counts;

  return (
    <div className={STUDIO_SECTION_GAP}>
      <Link href="/builder/question-bank/imports" className={`${STUDIO_LINK} inline-flex items-center gap-1 text-[13px]`}>
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Imports
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className={STUDIO_PAGE_TITLE}>
            Batch #{batch.id} <span className="font-normal text-muted-foreground">{batch.filename}</span>
          </h1>
          <BatchStatusBadge label={batch.status_display} />
        </div>
        <button
          type="button"
          disabled={promote.isPending || counts.valid + counts.warning === 0}
          onClick={() => setConfirming(true)}
          className={STUDIO_BTN_PRIMARY}
        >
          <Upload className="h-3.5 w-3.5" /> Promote to triage
        </button>
      </div>

      {banner ? (
        <div className={banner.tone === "ok" ? STUDIO_OK_BANNER : STUDIO_ERROR_BANNER}>
          {banner.text}
        </div>
      ) : null}

      {/* Counts */}
      <div className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
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
                ? `${STUDIO_TAB} border-primary text-primary dark:text-primary-hover`
                : `${STUDIO_TAB} border-transparent text-muted-foreground hover:text-foreground`
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Candidate list */}
      {candLoading ? (
        <div className="py-6 text-center text-[13px] text-muted-foreground">Loading…</div>
      ) : candidates.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-muted-foreground">No candidates in this view.</div>
      ) : (
        <ul className={`${STUDIO_CARD} divide-y divide-border`}>
          {candidates.map((c) => (
            <li key={c.id} className="px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] text-muted-foreground">
                    #{c.order + 1} · {c.subject || "—"}
                    {c.page_start ? ` · p.${c.page_start}` : ""}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[13px] text-foreground">{c.question_text || "(no text)"}</p>
                </div>
                <CandidateValidationBadge status={c.validation_status} />
              </div>
              {c.validation_messages.length > 0 ? (
                <ul className="mt-1 list-inside list-disc text-[12px] text-red-700 dark:text-red-300">
                  {c.validation_messages.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              ) : null}
              {c.duplicate_of_qb_id ? (
                <p className="mt-1 text-[12px] text-foreground">Duplicate of {c.duplicate_of_qb_id}</p>
              ) : null}
              {c.promoted_question_qb_id ? (
                <p className="mt-1 text-[12px] text-muted-foreground">Promoted → {c.promoted_question_qb_id}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* Promote confirm */}
      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4">
          <div className="w-full max-w-sm border border-border bg-card shadow-xl">
            <h2 className="border-b border-border px-4 py-2.5 text-[14px] font-semibold text-foreground">
              Promote candidates?
            </h2>
            <p className="px-4 py-3 text-[13px] text-muted-foreground">
              {counts.valid + counts.warning} valid candidate(s) will be created in the bank as TRIAGE
              (never auto-approved). Errors are skipped; duplicates are not re-created.
            </p>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-2.5">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={STUDIO_BTN_SECONDARY}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={promote.isPending}
                onClick={() => void onPromote()}
                className={STUDIO_BTN_PRIMARY}
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
    <div className="bg-card px-3 py-2">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}
