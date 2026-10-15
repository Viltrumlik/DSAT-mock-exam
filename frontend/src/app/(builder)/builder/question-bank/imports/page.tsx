"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowLeft, RefreshCw, Upload } from "lucide-react";

import { useQbBatches, useQbUploadBatch } from "@/domains/questionBank/hooks";
import { BatchStatusBadge } from "@/domains/questionBank/components/ImportStatusBadge";
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
    <div className="space-y-5">
      <Link
        href="/builder/question-bank"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Question Bank
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
            <Upload className="h-5 w-5 text-primary" /> Imports
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
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
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" /> {upload.isPending ? "Uploading…" : "Upload PDF"}
          </button>
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <RefreshCw className={isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Refresh
          </button>
        </div>
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

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-bold">Batch</th>
              <th className="px-4 py-3 font-bold">Source</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 font-bold">Candidates</th>
              <th className="px-4 py-3 font-bold">Promoted</th>
              <th className="px-4 py-3 font-bold">Created</th>
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
                <tr key={b.id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-3">
                    <Link href={`/builder/question-bank/imports/${b.id}`} className="font-bold text-primary hover:underline">
                      #{b.id} {b.filename || "(no filename)"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{b.source_type}</td>
                  <td className="px-4 py-3">
                    <BatchStatusBadge label={b.status_display} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {b.total_candidates}
                    <span className="ml-1 text-xs text-muted-foreground/70">
                      ({b.candidate_counts.valid}✓ / {b.candidate_counts.error}✕ / {b.candidate_counts.duplicate} dup)
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{b.promoted_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(b.created_at).toLocaleDateString()}</td>
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
        className={tone === "error" ? "px-4 py-10 text-center text-rose-600" : "px-4 py-10 text-center text-muted-foreground"}
      >
        {children}
      </td>
    </tr>
  );
}
