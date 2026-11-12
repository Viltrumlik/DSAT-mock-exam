"use client";

import Link from "next/link";
import { Suspense, useRef, useState } from "react";

import { toast } from "@/features/console/toast";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog, buttonClass } from "@/features/console/ui";
import { ChangeList, type ChangeListAction, type ChangeListColumn } from "@/features/ops/changelist/ChangeList";
import { useChangeListParams } from "@/features/ops/changelist/useChangeListParams";
import { Truncated } from "@/features/ops/users/peopleColumns";
import { QB_FILTER_KEYS, useQbChangeList } from "@/domains/questionBank/changelist";
import { useQbBulk } from "@/domains/questionBank/hooks";
import { QbStatusBadge } from "@/domains/questionBank/components/QbStatusBadge";
import { difficultyLabel } from "@/domains/questionBank/utils";
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
        <span className="text-ms-fg-3">(no text)</span>
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
          className={`${SKILL_WIDTH} text-ms-fg-3`}
        />
      ) : (
        <span className="italic text-ms-fg-3">Unclassified</span>
      ),
  },
  {
    key: "difficulty",
    label: "Difficulty",
    render: (q) => <span className="text-ms-fg-3">{difficultyLabel(q.difficulty)}</span>,
  },
  {
    key: "status",
    label: "Status",
    // The bank's own tinted badge — the builder keeps its colour (owner 2026-10-15).
    render: (q) => <QbStatusBadge status={q.status} />,
  },
];

/** Approve only: rejecting lived in the Triage Queue, which the owner removed on 2026-11-12. */
type Pending = { ids: number[]; resolve: (done: boolean) => void };

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
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);
  const succeeded = useRef(false);

  const actions: ChangeListAction[] = [
    {
      key: "approve",
      label: "Approve selected questions",
      short: "Approve",
      icon: "check",
      run: (ids) =>
        new Promise<boolean>((resolve) => {
          succeeded.current = false;
          setPending({ ids, resolve });
          setOpen(true);
        }),
    },
  ];

  // Runs inside the dialog: progress on the button; a failure shakes it and says why there.
  const confirm = async () => {
    if (!pending) return;
    let r: Awaited<ReturnType<typeof bulk.mutateAsync>>;
    try {
      r = await bulk.mutateAsync({ action: "approve", ids: pending.ids });
    } catch {
      throw new Error("Couldn’t reach the server. Check the list, then try again.");
    }
    const okCount = r.results.filter((x) => x.ok).length;
    const failed = r.results.filter((x) => !x.ok);
    // The server says why a question was skipped ("Cannot approve an UNCLASSIFIED question…").
    const why = failed[0]?.error ? ` (${failed[0].error})` : "";
    if (okCount === 0) throw new Error(`Nothing approved — ${failed.length} skipped${why}.`);
    succeeded.current = true;
    toast.show({
      icon: "check",
      tone: failed.length ? "error" : "neutral",
      message: failed.length ? `${okCount} approved, ${failed.length} skipped${why}.` : `${okCount} question${okCount === 1 ? "" : "s"} approved.`,
    });
  };

  const close = () => {
    setOpen(false);
    pending?.resolve(succeeded.current);
  };

  return (
    // The builder's rounded look now comes from the console tokens' Builder temperature.
    <div>
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
            <Link href="/builder/question-bank/new" className={buttonClass({ variant: "primary" })}>
              <Icon name="plus" />
              New question
            </Link>
          </div>
        }
      />

      {pending ? (
        <ConfirmDialog
          open={open}
          onClose={close}
          title={`Approve ${pending.ids.length} question${pending.ids.length === 1 ? "" : "s"}?`}
          icon="check"
          confirmLabel={`Approve ${pending.ids.length}`}
          busyLabel="Approving…"
          doneLabel="Approved"
          confirmIcon="check"
          onConfirm={confirm}
        >
          <p>Approved questions become selectable by tests and count in analytics.</p>
          <p>A question without a domain, skill and difficulty is skipped.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

