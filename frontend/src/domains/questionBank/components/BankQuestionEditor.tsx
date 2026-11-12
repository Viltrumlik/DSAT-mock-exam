"use client";

import * as React from "react";

import { Icon } from "@/components/ui/Icon";
import { MathText } from "@/components/MathText";
import { FormulaToolbar } from "@/components/FormulaToolbar";
import { Badge, Button, buttonClass } from "@/features/console/ui";
import {
  CHOICE,
  CHOICE_IDLE,
  CHOICE_KEY,
  CONTROL,
  FIELD_LABEL,
  LETTER,
  LETTER_IDLE,
  LETTER_KEY,
  SERIF_AREA,
  hasMarkup,
  keyLetterOf,
} from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";
import { normalizeApiError } from "@/lib/apiError";

import { useQbCreateQuestion, useQbDomains, useQbSkills, useQbUpdateQuestion } from "../hooks";
import { resolveImageUrl } from "../utils";
import type { QbImageFiles, QbClearImages, QbImageKey, QbQuestionDetail, QbWritePayload } from "../types";

/**
 * The question bank's editor (one question's Edit, and a new question). Since PR 16a it draws a question the way
 * the module editor does (design handoff v0.3): the question in the student's Georgia on the left, the choices as
 * the student's cards with the answer key's card in green, and Properties on the right. The payload is unchanged.
 */

const SUBJECTS = ["ENGLISH", "MATH"] as const;
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
const QUESTION_TYPES = [
  ["MULTIPLE_CHOICE", "Multiple choice"],
  ["STUDENT_PRODUCED", "Grid-in"],
  ["SHORT_TEXT", "Short text"],
  ["NUMERIC", "Numeric"],
  ["BOOLEAN", "True/False"],
] as const;

type Draft = {
  subject: string;
  question_type: string;
  difficulty: string;
  external_id: string;
  domain: number | "";
  skill: number | "";
  question_text: string;
  question_prompt: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  explanation: string;
  points: number;
};

function toDraft(q?: QbQuestionDetail | null): Draft {
  return {
    subject: q?.subject ?? "ENGLISH",
    question_type: q?.question_type ?? "MULTIPLE_CHOICE",
    difficulty: q?.difficulty ?? "",
    external_id: q?.external_id ?? "",
    domain: q?.domain?.id ?? "",
    skill: q?.skill?.id ?? "",
    question_text: q?.question_text ?? "",
    question_prompt: q?.question_prompt ?? "",
    option_a: q?.option_a ?? "",
    option_b: q?.option_b ?? "",
    option_c: q?.option_c ?? "",
    option_d: q?.option_d ?? "",
    correct_answer: typeof q?.correct_answer === "string" ? q.correct_answer : q?.correct_answer ? JSON.stringify(q.correct_answer) : "",
    explanation: q?.explanation ?? "",
    points: q?.points ?? 1,
  };
}

const OPTION_LETTERS: Array<{ key: "a" | "b" | "c" | "d"; field: "option_a" | "option_b" | "option_c" | "option_d" }> = [
  { key: "a", field: "option_a" },
  { key: "b", field: "option_b" },
  { key: "c", field: "option_c" },
  { key: "d", field: "option_d" },
];

