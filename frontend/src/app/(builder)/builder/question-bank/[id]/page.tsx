"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { useQbArchive, useQbQuestion, useQbRestore } from "@/domains/questionBank/hooks";
import { QbStatusBadge } from "@/domains/questionBank/components/QbStatusBadge";
import { BankQuestionEditor } from "@/domains/questionBank/components/BankQuestionEditor";
import {
  difficultyLabel,
  formatCorrectAnswer,
  resolveImageUrl,
} from "@/domains/questionBank/utils";
import type { QbQuestionDetail } from "@/domains/questionBank/types";
import { recordRecent } from "@/features/console/recent";
import { Badge, Button, Tabs, buttonClass } from "@/features/console/ui";
import { CHOICE, CHOICE_IDLE, CHOICE_KEY, LETTER, LETTER_IDLE, LETTER_KEY, keyLetterOf } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";

/**
 * One bank question (design handoff v0.3, PR 16a): its QB-ID and status, Preview — the question as the student
 * reads it, the answer key's choice in green — and Details; Edit opens the bank's editor in place.
 */

type Tab = "preview" | "details";

export default function QuestionBankDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const [tab, setTab] = useState<Tab>("preview");
  const [editing, setEditing] = useState(false);
  const { data: q, isLoading, error } = useQbQuestion(id);
  // Studio home's "Continue where you left off" (BuilderHome board).
  useEffect(() => {
    if (q) recordRecent({ kind: "question", id: q.id, name: q.qb_id, href: `/builder/question-bank/${q.id}` });
  }, [q]);
  const archive = useQbArchive();
  const restore = useQbRestore();

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
        <div className="h-8 w-56 animate-ms-shimmer rounded-[8px] bg-ms-surface-2" />
        <div className="h-72 animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
      </div>
    );
  }
  if (error || !q) {
    return (
      <div role="alert" className="flex items-start gap-2.5 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3.5 py-3 text-[14px] text-ms-critical-fg">
        <Icon name="alert" size="sm" className="mt-0.5" />
        Failed to load this question.
      </div>
    );
  }

  const isArchived = q.status === "ARCHIVED";

  return (
    <div className="flex flex-col gap-5">
      <Link href="/builder/question-bank" className={buttonClass({ variant: "ghost", size: "sm", className: "-ml-2 self-start" })}>
        <Icon name="left" size="sm" /> Back to Question Bank
      </Link>

      <header className="animate-ms-fade-in flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-ms-mono text-[22px] font-bold leading-7 text-ms-fg">{q.qb_id}</h1>
          <QbStatusBadge status={q.status} />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" icon="pencil" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close editor" : "Edit"}
          </Button>
          {isArchived ? (
            <Button variant="secondary" icon="undo" state={restore.isPending ? "busy" : "idle"} onClick={() => restore.mutate(id)}>
              Restore
            </Button>
          ) : (
            <Button
              variant="secondary"
              icon="archive"
              state={archive.isPending ? "busy" : "idle"}
              onClick={() => archive.mutate(id)}
            >
              Archive
            </Button>
          )}
        </div>
      </header>

      {editing ? (
        <BankQuestionEditor existing={q} onSaved={() => setEditing(false)} />
      ) : (
        <>
          <Tabs<Tab>
            label="Question"
            idPrefix="qb"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "preview", label: "Preview" },
              { id: "details", label: "Details" },
            ]}
          />
          <div role="tabpanel" id={`qb-${tab}-panel`} aria-labelledby={`qb-${tab}`} className="min-w-0">
            {tab === "preview" && <PreviewTab q={q} />}
            {tab === "details" && <DetailsTab q={q} />}
          </div>
        </>
      )}
    </div>
  );
}

