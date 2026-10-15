"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, Sparkles, X } from "lucide-react";

import {
  useQbAcceptSuggestion,
  useQbApprove,
  useQbBulk,
  useQbClassify,
  useQbQuestions,
  useQbReject,
} from "@/domains/questionBank/hooks";
import { ClassifyModal } from "@/domains/questionBank/components/ClassifyModal";
import { difficultyLabel } from "@/domains/questionBank/utils";
import type { QbClassifyInput, QbQuestionListItem } from "@/domains/questionBank/types";
import { normalizeApiError } from "@/lib/apiError";

export default function TriageQueuePage() {
  const { data, isLoading, error } = useQbQuestions({ status: "TRIAGE", limit: 100 });
  const rows = data?.results ?? [];

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [classifyTarget, setClassifyTarget] = useState<QbQuestionListItem | null>(null);
  const [banner, setBanner] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const classify = useQbClassify();
  const approve = useQbApprove();
  const reject = useQbReject();
  const acceptSuggestion = useQbAcceptSuggestion();
  const bulk = useQbBulk();

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const busy = classify.isPending || approve.isPending || reject.isPending || acceptSuggestion.isPending || bulk.isPending;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }
  function fail(e: unknown) {
    setBanner({ tone: "error", text: normalizeApiError(e).message || "Action failed." });
  }
  function ok(text: string) {
    setBanner({ tone: "ok", text });
  }

  async function onApprove(id: number) {
    try {
      await approve.mutateAsync(id);
      ok("Question approved.");
    } catch (e) {
      fail(e);
    }
  }
  async function onReject(id: number) {
    try {
      await reject.mutateAsync({ id });
      ok("Question rejected.");
    } catch (e) {
      fail(e);
    }
  }
  async function onAccept(id: number) {
    try {
      await acceptSuggestion.mutateAsync(id);
      ok("Suggestion applied — review and approve.");
    } catch (e) {
      fail(e);
    }
  }
  async function onClassify(payload: QbClassifyInput) {
    if (!classifyTarget) return;
    try {
      await classify.mutateAsync({ id: classifyTarget.id, payload });
      setClassifyTarget(null);
      ok("Classified — review and approve.");
    } catch (e) {
      fail(e);
    }
  }
  async function onBulk(action: "approve" | "reject") {
    try {
      const res = await bulk.mutateAsync({ action, ids: [...selected] });
      const okCount = res.results.filter((r) => r.ok).length;
      const failCount = res.results.length - okCount;
      setSelected(new Set());
      ok(`${okCount} ${action}d${failCount ? `, ${failCount} skipped` : ""}.`);
    } catch (e) {
      fail(e);
    }
  }

  const selectedIds = useMemo(() => [...selected], [selected]);

  return (
    <div className="space-y-5">
      <Link
        href="/builder/question-bank"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Question Bank
      </Link>

      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Triage Queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Classify imported questions with real taxonomy, then approve. Metadata is never fabricated —
          AI suggestions are advisory and must be confirmed by a person.
        </p>
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

      {/* Bulk bar */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-2">
          <span className="text-sm font-bold text-foreground">{selectedIds.length} selected</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onBulk("approve")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onBulk("reject")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" /> Reject
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-4 py-3">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="px-4 py-3 font-bold">QB-ID</th>
              <th className="px-4 py-3 font-bold">Question</th>
              <th className="px-4 py-3 font-bold">Suggestion</th>
              <th className="px-4 py-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <Row colSpan={5}>Loading…</Row>
            ) : error ? (
              <Row colSpan={5} tone="error">Failed to load triage queue.</Row>
            ) : rows.length === 0 ? (
              <Row colSpan={5}>Triage queue is empty. 🎉</Row>
            ) : (
              rows.map((q) => (
                <tr key={q.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(q.id)} onChange={() => toggle(q.id)} aria-label={`Select ${q.qb_id}`} />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/builder/question-bank/${q.id}`} className="font-mono text-xs font-bold text-primary hover:underline">
                      {q.qb_id}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">{q.subject}</p>
                  </td>
                  <td className="max-w-sm px-4 py-3">
                    <p className="line-clamp-2 text-foreground">{q.question_text || "(no text)"}</p>
                  </td>
                  <td className="px-4 py-3">
                    {q.suggestion ? (
                      <div className="text-xs text-indigo-700">
                        <span className="inline-flex items-center gap-1 font-bold">
                          <Sparkles className="h-3 w-3" /> {q.suggestion.skill?.name ?? q.suggestion.domain?.name ?? "Suggestion"}
                        </span>
                        {q.suggestion.difficulty ? (
                          <span className="ml-1 text-muted-foreground">({difficultyLabel(q.suggestion.difficulty)})</span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs italic text-muted-foreground/60">none</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {q.suggestion ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onAccept(q.id)}
                          className="rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                        >
                          Accept suggestion
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setClassifyTarget(q)}
                        className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-bold text-foreground hover:bg-surface-2 disabled:opacity-50"
                      >
                        Classify
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onApprove(q.id)}
                        className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onReject(q.id)}
                        className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ClassifyModal
        open={!!classifyTarget}
        subject={classifyTarget?.subject}
        title={classifyTarget ? `Classify ${classifyTarget.qb_id}` : undefined}
        busy={classify.isPending}
        onClose={() => setClassifyTarget(null)}
        onSubmit={onClassify}
      />
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