function ImageUploadField({
  imgKey,
  existingUrl,
  label,
  files,
  clears,
  setFiles,
  setClears,
  quiet = false,
}: {
  imgKey: QbImageKey;
  existingUrl?: string | null;
  label: string;
  files: QbImageFiles;
  clears: QbClearImages;
  setFiles: React.Dispatch<React.SetStateAction<QbImageFiles>>;
  setClears: React.Dispatch<React.SetStateAction<QbClearImages>>;
  /** A choice's image button is quieter than the question's. */
  quiet?: boolean;
}) {
  const file = files[imgKey];
  const cleared = clears[imgKey];
  const url = resolveImageUrl(existingUrl);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {url && !cleared && !file ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} className="max-h-20 rounded-[10px] border border-ms-border bg-ms-card object-contain" />
          <button
            type="button"
            onClick={() => setClears((c) => ({ ...c, [imgKey]: true }))}
            className={buttonClass({ variant: "ghost", size: "sm", className: "text-ms-critical-fg hover:text-ms-critical-fg" })}
          >
            <Icon name="x" size="sm" /> Remove
          </button>
        </>
      ) : null}
      {file ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={URL.createObjectURL(file)} alt="Preview" className="max-h-20 rounded-[10px] border border-ms-border bg-ms-card object-contain" />
          <button
            type="button"
            onClick={() => setFiles((f) => { const n = { ...f }; delete n[imgKey]; return n; })}
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            <Icon name="x" size="sm" /> Cancel
          </button>
        </>
      ) : null}
      <label className={buttonClass({ variant: quiet ? "ghost" : "secondary", size: "sm", className: "cursor-pointer" })}>
        <Icon name="image" size="sm" />
        {file ? "Change" : url && !cleared ? "Replace" : "Add image"}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setFiles((prev) => ({ ...prev, [imgKey]: f }));
              setClears((c) => ({ ...c, [imgKey]: false }));
            }
          }}
        />
      </label>
    </div>
  );
}

