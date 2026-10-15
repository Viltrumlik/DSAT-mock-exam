"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowLeft, RefreshCw, Upload } from "lucide-react";

import { useQbBatches, useQbUploadBatch } from "@/domains/questionBank/hooks";
import { BatchStatusBadge } from "@/domains/questionBank/components/ImportStatusBadge";
import {
  STUDIO_BTN_PRIMARY,
  STUDIO_BTN_SECONDARY,
  STUDIO_CARD,
  STUDIO_ERROR_BANNER,
  STUDIO_LINK,
  STUDIO_OK_BANNER,
  STUDIO_PAGE_DESC,
  STUDIO_PAGE_TITLE,
  STUDIO_SECTION_GAP,
  STUDIO_TABLE,
  STUDIO_TD,
  STUDIO_TH,
} from "@/components/studio/primitives";
import { normalizeApiError } from "@/lib/apiError";


export default function ImportsPage() {
  const { data, isLoading, error, refetch, isFetching } = useQbBatches();
  const batches = data?.results ?? [];

  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useQbUploadBatch();
  const [banner, setBanner] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    try {
      const batch = await upload.mutateAsync(file);
      setBanner({ tone: "ok", text: `Parsed ${batch.total_candidates} candidate(s) from ${file.name}.` });
    } catch (err) {
      setBanner({ tone: "error", text: normalizeApiError(err).message || "Upload failed." });
    }
  }

  return (
    <div className={STUDIO_SECTION_GAP}>
      <Link href="/builder/question-bank" className={`${STUDIO_LINK} inline-flex items-center gap-1 text-[13px]`}>
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Question Bank
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className={STUDIO_PAGE_TITLE}>Imports</h1>
          <p className={STUDIO_PAGE_DESC}>
            Review parsed import batches and promote candidates into triage. Exact duplicate detection
            (content hash); similarity detection coming later.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={onFile} className="hidden" />
          <button
            type="button"
            disabled={upload.isPending}
            onClick={() => fileRef.current?.click()}
            className={STUDIO_BTN_PRIMARY}
          >
            <Upload className="h-3.5 w-3.5" /> {upload.isPending ? "Uploading…" : "Upload PDF"}
          </button>
          <button
            type="button"
            onClick={() => void refetch()}
            className={STUDIO_BTN_SECONDARY}
          >
            <RefreshCw className={isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Refresh
          </button>
        </div>
      </div>

      {banner ? (
        <div className={banner.tone === "ok" ? STUDIO_OK_BANNER : STUDIO_ERROR_BANNER}>
          {banner.text}
        </div>
      ) : null}

      <div className={`${STUDIO_CARD} overflow-x-auto`}>
        <table className={STUDIO_TABLE}>
          <thead>
            <tr>
              <th scope="col" className={STUDIO_TH}>Batch</th>
              <th scope="col" className={STUDIO_TH}>Source</th>
              <th scope="col" className={STUDIO_TH}>Status</th>
              <th scope="col" className={STUDIO_TH}>Candidates</th>
              <th scope="col" className={STUDIO_TH}>Promoted</th>
              <th scope="col" className={STUDIO_TH}>Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <Row colSpan={6}>Loading…</Row>
            ) : error ? (
              <Row colSpan={6} tone="error">Failed to load import batches.</Row>
            ) : batches.length === 0 ? (
              <Row colSpan={6}>No import batches yet.</Row>
            ) : (
              batches.map((b) => (
                <tr key={b.id} className="hover:bg-surface-2 [&:last-child>td]:border-b-0">
                  <td className={STUDIO_TD}>
                    <Link href={`/builder/question-bank/imports/${b.id}`} className={STUDIO_LINK}>
                      #{b.id} {b.filename || "(no filename)"}
                    </Link>
                  </td>
                  <td className={`${STUDIO_TD} text-muted-foreground`}>{b.source_type}</td>
                  <td className={STUDIO_TD}>
                    <BatchStatusBadge label={b.status_display} />
                  </td>
                  <td className={`${STUDIO_TD} whitespace-nowrap tabular-nums text-muted-foreground`}>
                    {b.total_candidates}
                    <span className="ml-1 text-[12px] text-muted-foreground/70">
                      ({b.candidate_counts.valid}✓ / {b.candidate_counts.error}✕ / {b.candidate_counts.duplicate} dup)
                    </span>
                  </td>
                  <td className={`${STUDIO_TD} tabular-nums text-muted-foreground`}>{b.promoted_count}</td>
                  <td className={`${STUDIO_TD} whitespace-nowrap text-muted-foreground`}>{new Date(b.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ children, colSpan, tone }: { children: React.ReactNode; colSpan: number; tone?: "error" }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={
          tone === "error"
            ? "px-2 py-6 text-[13px] text-red-700 dark:text-red-300"
            : "px-2 py-6 text-[13px] text-muted-foreground"
        }
      >
        {children}
      </td>
    </tr>
  );
}
