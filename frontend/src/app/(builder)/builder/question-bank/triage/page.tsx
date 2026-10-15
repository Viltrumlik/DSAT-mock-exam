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
import {
  STUDIO_BTN_DESTRUCTIVE,
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


const TH_RIGHT = STUDIO_TH.replace("text-left", "text-right");

// Compact buttons (28px, 12px) for the bulk bar and the rows, sized as STUDIO_BTN_DESTRUCTIVE is so
// Reject sits level with them.
const ROW_BTN =
  "inline-flex min-h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";
const ROW_BTN_PRIMARY =
  "inline-flex min-h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50";

const CHECKBOX = "h-3.5 w-3.5 cursor-pointer align-middle accent-primary";

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
    <div className={STUDIO_SECTION_GAP}>
      <Link href="/builder/question-bank" className={`${STUDIO_LINK} inline-flex items-center gap-1 text-[13px]`}>
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Question Bank
      </Link>

      <div>
        <h1 className={STUDIO_PAGE_TITLE}>Triage Queue</h1>
        <p className={STUDIO_PAGE_DESC}>
          Classify imported questions with real taxonomy, then approve. Metadata is never fabricated —
          AI suggestions are advisory and must be confirmed by a person.
        </p>
      </div>

      {banner ? (
        <div className={banner.tone === "ok" ? STUDIO_OK_BANNER : STUDIO_ERROR_BANNER}>
          {banner.text}
        </div>
      ) : null}

      {/* Bulk bar */}
      {selectedIds.length > 0 && (
        <div className={`${STUDIO_CARD} flex flex-wrap items-center justify-between gap-2 px-3 py-2`}>
          <span className="text-[13px] font-medium tabular-nums text-foreground">{selectedIds.length} selected</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onBulk("approve")}
              className={ROW_BTN_PRIMARY}
            >
              <Check className="h-3.5 w-3.5" /> Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onBulk("reject")}
              className={STUDIO_BTN_DESTRUCTIVE}
            >
              <X className="h-3.5 w-3.5" /> Reject
            </button>
          </div>
        </div>
      )}

      <div className={`${STUDIO_CARD} overflow-x-auto`}>
        <table className={STUDIO_TABLE}>
          <thead>
            <tr>
              <th scope="col" className={`${STUDIO_TH} w-8`}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" className={CHECKBOX} />
              </th>
              <th scope="col" className={STUDIO_TH}>QB-ID</th>
              <th scope="col" className={STUDIO_TH}>Question</th>
              <th scope="col" className={STUDIO_TH}>Suggestion</th>
              <th scope="col" className={TH_RIGHT}>Actions</th>
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
                <tr key={q.id} className="align-top hover:bg-surface-2 [&:last-child>td]:border-b-0">
                  <td className={`${STUDIO_TD} py-2`}>
                    <input
                      type="checkbox"
                      checked={selected.has(q.id)}
                      onChange={() => toggle(q.id)}
                      aria-label={`Select ${q.qb_id}`}
                      className={CHECKBOX}
                    />
                  </td>
                  <td className={`${STUDIO_TD} whitespace-nowrap py-1.5`}>
                    <Link href={`/builder/question-bank/${q.id}`} className={`${STUDIO_LINK} font-mono text-[12px]`}>
                      {q.qb_id}
                    </Link>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{q.subject}</p>
                  </td>
                  <td className={`${STUDIO_TD} max-w-sm py-1.5`}>
                    <p className="line-clamp-2 text-foreground">{q.question_text || "(no text)"}</p>
                  </td>
                  <td className={`${STUDIO_TD} py-1.5`}>
                    {q.suggestion ? (
                      <div className="text-[12px] text-foreground">
                        <span className="inline-flex items-center gap-1 font-medium">
                          <Sparkles className="h-3 w-3 text-muted-foreground" /> {q.suggestion.skill?.name ?? q.suggestion.domain?.name ?? "Suggestion"}
                        </span>
                        {q.suggestion.difficulty ? (
                          <span className="ml-1 text-muted-foreground">({difficultyLabel(q.suggestion.difficulty)})</span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-[12px] italic text-muted-foreground">none</span>
                    )}
                  </td>
                  <td className={`${STUDIO_TD} py-1.5`}>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {q.suggestion ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onAccept(q.id)}
                          className={ROW_BTN}
                        >
                          Accept suggestion
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setClassifyTarget(q)}
                        className={ROW_BTN}
                      >
                        Classify
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onApprove(q.id)}
                        className={ROW_BTN_PRIMARY}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onReject(q.id)}
                        className={STUDIO_BTN_DESTRUCTIVE}
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