/** The question as the student reads it: in Georgia, the answer key's choice in green. */
function PreviewTab({ q }: { q: QbQuestionDetail }) {
  const stem = resolveImageUrl(q.question_image);
  const options: Array<{ key: string; text: string; img: string | null }> = [
    { key: "A", text: q.option_a, img: q.option_a_image },
    { key: "B", text: q.option_b, img: q.option_b_image },
    { key: "C", text: q.option_c, img: q.option_c_image },
    { key: "D", text: q.option_d, img: q.option_d_image },
  ].filter((o) => o.text || o.img);
  const keyLetter = keyLetterOf(q.correct_answer);

  return (
    <div className="animate-ms-fade-in rounded-ms-card bg-ms-card p-5 shadow-ms-1 sm:p-8">
      <div className="mx-auto flex max-w-[760px] flex-col gap-5">
        {q.passage ? (
          <div className="rounded-ms-ctl bg-ms-surface p-4">
            <p className="mb-1.5 text-ms-over uppercase text-ms-fg-3">Passage</p>
            <p className="whitespace-pre-wrap font-ms-serif text-[16px] leading-[26px] text-ms-fg">{q.passage.passage_text}</p>
          </div>
        ) : null}

        {q.question_prompt ? (
          <p className="whitespace-pre-wrap font-ms-serif text-[16px] font-semibold leading-[26px] text-ms-fg">{q.question_prompt}</p>
        ) : null}
        <p className="whitespace-pre-wrap font-ms-serif text-[17px] leading-7 text-ms-fg">{q.question_text}</p>
        {stem ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={stem} alt="Question diagram" className="max-h-80 self-start rounded-[12px] border border-ms-border" />
        ) : null}

        {options.length > 0 && (
          <ul className="flex flex-col gap-2.5">
            {options.map((o) => {
              const isKey = keyLetter === o.key;
              return (
                <li key={o.key} className={cn(CHOICE, "items-start gap-3", isKey ? CHOICE_KEY : CHOICE_IDLE)}>
                  <span className={cn(LETTER, isKey ? LETTER_KEY : LETTER_IDLE)}>
                    {isKey ? <Icon name="check" size="sm" className="size-4" /> : o.key}
                    {isKey ? <span className="sr-only">{o.key}</span> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    {o.text ? <p className="whitespace-pre-wrap font-ms-serif text-[16px] leading-6 text-ms-fg">{o.text}</p> : null}
                    {o.img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={resolveImageUrl(o.img)} alt={`Option ${o.key}`} className="mt-1 max-h-40 rounded-[10px] border border-ms-border" />
                    ) : null}
                  </div>
                  {isKey ? (
                    <Badge tone="positive" className="shrink-0">
                      Answer key · {o.key}
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <div className="grid gap-4 border-t border-ms-line pt-5 sm:grid-cols-2">
          <Field label="Correct answer">{formatCorrectAnswer(q.correct_answer)}</Field>
          <Field label="Points">{String(q.points)}</Field>
        </div>
        {q.explanation ? (
          <Field label="Explanation">
            <span className="whitespace-pre-wrap font-ms-serif text-[16px] leading-[26px]">{q.explanation}</span>
          </Field>
        ) : null}
      </div>
    </div>
  );
}

function DetailsTab({ q }: { q: QbQuestionDetail }) {
  return (
    <div className="animate-ms-fade-in flex flex-col gap-4">
      <div className="grid gap-x-6 gap-y-4 rounded-ms-card bg-ms-card p-5 shadow-ms-1 sm:grid-cols-2">
        <Field label="Domain">{q.domain ? q.domain.name : <Unclassified />}</Field>
        <Field label="Skill">{q.skill ? q.skill.name : <Unclassified />}</Field>
        <Field label="Difficulty">{difficultyLabel(q.difficulty)}</Field>
        <Field label="Source">{q.source_type}</Field>
        <Field label="Source reference">{q.source_reference || "—"}</Field>
        <Field label="Content hash">
          <span className="font-ms-mono text-[12px]">{q.content_hash || "—"}</span>
        </Field>
        <Field label="Created">{new Date(q.created_at).toLocaleString()}</Field>
      </div>

      {q.suggestion ? (
        <div className="rounded-ms-card border border-ms-info-line bg-ms-info-soft p-5 text-ms-info-fg">
          <p className="mb-2 flex items-center gap-1.5 text-ms-over uppercase">
            <Icon name="review" size="sm" className="size-3.5" /> AI suggestion · advisory only (never auto-applied)
          </p>
          <div className="grid gap-2 text-[14px] sm:grid-cols-2">
            <span>Domain: {q.suggestion.domain?.name ?? "—"}</span>
            <span>Skill: {q.suggestion.skill?.name ?? "—"}</span>
            <span>Difficulty: {q.suggestion.difficulty ?? "—"}</span>
            <span>
              Confidence: {q.suggestion.confidence != null ? `${Math.round(q.suggestion.confidence * 100)}%` : "—"}
            </span>
          </div>
          {q.suggestion.rationale ? (
            <p className="mt-2 text-[14px] italic">“{q.suggestion.rationale}”</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-ms-over uppercase text-ms-fg-3">{label}</p>
      <div className="mt-1 break-words text-[14px] text-ms-fg">{children}</div>
    </div>
  );
}

function Unclassified() {
  return <span className="italic text-ms-fg-3">Unclassified</span>;
}
