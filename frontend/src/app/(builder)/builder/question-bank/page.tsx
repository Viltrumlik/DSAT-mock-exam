"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { ListChecks, Loader2, Plus, Upload } from "lucide-react";

import { useToast } from "@/components/ToastProvider";
import { ChangeList, type ChangeListAction, type ChangeListColumn } from "@/features/ops/changelist/ChangeList";
import { useChangeListParams } from "@/features/ops/changelist/useChangeListParams";
import { Truncated } from "@/features/ops/users/peopleColumns";
import { QB_FILTER_KEYS, useQbChangeList } from "@/domains/questionBank/changelist";
import { useQbBulk } from "@/domains/questionBank/hooks";
import { QbStatusBadge } from "@/domains/questionBank/components/QbStatusBadge";
import { difficultyLabel } from "@/domains/questionBank/utils";
import "@/features/builderShell/studioChangelist.css";
import type { QbQuestionListItem } from "@/domains/questionBank/types";

/**
 * The Question Bank — the single source of truth for SAT questions — as the /ops console's
 * changelist (owner 2026-10-15: "question builderni opsga styledan ko'chirib"): search, filters with
 * a count beside every choice, sortable columns, Approve on a selection, and the state in the
 * address. Only Approved questions are selectable by consumers and counted in analytics.
 */

const SUBJECT_LABELS: Record<string, string> = { ENGLISH: "English", MATH: "Math" };

// The two text columns give way so Difficulty and Status stay in view beside the filter panel:
// measured to fit at 1280, 1440 and 1920 wide; narrower windows scroll the table.
const QUESTION_WIDTH = "max-w-[9rem] min-[1400px]:max-w-[14rem] min-[1600px]:max-w-[22rem]";
const SKILL_WIDTH = "max-w-[7rem] min-[1400px]:max-w-[9rem] min-[1600px]:max-w-[13rem]";

const COLUMNS: ChangeListColumn<QbQuestionListItem>[] = [
  {
    key: "qb_id",
    label: "QB-ID",
    sortKey: "qb_id",
    render: (q) => (
      <Link
        href={`/builder/question-bank/${q.id}`}
        className="rounded-sm font-mono text-xs font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-hover"
      >
        {q.qb_id}
      </Link>
    ),
  },
  {
    key: "question",
    label: "Question",
    render: (q) =>
      q.question_text ? (
        <Link href={`/builder/question-bank/${q.id}`} className="block hover:underline" title={q.question_text}>
          <Truncated text={q.question_text} className={QUESTION_WIDTH} />
        </Link>
      ) : (
        <span className="text-muted-foreground">(no text)</span>
      ),
  },
  { key: "subject", label: "Subject", render: (q) => SUBJECT_LABELS[q.subject] ?? q.subject },
  {
    key: "domain",
    label: "Domain › Skill",
    render: (q) =>
      q.domain_name ? (
        <Truncated
          text={q.skill_name ? `${q.domain_name} › ${q.skill_name}` : q.domain_name}
          className={`${SKILL_WIDTH} text-muted-foreground`}
        />
      ) : (
        <span className="italic text-muted-foreground">Unclassified</span>
      ),
  },
  {
    key: "difficulty",
    label: "Difficulty",
    render: (q) => <span className="text-muted-foreground">{difficultyLabel(q.difficulty)}</span>,
  },
  {
    key: "status",
    label: "Status",
    // The bank's own tinted badge — the builder keeps its colour (owner 2026-10-15).
    render: (q) => <QbStatusBadge status={q.status} />,
  },
];

/** Approve only: rejecting stays in the Triage Queue, where a question is looked at before it goes. */
type Pending = { ids: number[]; resolve: (done: boolean) => void };

const HEADER_LINK =
  "inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-sm font-bold text-foreground shadow-sm transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export default function QuestionBankListPage() {
  // useSearchParams needs a Suspense boundary above it, or the production build's prerender fails.
  return (
    <Suspense fallback={null}>
      <QuestionBankChangeList />
    </Suspense>
  );
}

function QuestionBankChangeList() {
  const { params } = useChangeListParams(QB_FILTER_KEYS);
  const query = useQbChangeList(params);
  const bulk = useQbBulk();
  const { push } = useToast();
  const [pending, setPending] = useState<Pending | null>(null);

  const actions: ChangeListAction[] = [
    {
      key: "approve",
      label: "Approve selected questions",
      run: (ids) => new Promise<boolean>((resolve) => setPending({ ids, resolve })),
    },
  ];

  const confirm = async () => {
    if (!pending) return;
    const { ids, resolve } = pending;
    let done = false;
    try {
      const r = await bulk.mutateAsync({ action: "approve", ids });
      const okCount = r.results.filter((x) => x.ok).length;
      const failed = r.results.filter((x) => !x.ok);
      const verb = "approved";
      // The server says why a question was skipped ("Cannot approve an UNCLASSIFIED question…").
      const why = failed[0]?.error ? ` (${failed[0].error})` : "";
      if (okCount === 0) push({ tone: "error", message: `Nothing ${verb} — ${failed.length} skipped${why}.` });
      else if (failed.length === 0) push({ tone: "success", message: `${okCount} question${okCount === 1 ? "" : "s"} ${verb}.` });
      else push({ tone: "error", message: `${okCount} ${verb}, ${failed.length} skipped${why}.` });
      done = true;
    } catch {
      push({ tone: "error", message: "Bulk action failed. Please try again." });
    } finally {
      setPending(null);
      resolve(done);
    }
  };

  const cancel = () => {
    if (bulk.isPending || !pending) return;
    pending.resolve(false);
    setPending(null);
  };

  return (
    // The builder's soft skin on the shared /ops changelist — see studioChangelist.css.
    <div className="studio-changelist">
      <ChangeList<QbQuestionListItem>
        title="Question Bank"
        noun={{ singular: "question", plural: "questions" }}
        columns={COLUMNS}
        data={query.data}
        loading={query.isPending}
        error={query.isError}
        fetching={query.isFetching && query.isPlaceholderData}
        onRetry={() => void query.refetch()}
        filterKeys={QB_FILTER_KEYS}
        actions={actions}
        searchPlaceholder="Search QB-ID or question text"
        rowLabel={(q) => q.qb_id}
        headerAction={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/builder/question-bank/triage" className={HEADER_LINK}>
              <ListChecks aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              Triage Queue
            </Link>
            <Link href="/builder/question-bank/imports" className={HEADER_LINK}>
              <Upload aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              Imports
            </Link>
            <Link
              href="/builder/question-bank/new"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <Plus aria-hidden className="h-3.5 w-3.5" />
              New question
            </Link>
          </div>
        }
      />

      {pending ? (
        <ConfirmApprove
          count={pending.ids.length}
          busy={bulk.isPending}
          onCancel={cancel}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </div>
  );
}

function ConfirmApprove({
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  count: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const noun = `${count} question${count === 1 ? "" : "s"}`;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay-scrim)] p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qb-bulk-title"
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      >
        <h2 id="qb-bulk-title" className="px-6 pt-5 text-base font-extrabold text-foreground">
          Approve {noun}?
        </h2>
        <p className="px-6 pb-5 pt-2 text-sm leading-relaxed text-muted-foreground">
          Approved questions become selectable by tests and count in analytics. A question without a domain, skill and
          difficulty is skipped.
        </p>
        <div className="flex gap-2 border-t border-border bg-surface-2/40 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="h-10 flex-1 rounded-xl border border-border bg-card px-4 text-sm font-bold text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
