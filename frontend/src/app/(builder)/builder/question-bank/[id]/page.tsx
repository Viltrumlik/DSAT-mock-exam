"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Archive, ArrowLeft, Pencil, RotateCcw, Sparkles } from "lucide-react";

import { useQbArchive, useQbQuestion, useQbRestore } from "@/domains/questionBank/hooks";
import { QbStatusBadge } from "@/domains/questionBank/components/QbStatusBadge";
import { BankQuestionEditor } from "@/domains/questionBank/components/BankQuestionEditor";
import {
  difficultyLabel,
  formatCorrectAnswer,
  resolveImageUrl,
} from "@/domains/questionBank/utils";
import type { QbQuestionDetail } from "@/domains/questionBank/types";
import {
  STUDIO_BOX_CAPTION,
  STUDIO_BTN_DESTRUCTIVE,
  STUDIO_BTN_SECONDARY,
  STUDIO_CARD,
  STUDIO_FIELD_LABEL,
  STUDIO_LINK,
  STUDIO_PAGE_TITLE,
  STUDIO_SECTION_GAP,
  STUDIO_TAB,
} from "@/components/studio/primitives";

type Tab = "preview" | "details";


export default function QuestionBankDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const [tab, setTab] = useState<Tab>("preview");
  const [editing, setEditing] = useState(false);
  const { data: q, isLoading, error } = useQbQuestion(id);
  const archive = useQbArchive();
  const restore = useQbRestore();

  if (isLoading) return <Centered>Loading…</Centered>;
  if (error || !q) return <Centered tone="error">Failed to load this question.</Centered>;

  const isArchived = q.status === "ARCHIVED";

  return (
    <div className={STUDIO_SECTION_GAP}>
      <Link href="/builder/question-bank" className={`${STUDIO_LINK} inline-flex items-center gap-1 text-[13px]`}>
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Question Bank
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className={`${STUDIO_PAGE_TITLE} font-mono`}>{q.qb_id}</h1>
          <QbStatusBadge status={q.status} />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={STUDIO_BTN_SECONDARY}
          >
            <Pencil className="h-3.5 w-3.5" /> {editing ? "Close editor" : "Edit"}
          </button>
          {isArchived ? (
            <button type="button" disabled={restore.isPending} onClick={() => restore.mutate(id)} className={STUDIO_BTN_SECONDARY}>
              <RotateCcw className="h-3.5 w-3.5" /> Restore
            </button>
          ) : (
            <button type="button" disabled={archive.isPending} onClick={() => archive.mutate(id)} className={STUDIO_BTN_DESTRUCTIVE}>
              <Archive className="h-3.5 w-3.5" /> Archive
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <BankQuestionEditor existing={q} onSaved={() => setEditing(false)} />
      ) : (
        <>
          <div className="flex gap-1 border-b border-border">
            {(["preview", "details"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={
                  tab === t
                    ? `${STUDIO_TAB} border-primary text-primary dark:text-primary-hover`
                    : `${STUDIO_TAB} border-transparent text-muted-foreground hover:text-foreground`
                }
              >
                {t === "preview" ? "Preview" : "Details"}
              </button>
            ))}
          </div>

          {tab === "preview" && <PreviewTab q={q} />}
          {tab === "details" && <DetailsTab q={q} />}
        </>
      )}
    </div>
  );
}

function PreviewTab({ q }: { q: QbQuestionDetail }) {
  const stem = resolveImageUrl(q.question_image);
  const options: Array<{ key: string; text: string; img: string | null }> = [
    { key: "A", text: q.option_a, img: q.option_a_image },
    { key: "B", text: q.option_b, img: q.option_b_image },
    { key: "C", text: q.option_c, img: q.option_c_image },
    { key: "D", text: q.option_d, img: q.option_d_image },
  ].filter((o) => o.text || o.img);

  return (
    <div className={`${STUDIO_CARD} space-y-4 p-4`}>
      {q.passage ? (
        <div className="border border-border bg-surface-2 px-3 py-2">
          <p className={STUDIO_FIELD_LABEL}>Passage</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{q.passage.passage_text}</p>
        </div>
      ) : null}

      {q.question_prompt ? (
        <p className="whitespace-pre-wrap text-sm font-semibold text-foreground">{q.question_prompt}</p>
      ) : null}
      <p className="whitespace-pre-wrap text-base text-foreground">{q.question_text}</p>
      {stem ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={stem} alt="Question diagram" className="max-h-80 rounded-md border border-border" />
      ) : null}

      {options.length > 0 && (
        <ul className="space-y-2">
          {options.map((o) => (
            <li key={o.key} className="flex items-start gap-3 rounded-md border border-border px-3 py-2">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[12px] font-semibold text-muted-foreground">
                {o.key}
              </span>
              <div className="min-w-0">
                {o.text ? <p className="whitespace-pre-wrap text-sm text-foreground">{o.text}</p> : null}
                {o.img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resolveImageUrl(o.img)} alt={`Option ${o.key}`} className="mt-1 max-h-40 rounded border border-border" />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Correct answer">{formatCorrectAnswer(q.correct_answer)}</Field>
        <Field label="Points">{String(q.points)}</Field>
      </div>
      {q.explanation ? (
        <Field label="Explanation">
          <span className="whitespace-pre-wrap">{q.explanation}</span>
        </Field>
      ) : null}
    </div>
  );
}

function DetailsTab({ q }: { q: QbQuestionDetail }) {
  return (
    <div className="space-y-4">
      <div className={`${STUDIO_CARD} grid gap-3 p-4 sm:grid-cols-2`}>
        <Field label="Domain">{q.domain ? q.domain.name : <Unclassified />}</Field>
        <Field label="Skill">{q.skill ? q.skill.name : <Unclassified />}</Field>
        <Field label="Difficulty">{difficultyLabel(q.difficulty)}</Field>
        <Field label="Source">{q.source_type}</Field>
        <Field label="Source reference">{q.source_reference || "—"}</Field>
        <Field label="Content hash">
          <span className="font-mono text-[12px]">{q.content_hash || "—"}</span>
        </Field>
        <Field label="Created">{new Date(q.created_at).toLocaleString()}</Field>
      </div>

      {q.suggestion ? (
        <div className={STUDIO_CARD}>
          <p className={`${STUDIO_BOX_CAPTION} flex items-center gap-1.5`}>
            <Sparkles className="h-3.5 w-3.5" /> AI suggestion · advisory only (never auto-applied)
          </p>
          <div className="grid gap-2 px-3 py-2 text-[13px] text-foreground sm:grid-cols-2">
            <span>Domain: {q.suggestion.domain?.name ?? "—"}</span>
            <span>Skill: {q.suggestion.skill?.name ?? "—"}</span>
            <span>Difficulty: {q.suggestion.difficulty ?? "—"}</span>
            <span>
              Confidence: {q.suggestion.confidence != null ? `${Math.round(q.suggestion.confidence * 100)}%` : "—"}
            </span>
          </div>
          {q.suggestion.rationale ? (
            <p className="px-3 pb-2 text-[13px] italic text-muted-foreground">“{q.suggestion.rationale}”</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={STUDIO_FIELD_LABEL}>{label}</p>
      <div className="text-[13px] text-foreground">{children}</div>
    </div>
  );
}

function Unclassified() {
  return <span className="italic text-muted-foreground">Unclassified</span>;
}

function Centered({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div
      className={
        tone === "error"
          ? "py-10 text-center text-[13px] text-red-700 dark:text-red-300"
          : "py-10 text-center text-[13px] text-muted-foreground"
      }
    >
      {children}
    </div>
  );
}