export function BankQuestionEditor({
  existing,
  onSaved,
}: {
  existing?: QbQuestionDetail | null;
  onSaved: (q: QbQuestionDetail) => void;
}) {
  const isEdit = !!existing;
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(existing));
  const [imageFiles, setImageFiles] = React.useState<QbImageFiles>({});
  const [clearImages, setClearImages] = React.useState<QbClearImages>({});
  const [savedOk, setSavedOk] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const uid = React.useId();

  React.useEffect(() => {
    setDraft(toDraft(existing));
    setImageFiles({});
    setClearImages({});
    setSavedOk(false);
    setError(null);
  }, [existing]);

  const create = useQbCreateQuestion();
  const update = useQbUpdateQuestion();
  const busy = create.isPending || update.isPending;

  const { data: domains } = useQbDomains(draft.subject);
  const { data: skills } = useQbSkills(draft.domain ? { domain: Number(draft.domain) } : undefined);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const isMC = draft.question_type === "MULTIPLE_CHOICE" || draft.question_type === "BOOLEAN";
  // The answer key, read from the Correct answer field as it is typed: its choice card turns green.
  const keyLetter = isMC ? keyLetterOf(draft.correct_answer) : "";

  // Formula insertion into whichever field is focused.
  const activeFieldRef = React.useRef<{ el: HTMLTextAreaElement | HTMLInputElement; setVal: (v: string) => void } | null>(null);
  const handleFormulaInsert = React.useCallback((snippet: string, cursorOffset: number) => {
    const active = activeFieldRef.current;
    if (!active) return;
    const { el, setVal } = active;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const newVal = el.value.slice(0, start) + snippet + el.value.slice(end);
    setVal(newVal);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + cursorOffset, start + cursorOffset);
    });
  }, []);

  async function handleSave() {
    setError(null);
    setSavedOk(false);
    const payload: QbWritePayload = {
      subject: draft.subject,
      question_type: draft.question_type,
      difficulty: draft.difficulty || "",
      external_id: draft.external_id || "",
      domain: draft.domain === "" ? null : Number(draft.domain),
      skill: draft.skill === "" ? null : Number(draft.skill),
      question_text: draft.question_text,
      question_prompt: draft.question_prompt,
      option_a: draft.option_a,
      option_b: draft.option_b,
      option_c: draft.option_c,
      option_d: draft.option_d,
      correct_answer: draft.correct_answer,
      explanation: draft.explanation,
      points: draft.points,
    };
    try {
      const saved = isEdit
        ? await update.mutateAsync({ id: existing!.id, payload, files: imageFiles, clears: clearImages })
        : await create.mutateAsync({ payload, files: imageFiles, clears: clearImages });
      setSavedOk(true);
      setImageFiles({});
      setClearImages({});
      onSaved(saved);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (e) {
      setError(normalizeApiError(e).message);
    }
  }

  const imgProps = (imgKey: QbImageKey, existingUrl: string | null | undefined, label: string) => ({
    imgKey,
    existingUrl,
    label,
    files: imageFiles,
    clears: clearImages,
    setFiles: setImageFiles,
    setClears: setClearImages,
  });

  const id = (name: string) => `${uid}-${name}`;

  return (
    <div className="animate-ms-fade-in overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1">
      {/* Header: what is being edited, and Save */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ms-border px-5 py-3">
        <h2 className="text-[17px] font-bold leading-6 text-ms-fg">{isEdit ? `Edit ${existing!.qb_id}` : "New question"}</h2>
        <div className="flex items-center gap-3">
          {savedOk && (
            <span className="animate-ms-fade-in flex items-center gap-1.5 text-[13px] font-semibold text-ms-positive-fg">
              <Icon name="ok" size="sm" className="size-4" /> Saved
            </span>
          )}
          <Button variant="primary" size="sm" state={busy ? "busy" : "idle"} onClick={() => void handleSave()}>
            {isEdit ? "Save changes" : "Create"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-5 pt-3">
          <div role="alert" className="flex items-start gap-2.5 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3.5 py-2.5 text-[14px] leading-5 text-ms-critical-fg">
            <Icon name="alert" size="sm" className="mt-0.5" />
            <span className="min-w-0 flex-1">{error}</span>
          </div>
        </div>
      )}

      <div className="border-b border-ms-border bg-ms-surface">
        <FormulaToolbar onInsert={handleFormulaInsert} />
      </div>

      <div className="flex flex-col lg:flex-row">
        {/* Properties: what the question is, not what it says */}
        <aside aria-label="Properties" className="flex shrink-0 flex-col gap-4 border-ms-border p-[18px] max-lg:border-b lg:order-2 lg:w-[300px] lg:border-l">
          <h3 className="font-ms-display text-[16px] font-bold leading-6 text-ms-fg">Properties</h3>
          <div>
            <label htmlFor={id("subject")} className={FIELD_LABEL}>Subject</label>
            <select id={id("subject")} className={CONTROL} value={draft.subject} onChange={(e) => patch({ subject: e.target.value, domain: "", skill: "" })}>
              {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={id("domain")} className={FIELD_LABEL}>Domain</label>
            <select id={id("domain")} className={CONTROL} value={draft.domain} onChange={(e) => patch({ domain: e.target.value ? Number(e.target.value) : "", skill: "" })}>
              <option value="">— Unclassified —</option>
              {(domains ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={id("skill")} className={FIELD_LABEL}>Skill</label>
            <select id={id("skill")} className={CONTROL} value={draft.skill} disabled={!draft.domain} onChange={(e) => patch({ skill: e.target.value ? Number(e.target.value) : "" })}>
              <option value="">— Unclassified —</option>
              {(skills ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={id("type")} className={FIELD_LABEL}>Question type</label>
            <select id={id("type")} className={CONTROL} value={draft.question_type} onChange={(e) => patch({ question_type: e.target.value })}>
              {QUESTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={id("difficulty")} className={FIELD_LABEL}>Difficulty</label>
              <select id={id("difficulty")} className={CONTROL} value={draft.difficulty} onChange={(e) => patch({ difficulty: e.target.value })}>
                <option value="">— None —</option>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={id("points")} className={FIELD_LABEL}>Points</label>
              <input id={id("points")} type="number" min={1} className={CONTROL} value={draft.points} onChange={(e) => patch({ points: Number(e.target.value) || 1 })} />
            </div>
          </div>
          <div>
            <label htmlFor={id("external")} className={FIELD_LABEL}>External ID (source)</label>
            <input id={id("external")} className={CONTROL} placeholder="optional" value={draft.external_id} onChange={(e) => patch({ external_id: e.target.value })} />
          </div>
        </aside>

        {/* The question as the student reads it: Georgia, on the page. */}
        <div className="min-w-0 flex-1 bg-ms-bg">
          <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
            {/* Stem */}
            <div>
              <label htmlFor={id("stem")} className={FIELD_LABEL}>Question text (stem)</label>
              <div className="font-ms-serif">
                <textarea
                  id={id("stem")}
                  className={cn(SERIF_AREA, "min-h-[120px] text-[17px] leading-7")}
                  value={draft.question_text}
                  placeholder="LaTeX supported: \( x^2 + 1 = 0 \)"
                  onChange={(e) => patch({ question_text: e.target.value })}
                  onFocus={(e) => { activeFieldRef.current = { el: e.currentTarget, setVal: (v) => patch({ question_text: v }) }; }}
                />
              </div>
              {draft.question_text.trim() && (
                <div className="animate-ms-fade-in mt-2.5 rounded-ms-ctl border border-ms-border bg-ms-card px-4 py-3">
                  <p className="mb-1 text-ms-over uppercase text-ms-fg-3">Preview</p>
                  <MathText text={draft.question_text} className="font-ms-serif text-[17px] leading-7 text-ms-fg" />
                </div>
              )}
              <div className="mt-4">
                <p className={FIELD_LABEL}>Question image (optional)</p>
                <ImageUploadField {...imgProps("question", existing?.question_image, "Question image")} />
              </div>
            </div>

            {/* Options */}
            {isMC && (
              <div className="flex flex-col gap-2.5">
                <p className={FIELD_LABEL}>Answer choices</p>
                {OPTION_LETTERS.map(({ key, field }) => {
                  const L = key.toUpperCase();
                  const isKey = keyLetter === L;
                  const val = draft[field];
                  return (
                    <div key={key} className={cn(CHOICE, "flex-col focus-within:border-ms-primary", isKey ? CHOICE_KEY : CHOICE_IDLE)}>
                      <div className="flex items-center gap-3">
                        <span className={cn(LETTER, isKey ? LETTER_KEY : LETTER_IDLE)}>
                          {isKey ? <Icon name="check" size="sm" className="size-4" /> : L}
                          {isKey ? <span className="sr-only">{L}</span> : null}
                        </span>
                        <div className="min-w-0 flex-1 font-ms-serif">
                          <input
                            aria-label={`Option ${L}`}
                            className="w-full bg-transparent py-0.5 text-[16px] leading-6 text-ms-fg outline-none placeholder:text-ms-fg-3"
                            placeholder={`Option ${L}`}
                            value={val}
                            onChange={(e) => patch({ [field]: e.target.value } as Partial<Draft>)}
                            onFocus={(e) => { activeFieldRef.current = { el: e.currentTarget, setVal: (v) => patch({ [field]: v } as Partial<Draft>) }; }}
                          />
                        </div>
                        {isKey ? (
                          <Badge tone="positive" className="shrink-0">
                            Answer key · {L}
                          </Badge>
                        ) : null}
                      </div>
                      {/* The preview only when the choice carries math or markup: a plain choice reads as itself. */}
                      {hasMarkup(val) && (
                        <div className="ml-10 mt-2 rounded-[10px] bg-ms-surface px-3 py-2">
                          <MathText text={val} className="font-ms-serif text-[15px] leading-6 text-ms-fg" />
                        </div>
                      )}
                      <div className="ml-10 mt-2">
                        <ImageUploadField quiet {...imgProps(key, existing?.[`option_${key}_image` as keyof QbQuestionDetail] as string | null, `Option ${L}`)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Correct answer */}
            <div>
              <label htmlFor={id("answer")} className={FIELD_LABEL}>Correct answer</label>
              <input
                id={id("answer")}
                className={CONTROL}
                placeholder={isMC ? "A / B / C / D" : "e.g. 42 or 2/3, 0.667"}
                value={draft.correct_answer}
                onChange={(e) => patch({ correct_answer: e.target.value })}
              />
            </div>

            {/* Explanation */}
            <div>
              <label htmlFor={id("explanation")} className={FIELD_LABEL}>Explanation / rationale</label>
              <div className="font-ms-serif">
                <textarea
                  id={id("explanation")}
                  className={cn(SERIF_AREA, "min-h-[90px] text-[16px] leading-[26px]")}
                  value={draft.explanation}
                  onChange={(e) => patch({ explanation: e.target.value })}
                  onFocus={(e) => { activeFieldRef.current = { el: e.currentTarget, setVal: (v) => patch({ explanation: v }) }; }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
