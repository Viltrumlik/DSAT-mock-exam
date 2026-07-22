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
    <div className="space-y-5">
      <Link
        href="/builder/question-bank"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Question Bank
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-lg font-bold text-foreground">{q.qb_id}</h1>
          <QbStatusBadge status={q.status} />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-bold text-foreground hover:bg-surface-2"
          >
            <Pencil className="h-3.5 w-3.5" /> {editing ? "Close editor" : "Edit"}
          </button>
          {isArchived ? (
            <button type="button" disabled={restore.isPending} onClick={() => restore.mutate(id)} className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
              <RotateCcw className="h-3.5 w-3.5" /> Restore
            </button>
          ) : (
            <button type="button" disabled={archive.isPending} onClick={() => archive.mutate(id)} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
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
                    ? "border-b-2 border-primary px-4 py-2 text-sm font-bold text-primary"
                    : "border-b-2 border-transparent px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground"
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
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
      {q.passage ? (
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Passage</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{q.passage.passage_text}</p>
        </div>
      ) : null}

      {q.question_prompt ? (
        <p className="whitespace-pre-wrap text-sm font-semibold text-foreground">{q.question_prompt}</p>
      ) : null}
      <p className="whitespace-pre-wrap text-base text-foreground">{q.question_text}</p>
      {stem ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={stem} alt="Question diagram" className="max-h-80 rounded-lg border border-border" />
      ) : null}

      {options.length > 0 && (
        <ul className="space-y-2">
          {options.map((o) => (
            <li key={o.key} className="flex items-start gap-3 rounded-xl border border-border p-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-bold text-muted-foreground">
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
      <div className="grid gap-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2">
        <Field label="Domain">{q.domain ? q.domain.name : <Unclassified />}</Field>
        <Field label="Skill">{q.skill ? q.skill.name : <Unclassified />}</Field>
        <Field label="Difficulty">{difficultyLabel(q.difficulty)}</Field>
        <Field label="Source">{q.source_type}</Field>
        <Field label="Source reference">{q.source_reference || "—"}</Field>
        <Field label="Content hash">
          <span className="font-mono text-xs">{q.content_hash || "—"}</span>
        </Field>
        <Field label="Created">{new Date(q.created_at).toLocaleString()}</Field>
      </div>

      {q.suggestion ? (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-indigo-700">
            <Sparkles className="h-3.5 w-3.5" /> AI suggestion · advisory only (never auto-applied)
          </p>
          <div className="grid gap-2 text-sm text-indigo-900 sm:grid-cols-2">
            <span>Domain: {q.suggestion.domain?.name ?? "—"}</span>
            <span>Skill: {q.suggestion.skill?.name ?? "—"}</span>
            <span>Difficulty: {q.suggestion.difficulty ?? "—"}</span>
            <span>
              Confidence: {q.suggestion.confidence != null ? `${Math.round(q.suggestion.confidence * 100)}%` : "—"}
            </span>
          </div>
          {q.suggestion.rationale ? (
            <p className="mt-2 text-sm italic text-indigo-800">“{q.suggestion.rationale}”</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm text-foreground">{children}</div>
    </div>
  );
}

function Unclassified() {
  return <span className="italic text-muted-foreground/60">Unclassified</span>;
}

function Centered({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div className={tone === "error" ? "py-16 text-center text-rose-600" : "py-16 text-center text-muted-foreground"}>
      {children}
    </div>
  );
}
