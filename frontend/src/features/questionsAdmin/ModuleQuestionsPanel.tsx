"use client";

import * as React from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  examsModuleQuestionsApi,
  useCreateModuleQuestion,
  useDeleteModuleQuestion,
  useImportModuleQuestionsCsv,
  useModuleQuestionsQuery,
  useReorderModuleQuestionsBulk,
  useUpdateModuleQuestion,
  type ModuleQuestionsApi,
} from "@/features/questionsAdmin/hooks";
import type { AdminModuleQuestion } from "@/features/questionsAdmin/types";
import { DownloadQuestionsCsvButton } from "@/features/questionsAdmin/DownloadQuestionsCsvButton";
import { OutlineGhost, OutlineLegend, OutlineRow, detectMidtermFormat, type MidtermFormat } from "@/features/questionsAdmin/ModuleOutline";
import {
  bankSubjectForQuestionType,
  useSkillTaxonomyQuery,
} from "@/features/questionsAdmin/skillTaxonomy";
import { normalizeApiError } from "@/lib/apiError";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Button, EmptyState, buttonClass, prefersReducedMotion } from "@/features/console/ui";
import { cn } from "@/lib/cn";
import { STUDIO_FIELD_LABEL, STUDIO_INPUT } from "@/components/studio/primitives";
import { FormulaToolbar } from "@/components/FormulaToolbar";
import { MathText } from "@/components/MathText";
import {
  allowedQuestionTypesForSubject,
  getModuleProgress,
  questionTypeWarning,
  SAT_MODULE_SCORE_CAP,
  SAT_QUESTION_TYPE_LABEL,
  SAT_SUBJECT_LABEL,
  isSatSubject,
  type SatQuestionType,
  type SatSubject,
} from "@/lib/satRules";
import { getMidtermModuleProgress } from "@/lib/midtermRules";

// ─── Draft type ──────────────────────────────────────────────────────────────

type QuestionDraft = {
  question_type: "MATH" | "READING" | "WRITING";
  question_text: string;
  question_prompt: string;
  is_math_input: boolean;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  explanation: string;
  score: number;
  /** questionbank.BankSkill id; null = unclassified, which is always allowed. */
  skill: number | null;
  /** Only meaningful when examKind === "MIDTERM". */
  midtermFormat: MidtermFormat;
};

function questionToDraft(q: AdminModuleQuestion, sectionSubject?: string, examKind?: string): QuestionDraft {
  // Use existing type, but if it's wrong for the subject, fall back to the first allowed type.
  const allowed = allowedQuestionTypesForSubject(sectionSubject);
  const existingType = q.question_type ?? "MATH";
  const resolvedType = (allowed as readonly string[]).includes(existingType)
    ? existingType
    : allowed[0] ?? existingType;
  return {
    question_type: resolvedType as QuestionDraft["question_type"],
    question_text: q.question_text ?? "",
    question_prompt: q.question_prompt ?? "",
    is_math_input: q.is_math_input ?? false,
    option_a: q.option_a ?? "",
    option_b: q.option_b ?? "",
    option_c: q.option_c ?? "",
    option_d: q.option_d ?? "",
    correct_answer: q.correct_answer ?? "",
    explanation: q.explanation ?? "",
    score: q.score ?? 10,
    skill: q.skill ?? null,
    midtermFormat: examKind === "MIDTERM" ? detectMidtermFormat(q) : "mc",
  };
}

// Re-export canonical tokens under local aliases so the rest of this file
// uses concise names, while the source of truth lives in studio/primitives.ts.
const FIELD_LABEL = STUDIO_FIELD_LABEL;
const INPUT = STUDIO_INPUT;

// ─── Question editor pane ────────────────────────────────────────────────────

function QuestionEditor({
  question,
  testId,
  moduleId,
  api,
  sectionSubject,
  examKind,
  scoringScale,
  midtermLevel,
  onSaved,
  onDeleted,
}: {
  question: AdminModuleQuestion;
  testId: number;
  moduleId: number;
  api: ModuleQuestionsApi;
  /** PracticeTest.subject — drives SAT type restrictions */
  sectionSubject?: string;
  /** MockExam.kind — "MIDTERM" switches to pedagogical question formats */
  examKind?: string;
  /** SCALE_800 midterms use per-question weights (like SAT); SCALE_100 ignores them. */
  scoringScale?: "SCALE_100" | "SCALE_800";
  /** MockExam.midterm_level — a level with its own topic list is tagged from that list. */
  midtermLevel?: string;
  onSaved: (updated: AdminModuleQuestion) => void;
  onDeleted: () => void;
}) {
  const update = useUpdateModuleQuestion(testId, moduleId, api);
  const del = useDeleteModuleQuestion(testId, moduleId, api);
  const isMidterm = examKind === "MIDTERM";
  // SCALE_800 midterms feed the SAT 200–800 curve, which weights questions by
  // their `score`. Surface the weight selector for those; SCALE_100 stays equal-weight.
  const isScale800Midterm = isMidterm && scoringScale === "SCALE_800";

  const [draft, setDraft] = React.useState<QuestionDraft>(() => questionToDraft(question, sectionSubject, examKind));
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [saveOk, setSaveOk] = React.useState(false);

  type ImageKey = "question" | "a" | "b" | "c" | "d";
  const [imageFiles, setImageFiles] = React.useState<Partial<Record<ImageKey, File>>>({});
  const [clearImages, setClearImages] = React.useState<Partial<Record<ImageKey, boolean>>>({});

  // Reset draft when question changes
  React.useEffect(() => {
    setDraft(questionToDraft(question, sectionSubject, examKind));
    setSaveOk(false);
    setConfirmDelete(false);
    setImageFiles({});
    setClearImages({});
  }, [question.id, sectionSubject, examKind]);

  const patch = (p: Partial<QuestionDraft>) => setDraft((d) => ({ ...d, ...p }));

  const handleSave = async () => {
    setSaveOk(false);

    // Derive backend fields from midtermFormat when editing a midterm question.
    // The underlying model uses is_math_input + option_a/b/c/d regardless of format.
    const effectiveDraft = (() => {
      if (!isMidterm) return draft;
      const fmt = draft.midtermFormat;
      if (fmt === "numeric" || fmt === "short_text") {
        return { ...draft, is_math_input: true, option_a: "", option_b: "", option_c: "", option_d: "" };
      }
      if (fmt === "true_false") {
        return { ...draft, is_math_input: false, option_a: "True", option_b: "False", option_c: "", option_d: "" };
      }
      // mc — use draft as-is
      return { ...draft, is_math_input: false };
    })();

    const hasFiles = Object.keys(imageFiles).length > 0 || Object.values(clearImages).some(Boolean);
    let data: FormData | Record<string, unknown>;
    if (hasFiles) {
      const fd = new FormData();
      fd.append("question_type", effectiveDraft.question_type);
      fd.append("question_text", effectiveDraft.question_text);
      fd.append("question_prompt", effectiveDraft.question_prompt);
      fd.append("is_math_input", String(effectiveDraft.is_math_input));
      fd.append("option_a", effectiveDraft.option_a);
      fd.append("option_b", effectiveDraft.option_b);
      fd.append("option_c", effectiveDraft.option_c);
      fd.append("option_d", effectiveDraft.option_d);
      fd.append("correct_answer", effectiveDraft.correct_answer);
      fd.append("explanation", effectiveDraft.explanation);
      fd.append("score", String(effectiveDraft.score));
      // DRF reads "" from multipart as null for a nullable relation — that's the clear.
      fd.append("skill", effectiveDraft.skill == null ? "" : String(effectiveDraft.skill));
      if (imageFiles.question) fd.append("question_image", imageFiles.question);
      if (imageFiles.a) fd.append("option_a_image", imageFiles.a);
      if (imageFiles.b) fd.append("option_b_image", imageFiles.b);
      if (imageFiles.c) fd.append("option_c_image", imageFiles.c);
      if (imageFiles.d) fd.append("option_d_image", imageFiles.d);
      if (clearImages.question) fd.append("clear_question_image", "true");
      if (clearImages.a) fd.append("clear_option_a_image", "true");
      if (clearImages.b) fd.append("clear_option_b_image", "true");
      if (clearImages.c) fd.append("clear_option_c_image", "true");
      if (clearImages.d) fd.append("clear_option_d_image", "true");
      data = fd;
    } else {
      data = {
        question_type: effectiveDraft.question_type,
        question_text: effectiveDraft.question_text,
        question_prompt: effectiveDraft.question_prompt,
        is_math_input: effectiveDraft.is_math_input,
        option_a: effectiveDraft.option_a,
        option_b: effectiveDraft.option_b,
        option_c: effectiveDraft.option_c,
        option_d: effectiveDraft.option_d,
        correct_answer: effectiveDraft.correct_answer,
        explanation: effectiveDraft.explanation,
        score: effectiveDraft.score,
        skill: effectiveDraft.skill,
      };
    }
    try {
      const result = await update.mutateAsync({ questionId: question.id, data });
      setSaveOk(true);
      setImageFiles({});
      setClearImages({});
      onSaved(result as AdminModuleQuestion);
      setTimeout(() => setSaveOk(false), 2000);
    } catch {
      // error shown via update.error
    }
  };

  const handleDelete = async () => {
    try {
      await del.mutateAsync(question.id);
      onDeleted();
    } catch {
      // error shown via del.error
    }
  };

  // For midterms, whether choices are shown is derived from midtermFormat,
  // not from is_math_input (which is set on save, not during editing).
  const isMC = isMidterm
    ? (draft.midtermFormat === "mc" || draft.midtermFormat === "true_false")
    : !draft.is_math_input;
  const isBusy = update.isPending || del.isPending;

  // ── SAT subject awareness ──────────────────────────────────────────────────
  const allowedTypes = allowedQuestionTypesForSubject(sectionSubject);
  const typeWarning = questionTypeWarning(draft.question_type, sectionSubject);

  // ── Taxonomy picker ────────────────────────────────────────────────────────
  // The bank's skills are subject-scoped, so the list follows the question's own type
  // (READING and WRITING share one ENGLISH list). Blank stays a valid answer.
  // A midterm also passes its level: junior math is taught from the learning center's own
  // topic list, and the server answers with that list in place of the SAT skills.
  const bankSubject = bankSubjectForQuestionType(draft.question_type);
  const taxonomy = useSkillTaxonomyQuery(bankSubject, isMidterm ? midtermLevel : null);
  const taxonomyDomains = taxonomy.data ?? [];
  const isTopicList = taxonomyDomains.some((d) => !!d.level);
  // A skill saved before the question changed type is no longer in the fetched list;
  // keep showing its stored label rather than silently rendering "Unclassified". On a
  // topic list that is an SAT skill tagged before the list existed — it stays until the
  // author picks a topic, and says so.
  const skillIsOffList =
    draft.skill != null && !taxonomyDomains.some((d) => d.skills.some((s) => s.id === draft.skill));

  /** Switching bank subject invalidates the chosen skill — the server would 400 on it. */
  const patchQuestionType = (next: QuestionDraft["question_type"]) => {
    const keepSkill = bankSubjectForQuestionType(next) === bankSubject;
    patch({ question_type: next, ...(keepSkill ? {} : { skill: null }) });
  };

  const updateErr = update.isError && update.error ? normalizeApiError(update.error).message : null;
  const deleteErr = del.isError && del.error ? normalizeApiError(del.error).message : null;

  // ── Formula insertion ──────────────────────────────────────────────────────
  // Tracks whichever textarea/input currently has focus so the toolbar can
  // insert at the correct cursor position without needing to know the field.
  const activeFieldRef = React.useRef<{
    el: HTMLTextAreaElement | HTMLInputElement;
    setVal: (v: string) => void;
  } | null>(null);

  const handleFormulaInsert = React.useCallback(
    (snippet: string, cursorOffset: number) => {
      const active = activeFieldRef.current;
      if (!active) return;
      const { el, setVal } = active;
      // Read directly from el.value (not a React state closure) to get the
      // current value regardless of batched React updates.
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newVal = el.value.slice(0, start) + snippet + el.value.slice(end);
      const newCursorPos = start + cursorOffset;
      setVal(newVal);
      // Wait for React to flush the state update and repaint the DOM before
      // restoring focus + cursor — otherwise setSelectionRange runs on stale DOM.
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(newCursorPos, newCursorPos);
      });
    },
    [],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header — save button row (never scrolls) */}
      <div className="shrink-0 border-b border-border bg-card">
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-foreground">Q{question.order + 1} — #{question.id}</p>
            <p className="text-[10px] text-muted-foreground">Question editor</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {saveOk && (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Saved
              </span>
            )}
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {update.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Formula toolbar — always visible, never scrolls away */}
      <div className="shrink-0 border-b border-border bg-card">
        <div className="px-3 pt-2 pb-0">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1">
            Formula insert — click a symbol, then type in a field below
          </p>
        </div>
        <FormulaToolbar onInsert={handleFormulaInsert} />
      </div>

      {/* Error banners */}
      {(updateErr || deleteErr) && (
        <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 shrink-0">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{updateErr ?? deleteErr}</span>
        </div>
      )}

      {/* Scrollable form body */}
      <div className="flex-1 overflow-y-auto">
      <div className="space-y-5 p-5">

        {/* Type row — midterms use answer-format selector; SAT uses type + score */}
        {isMidterm ? (
          <div className={isScale800Midterm ? "grid grid-cols-2 gap-4" : ""}>
            <div>
              <label className={FIELD_LABEL}>Answer format</label>
              <select
                className={INPUT}
                value={draft.midtermFormat}
                onChange={(e) => patch({ midtermFormat: e.target.value as MidtermFormat })}
              >
                <option value="mc">Multiple choice (A / B / C / D)</option>
                <option value="numeric">Numeric (student enters a number)</option>
                <option value="short_text">Short text (student types an answer)</option>
                <option value="true_false">True / False</option>
              </select>
            </div>
            {/* 800-point midterms weight questions onto the SAT curve. */}
            {isScale800Midterm && (
              <div>
                <label className={FIELD_LABEL}>Score weight</label>
                <select
                  className={INPUT}
                  value={draft.score}
                  onChange={(e) => patch({ score: Number(e.target.value) })}
                >
                  <option value={10}>10 ball</option>
                  <option value={20}>20 ball</option>
                  <option value={40}>40 ball</option>
                </select>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={FIELD_LABEL}>Question type</label>
                <select
                  className={INPUT}
                  value={draft.question_type}
                  onChange={(e) => patchQuestionType(e.target.value as QuestionDraft["question_type"])}
                >
                  {allowedTypes.map((t) => (
                    <option key={t} value={t}>
                      {SAT_QUESTION_TYPE_LABEL[t as SatQuestionType] ?? t}
                    </option>
                  ))}
                </select>
                {/* SAT type mismatch warning */}
                {typeWarning && (
                  <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                    <p className="text-[11px] font-semibold leading-snug text-amber-800">{typeWarning}</p>
                  </div>
                )}
              </div>
              <div>
                <label className={FIELD_LABEL}>Score weight</label>
                <select
                  className={INPUT}
                  value={draft.score}
                  onChange={(e) => patch({ score: Number(e.target.value) })}
                >
                  <option value={10}>10 ball</option>
                  <option value={20}>20 ball</option>
                  <option value={40}>40 ball</option>
                </select>
              </div>
            </div>

            {/* Math input toggle — SAT only */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="is_math_input"
                checked={draft.is_math_input}
                onChange={(e) => patch({ is_math_input: e.target.checked })}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <label htmlFor="is_math_input" className="text-sm font-semibold text-foreground cursor-pointer select-none">
                Student types numeric answer (no A/B/C/D choices)
              </label>
            </div>
          </>
        )}

        {/* SAT skill, or the level's own topic — optional tag; feeds the student's report. */}
        <div>
          <label className={FIELD_LABEL}>{isTopicList ? "Topic (optional)" : "SAT skill (optional)"}</label>
          <select
            className={INPUT}
            value={draft.skill ?? ""}
            onChange={(e) => patch({ skill: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Unclassified</option>
            {skillIsOffList && (
              <option value={String(draft.skill)}>
                {question.skill_name || `Skill #${draft.skill}`}
                {question.domain_name ? ` (${question.domain_name})` : ""}
                {isTopicList ? " — not a topic of this list, pick one below" : ""}
              </option>
            )}
            {taxonomyDomains.map((d) => (
              <optgroup key={d.domain_id} label={d.domain}>
                {d.skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {taxonomy.isLoading
              ? "Loading skills…"
              : taxonomy.isError
              ? "Skill list unavailable — the question can still be saved unclassified."
              : taxonomyDomains.length === 0
              ? "No skills seeded for this subject yet."
              : isTopicList
              ? "The student sees this topic in their midterm report. Leave unclassified if unsure."
              : "Groups the question in the student's error report. Leave unclassified if unsure."}
          </p>
        </div>

        {/* Question text */}
        <div>
          <label className={FIELD_LABEL}>Question text (stem)</label>
          <textarea
            className={`${INPUT} min-h-[140px] leading-relaxed`}
            placeholder="Enter the full question text here. LaTeX math is supported: \( x^2 + 1 = 0 \)"
            value={draft.question_text}
            onChange={(e) => patch({ question_text: e.target.value })}
            onFocus={(e) => {
              activeFieldRef.current = {
                el: e.currentTarget,
                setVal: (v) => patch({ question_text: v }),
              };
            }}
          />
          {draft.question_text.trim() && (
            <div className="mt-2 rounded-xl border border-border/60 bg-surface-2/50 px-3 py-2.5">
              <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                Preview
              </p>
              <MathText text={draft.question_text} className="text-sm leading-relaxed text-foreground" />
            </div>
          )}
          {/* Question image */}
          <div className="mt-3">
            <label className={FIELD_LABEL}>Question image (optional)</label>
            <div className="mt-1 space-y-2">
              {question.question_image && !clearImages.question && !imageFiles.question && (
                <div className="flex items-center gap-2">
                  <img src={question.question_image} alt="Question" className="max-h-32 rounded-xl border border-border object-contain" />
                  <button
                    type="button"
                    onClick={() => setClearImages((c) => ({ ...c, question: true }))}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
                  >
                    <X className="h-3 w-3" /> Remove
                  </button>
                </div>
              )}
              {imageFiles.question && (
                <div className="flex items-center gap-2">
                  <img src={URL.createObjectURL(imageFiles.question)} alt="Preview" className="max-h-32 rounded-xl border border-border object-contain" />
                  <button
                    type="button"
                    onClick={() => setImageFiles((f) => { const n = { ...f }; delete n.question; return n; })}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-surface-2 transition-colors"
                  >
                    <X className="h-3 w-3" /> Cancel
                  </button>
                </div>
              )}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border bg-surface-2/30 px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-surface-2/60 transition-colors">
                <ImagePlus className="h-3.5 w-3.5" />
                {imageFiles.question ? "Change image" : question.question_image && !clearImages.question ? "Replace image" : "Upload image"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { setImageFiles((prev) => ({ ...prev, question: f })); setClearImages((c) => ({ ...c, question: false })); }
                  }}
                />
              </label>
            </div>
          </div>
        </div>

        {/* Secondary prompt */}
        <div>
          <label className={FIELD_LABEL}>Stimulus / passage excerpt (optional)</label>
          <textarea
            className={`${INPUT} min-h-[80px] leading-relaxed`}
            placeholder="Secondary text shown above the answer choices — e.g. a short passage excerpt or graph description."
            value={draft.question_prompt}
            onChange={(e) => patch({ question_prompt: e.target.value })}
            onFocus={(e) => {
              activeFieldRef.current = {
                el: e.currentTarget,
                setVal: (v) => patch({ question_prompt: v }),
              };
            }}
          />
        </div>

        {/* MC choices — True/False mode shows static True/False labels; regular MC shows editable A-D */}
        {isMC && draft.midtermFormat === "true_false" ? (
          <div className="rounded-2xl border border-border bg-surface-2/30 p-4">
            <p className={`${FIELD_LABEL} mb-3`}>Answer choices (True / False)</p>
            <div className="flex gap-3">
              {(["True", "False"] as const).map((label) => (
                <div
                  key={label}
                  className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-extrabold text-muted-foreground">
                    {label === "True" ? "A" : "B"}
                  </span>
                  {label}
                </div>
              ))}
            </div>
          </div>
        ) : isMC && (
          <div className="rounded-2xl border border-border bg-surface-2/30 p-4 space-y-3">
            <p className={FIELD_LABEL}>Answer choices</p>
            {(["a", "b", "c", "d"] as const).map((letter) => {
              const key = `option_${letter}` as keyof QuestionDraft;
              const val = draft[key] as string;
              return (
                <div key={letter} className="space-y-1">
                  <div className="flex items-start gap-3">
                    <div className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs font-extrabold text-foreground">
                      {letter.toUpperCase()}
                    </div>
                    <textarea
                      className={`${INPUT} flex-1 resize-none overflow-hidden`}
                      rows={1}
                      placeholder={`Option ${letter.toUpperCase()}`}
                      value={val}
                      ref={(el) => {
                        if (el) {
                          el.style.height = "auto";
                          el.style.height = `${el.scrollHeight}px`;
                        }
                      }}
                      onChange={(e) => {
                        patch({ [key]: e.target.value } as Partial<QuestionDraft>);
                        e.currentTarget.style.height = "auto";
                        e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                      }}
                      onFocus={(e) => {
                        activeFieldRef.current = {
                          el: e.currentTarget,
                          setVal: (v) => patch({ [key]: v } as Partial<QuestionDraft>),
                        };
                      }}
                    />
                  </div>
                  {val.trim() && (
                    <div className="ml-9 rounded-lg border border-border/50 bg-card px-2.5 py-1.5">
                      <MathText text={val} className="text-xs leading-relaxed text-foreground" />
                    </div>
                  )}
                  {/* Option image */}
                  <div className="ml-9 flex flex-wrap items-center gap-2">
                    {(() => {
                      const imgKey = letter as ImageKey;
                      const existingImg = question[`option_${letter}_image` as keyof typeof question] as string | null | undefined;
                      const file = imageFiles[imgKey];
                      const cleared = clearImages[imgKey];
                      return (
                        <>
                          {existingImg && !cleared && !file && (
                            <>
                              <img src={existingImg} alt={`Option ${letter.toUpperCase()}`} className="max-h-16 rounded-lg border border-border object-contain" />
                              <button
                                type="button"
                                onClick={() => setClearImages((c) => ({ ...c, [imgKey]: true }))}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
                              >
                                <X className="h-3 w-3" /> Remove
                              </button>
                            </>
                          )}
                          {file && (
                            <>
                              <img src={URL.createObjectURL(file)} alt="Preview" className="max-h-16 rounded-lg border border-border object-contain" />
                              <button
                                type="button"
                                onClick={() => setImageFiles((f) => { const n = { ...f }; delete n[imgKey]; return n; })}
                                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-surface-2 transition-colors"
                              >
                                <X className="h-3 w-3" /> Cancel
                              </button>
                            </>
                          )}
                          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border bg-surface-2/30 px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-surface-2/60 transition-colors">
                            <ImagePlus className="h-3 w-3" />
                            {file ? "Change" : existingImg && !cleared ? "Replace" : "Add image"}
                            <input
                              type="file"
                              accept="image/*"
                              className="sr-only"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) { setImageFiles((prev) => ({ ...prev, [imgKey]: f })); setClearImages((c) => ({ ...c, [imgKey]: false })); }
                              }}
                            />
                          </label>
                        </>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Correct answer — format-aware for midterms */}
        <div>
          {isMidterm && draft.midtermFormat === "true_false" ? (
            <>
              <label className={FIELD_LABEL}>Correct answer</label>
              <div className="flex gap-3 mt-1">
                {(["True", "False"] as const).map((label, i) => {
                  const letter = i === 0 ? "A" : "B";
                  const isSelected = draft.correct_answer.toUpperCase() === letter;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => patch({ correct_answer: letter })}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors ${
                        isSelected
                          ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                          : "border-border bg-card text-foreground hover:bg-surface-2"
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
                      {label}
                    </button>
                  );
                })}
              </div>
            </>
          ) : isMidterm && draft.midtermFormat === "mc" ? (
            <>
              <label className={FIELD_LABEL}>Correct answer</label>
              <div className="flex gap-2 mt-1">
                {(["A", "B", "C", "D"] as const).map((letter) => {
                  const isSelected = draft.correct_answer.toUpperCase() === letter;
                  return (
                    <button
                      key={letter}
                      type="button"
                      onClick={() => patch({ correct_answer: letter })}
                      className={`flex h-10 w-10 items-center justify-center rounded-xl border text-sm font-extrabold transition-colors ${
                        isSelected
                          ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                          : "border-border bg-card text-foreground hover:bg-surface-2"
                      }`}
                    >
                      {letter}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <label className={FIELD_LABEL}>
                {isMidterm && draft.midtermFormat === "numeric"
                  ? "Correct answer (number — separate multiple valid forms with commas)"
                  : isMidterm && draft.midtermFormat === "short_text"
                  ? "Correct answer (text — case-insensitive, comma-separated alternatives)"
                  : isMC
                  ? "Correct answer (A, B, C, or D)"
                  : "Correct answer (comma-separated for multiple valid forms, e.g. 2/3, 0.667)"}
              </label>
              <input
                className={INPUT}
                placeholder={
                  isMidterm && draft.midtermFormat === "numeric"
                    ? "e.g. 42 or 2/3, 0.667"
                    : isMidterm && draft.midtermFormat === "short_text"
                    ? "e.g. Paris or paris"
                    : isMC
                    ? "A"
                    : "e.g. 42 or 2/3, 0.666, 0.667"
                }
                value={draft.correct_answer}
                onChange={(e) => patch({ correct_answer: e.target.value })}
                onFocus={(e) => {
                  activeFieldRef.current = {
                    el: e.currentTarget,
                    setVal: (v) => patch({ correct_answer: v }),
                  };
                }}
              />
              {!isMidterm && isMC && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Must exactly match one of the choice letters above (case-insensitive).
                </p>
              )}
            </>
          )}
        </div>

        {/* Explanation */}
        <div>
          <label className={FIELD_LABEL}>Explanation / solution rationale</label>
          <textarea
            className={`${INPUT} min-h-[100px] leading-relaxed`}
            placeholder="Explain why the correct answer is right. Students see this after the test."
            value={draft.explanation}
            onChange={(e) => patch({ explanation: e.target.value })}
            onFocus={(e) => {
              activeFieldRef.current = {
                el: e.currentTarget,
                setVal: (v) => patch({ explanation: v }),
              };
            }}
          />
        </div>

        {/* Save button (bottom) */}
        <div className="flex items-center justify-between border-t border-border pt-4">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {update.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {update.isPending ? "Saving…" : "Save question"}
          </button>

          {/* Delete */}
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-red-700">Delete this question?</span>
              <button
                type="button"
                disabled={del.isPending}
                onClick={() => void handleDelete()}
                className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {del.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes, delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

// ─── The frame's pieces ──────────────────────────────────────────────────────

type NoticeTone = "positive" | "attention" | "critical";

const NOTICE: Record<NoticeTone, { box: string; icon: IconName }> = {
  positive: { box: "border-ms-positive-line bg-ms-positive-soft text-ms-positive-fg", icon: "ok" },
  attention: { box: "border-ms-attention-line bg-ms-attention-soft text-ms-attention-fg", icon: "warn" },
  critical: { box: "border-ms-critical-line bg-ms-critical-soft text-ms-critical-fg", icon: "alert" },
};

/** A line under the top bar in its verdict's soft tone; the words are the panel's own. */
function Notice({
  tone,
  title,
  children,
  onDismiss,
}: {
  tone: NoticeTone;
  title?: string;
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const look = NOTICE[tone];
  return (
    <div
      role={tone === "positive" ? "status" : "alert"}
      className={cn("animate-ms-fade-in flex items-start gap-2.5 rounded-ms-ctl border px-3.5 py-2.5 text-[14px] leading-5", look.box)}
    >
      <Icon name={look.icon} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? "mt-0.5" : undefined}>{children}</div>
      </div>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="ms-transition -m-1 rounded-[8px] p-1 opacity-70 hover:opacity-100">
          <Icon name="x" size="sm" />
        </button>
      ) : null}
    </div>
  );
}

/** The section's subject in its colour, as the Builder shows it everywhere. */
const SUBJECT_CHIP: Record<string, { icon: IconName; look: string; label: string }> = {
  MATH: { icon: "sigma", look: "bg-ms-math-soft text-ms-math-fg", label: "Mathematics" },
  READING_WRITING: { icon: "book", look: "bg-ms-rw-soft text-ms-rw-fg", label: "Reading & Writing" },
};

const EYEBROW = "text-ms-over uppercase text-ms-fg-3";

/** "Others slide 200 ms", and the drop settles on the same curve; nothing moves for reduced motion. */
const DROP: DropAnimation = {
  duration: 200,
  easing: "cubic-bezier(.2,.8,.2,1)",
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0" } } }),
};

// ─── Main panel ──────────────────────────────────────────────────────────────

/**
 * The module editor (design handoff v0.3, PR 14a): the whole window, no sidebar — a top bar with the way
 * back, the module and its actions; the outline on the left (the module's health, then every question,
 * dragged or ⌥↑ / ⌥↓ to reorder); the question open in the middle. The Builder's corners and colours.
 */
export default function ModuleQuestionsPanel(props: {
  testId: number;
  moduleId: number;
  /** Optional pack/exam context — enriches the top-bar breadcrumb. */
  packId?: number;
  packTitle?: string;
  sectionSubject?: string;
  moduleOrder?: string;
  /** Override the "back" link destination. Default: /builder/pastpapers */
  backHref?: string;
  /** Override the "back" link label. Default: "Past papers" */
  backLabel?: string;
  /** MockExam.kind — "MIDTERM" enables pedagogical question formats */
  examKind?: string;
  /** MockExam.midterm_scoring_scale — SCALE_800 exposes per-question weights. */
  scoringScale?: "SCALE_100" | "SCALE_800";
  /** MockExam.midterm_module_question_limit — per-module cap for midterms (default 30). */
  midtermModuleQuestionLimit?: number | null;
  /** MockExam.midterm_level — picks the level's own topic list when it has one. */
  midtermLevel?: string;
  /** Backend adapter. Default = exams practice-test API; full mocks pass a mocks adapter. */
  api?: ModuleQuestionsApi;
}) {
  const { testId, moduleId, packTitle, sectionSubject, moduleOrder, backHref, backLabel, examKind, scoringScale, midtermModuleQuestionLimit, midtermLevel } = props;
  const api = props.api ?? examsModuleQuestionsApi;

  const {
    data: questions = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useModuleQuestionsQuery(testId, moduleId, api);

  const create = useCreateModuleQuestion(testId, moduleId, api);
  const reorderBulk = useReorderModuleQuestionsBulk(testId, moduleId, api);
  const importCsv = useImportModuleQuestionsCsv(testId, moduleId, api);
  const csvInputRef = React.useRef<HTMLInputElement | null>(null);
  const [csvMsg, setCsvMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const handleCsvFile = async (file: File | null) => {
    if (!file) return;
    setCsvMsg(null);
    try {
      const res = await importCsv.mutateAsync(file);
      const n = res.created_count;
      setCsvMsg({ ok: true, text: `Imported ${n} question${n === 1 ? "" : "s"} from CSV.` });
    } catch (e: unknown) {
      const data = (e as { response?: { data?: { detail?: string; errors?: Array<{ row?: number; errors?: Record<string, unknown> }> } } })?.response?.data;
      let text = normalizeApiError(e).message;
      if (data?.detail) {
        text = data.detail;
        const first = Array.isArray(data.errors) ? data.errors[0] : undefined;
        if (first?.row && first.errors && typeof first.errors === "object") {
          const [field, msgs] = Object.entries(first.errors)[0] ?? [];
          const msg = Array.isArray(msgs) ? String(msgs[0]) : String(msgs ?? "");
          text = `Row ${first.row}${field ? ` · ${field}` : ""}: ${msg || data.detail}`;
        }
      }
      setCsvMsg({ ok: false, text });
    } finally {
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  const [selectedId, setSelectedId] = React.useState<number | null>(null);

  // ── Local optimistic ordering state ──────────────────────────────────────
  // The local order is updated immediately on drag-end (optimistic); the
  // single bulk-reorder API call reconciles the server in one round-trip.
  const [localOrder, setLocalOrder] = React.useState<number[]>([]);

  React.useEffect(() => {
    // Only sync from server when no reorder mutation is in flight.
    if (reorderBulk.isPending) return;
    setLocalOrder(questions.map((q) => q.id));
  }, [questions, reorderBulk.isPending]);

  // Derived: questions ordered by localOrder (falls back to server order)
  const orderedQuestions = React.useMemo(() => {
    if (localOrder.length === 0) return questions;
    const byId = new Map(questions.map((q) => [q.id, q]));
    return localOrder.map((id) => byId.get(id)).filter(Boolean) as AdminModuleQuestion[];
  }, [localOrder, questions]);

  // Auto-select first question when list loads
  React.useEffect(() => {
    if (questions.length > 0 && selectedId === null) {
      setSelectedId(questions[0].id);
    }
  }, [questions, selectedId]);

  const selectedQ = orderedQuestions.find((q) => q.id === selectedId) ?? null;

  // ── DnD sensors ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  // Read once: the lift, the slide and the drop all stand still for someone who asked for less motion.
  const [reduceMotion] = React.useState(prefersReducedMotion);

  const [activeId, setActiveId] = React.useState<number | null>(null);
  const activeQ = activeId != null
    ? orderedQuestions.find((q) => q.id === activeId) ?? null
    : null;
  const activeIndex = activeId != null ? orderedQuestions.findIndex((q) => q.id === activeId) : -1;

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveId(Number(event.active.id));
  }, []);

  const handleDragEnd = React.useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over || active.id === over.id) return;

      const fromIdx = localOrder.indexOf(Number(active.id));
      const toIdx = localOrder.indexOf(Number(over.id));
      if (fromIdx === -1 || toIdx === -1) return;

      // Optimistic update — immediate visual feedback before the API responds.
      const newOrder = arrayMove(localOrder, fromIdx, toIdx);
      setLocalOrder(newOrder);

      // Single atomic bulk-reorder: one round-trip, one invalidation. A failure shows as the reorder
      // notice and the list goes back to the server's order.
      await reorderBulk.mutateAsync(newOrder).catch(() => undefined);
    },
    [localOrder, reorderBulk],
  );

  // ── ⌥↑ / ⌥↓: the drag without a mouse ───────────────────────────────────
  // The same optimistic move and the same single save; the moved row keeps the keyboard focus (the
  // browser drops it when React moves the node) and a polite line says where it went.
  const rowRefs = React.useRef(new Map<number, HTMLButtonElement>());
  const focusAfterMove = React.useRef<number | null>(null);
  const [moveNote, setMoveNote] = React.useState("");

  React.useEffect(() => {
    const id = focusAfterMove.current;
    if (id == null) return;
    focusAfterMove.current = null;
    rowRefs.current.get(id)?.focus();
  }, [orderedQuestions]);

  const handleMove = React.useCallback(
    (id: number, delta: -1 | 1) => {
      if (reorderBulk.isPending) return;
      const fromIdx = localOrder.indexOf(id);
      const toIdx = fromIdx + delta;
      if (fromIdx === -1 || toIdx < 0 || toIdx >= localOrder.length) return;
      const newOrder = arrayMove(localOrder, fromIdx, toIdx);
      focusAfterMove.current = id;
      setLocalOrder(newOrder);
      setMoveNote(`Q${fromIdx + 1} moved to position ${toIdx + 1} of ${newOrder.length}.`);
      void reorderBulk.mutateAsync(newOrder).catch(() => undefined);
    },
    [localOrder, reorderBulk],
  );

  const listErrMsg = isError && error ? normalizeApiError(error).message : null;
  const reorderErrMsg =
    reorderBulk.isError && reorderBulk.error ? normalizeApiError(reorderBulk.error).message : null;
  const createErrMsg =
    create.isError && create.error ? normalizeApiError(create.error).message : null;

  const mutationBusy = create.isPending || reorderBulk.isPending;

  // ── Score calculator ──────────────────────────────────────────────────────
  const totalScore = React.useMemo(
    () => questions.reduce((sum, q) => sum + (q.score ?? 10), 0),
    [questions],
  );

  // ── Module question progress ────────────────────────────────────────────────
  // Computed before handleAdd so `atCapacity` is in scope for the guard.
  // Midterms use their own builder-configurable per-module cap (default 30);
  // full SAT sections use the official 22/27 per-subject counts.
  const isMidtermPanel = examKind === "MIDTERM";
  const progress = isMidtermPanel
    ? getMidtermModuleProgress(questions.length, midtermModuleQuestionLimit)
    : getModuleProgress(questions.length, sectionSubject);
  const moduleOrderNum = (() => {
    const match = moduleOrder?.match(/\d+/);
    return match ? Number(match[0]) : 1;
  })();
  // Count questions with wrong type for the subject
  const allowedTypesForSubject = allowedQuestionTypesForSubject(sectionSubject);
  const typeMismatchIds = new Set(
    questions
      .filter((q) => !allowedTypesForSubject.includes(q.question_type as SatQuestionType))
      .map((q) => q.id),
  );
  const isSat = isSatSubject(sectionSubject ?? "") && !isMidtermPanel;
  // Show the "X / N" question counter for any capped module (SAT or midterm).
  const hasQuestionLimit = isSat || isMidtermPanel;
  // True when the module is at or over its question limit — adding is blocked.
  const atCapacity =
    hasQuestionLimit && progress.required !== null && questions.length >= progress.required;

  const handleAdd = async () => {
    // Guard: never fire when the module is already at SAT capacity.
    // The button is disabled at this point, but this protects against stale clicks.
    if (atCapacity) return;
    const result = await create.mutateAsync();
    if (result && typeof result === "object" && "id" in result) {
      setSelectedId((result as AdminModuleQuestion).id);
    }
  };

  const subject = sectionSubject ? SUBJECT_CHIP[sectionSubject] : undefined;
  const subjectWord = sectionSubject === "MATH" ? "Mathematics" : "Reading & Writing";
  const countTone = hasQuestionLimit
    ? progress.complete
      ? "font-semibold text-ms-positive-fg"
      : progress.over
        ? "font-semibold text-ms-critical-fg"
        : "text-ms-fg-2"
    : "text-ms-fg-2";

  // ── The module card at the top of the outline ───────────────────────────
  const showPoints = !isLoading && questions.length > 0;
  const showHealth = isSat && !isLoading;
  const points = (() => {
    if (!showPoints) return null;
    if (isMidtermPanel) {
      const is800 = scoringScale === "SCALE_800";
      return (
        // The scale's name takes the card's whole width; the count, the rule and the maximum sit under it.
        <div className="flex flex-col gap-2">
          <p className={EYEBROW}>Midterm scoring · {is800 ? "800-point (SAT scaled)" : "100-point (percentage)"}</p>
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-ms-ctl bg-ms-primary-soft text-[15px] font-bold text-ms-primary-text">
              {is800 ? "Σ" : "%"}
            </span>
            <p className="min-w-0 flex-1 text-[14px] font-semibold leading-5 text-ms-fg">
              {questions.length} question{questions.length !== 1 ? "s" : ""} ·{" "}
              <span className="font-normal text-ms-fg-2">
                {is800 ? `${totalScore} pts → SAT 200–800 curve` : `score = correct ÷ ${questions.length} × 100`}
              </span>
            </p>
            <div className="shrink-0 text-right">
              <p className={EYEBROW}>Max</p>
              <p className="font-ms-display text-[20px] font-bold leading-7 tabular-nums text-ms-primary-text">{is800 ? 800 : 100}</p>
            </div>
          </div>
        </div>
      );
    }
    const moduleCap = isSat && sectionSubject
      ? SAT_MODULE_SCORE_CAP[sectionSubject as SatSubject]?.[moduleOrderNum as 1 | 2] ?? null
      : null;
    const remainingPts = moduleCap !== null ? Math.max(0, moduleCap - totalScore) : null;
    return (
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-ms-ctl bg-ms-primary-soft text-ms-primary-text">
          <Icon name="sigma" size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={EYEBROW}>Module points</p>
          <p className="font-ms-display text-[20px] font-bold leading-7 tabular-nums text-ms-fg">
            {totalScore}
            {moduleCap !== null && <span className="text-[14px] font-semibold text-ms-fg-3"> / {moduleCap}</span>}
          </p>
        </div>
        {remainingPts !== null && remainingPts > 0 && (
          <div className="shrink-0 text-right">
            <p className="text-ms-over uppercase text-ms-attention-fg">Remaining</p>
            <p className="text-[18px] font-bold leading-7 tabular-nums text-ms-attention-fg">
              +{remainingPts}
              <span className="ml-1 text-[11px] font-semibold">pts</span>
            </p>
          </div>
        )}
        {remainingPts !== null && remainingPts <= 0 && <p className="shrink-0 text-ms-over uppercase text-ms-positive-fg">✓ Complete</p>}
      </div>
    );
  })();

  const health = showHealth ? (
    <div className={cn("flex flex-col gap-2", points && "border-t border-ms-line pt-3")}>
      <p className={EYEBROW}>
        {sectionSubject ? SAT_SUBJECT_LABEL[sectionSubject as keyof typeof SAT_SUBJECT_LABEL] ?? sectionSubject : "Section"} · {moduleOrder ?? `Module ${moduleOrderNum}`}
      </p>
      {/* The bar and the count it measures, side by side. */}
      <div className="flex items-center gap-3">
        {progress.required !== null && (
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ms-surface-3">
            <div
              className={cn("ms-transition h-full rounded-full", progress.complete ? "bg-ms-positive" : progress.over ? "bg-ms-critical" : "bg-ms-primary")}
              style={{ width: `${Math.min((progress.fraction ?? 0) * 100, 100)}%` }}
            />
          </div>
        )}
        <span className={cn("ml-auto shrink-0 text-[13px] font-semibold tabular-nums", progress.complete ? "text-ms-positive-fg" : progress.over ? "text-ms-critical-fg" : "text-ms-fg")}>
          {progress.label}
          {progress.required !== null && " questions"}
        </span>
      </div>
      {progress.required !== null && !progress.complete && (
        <p className="text-[13px] leading-[18px] text-ms-fg-2">
          {progress.over
            ? `${progress.current - (progress.required ?? 0)} question(s) over the required ${progress.required}. Remove extras before publishing.`
            : `${(progress.required ?? 0) - progress.current} more question(s) needed to reach the required ${progress.required}.`}
        </p>
      )}
      {typeMismatchIds.size > 0 && (
        <div className="flex items-start gap-2 rounded-[10px] border border-ms-attention-line bg-ms-attention-soft px-2.5 py-2 text-ms-attention-fg">
          <Icon name="warn" size="sm" className="mt-px size-3.5" />
          <p className="text-[13px] font-medium leading-[18px]">
            {typeMismatchIds.size} question{typeMismatchIds.size !== 1 ? "s have" : " has"} the wrong type for this{" "}
            {subjectWord} module.
            Allowed types: {allowedTypesForSubject.join(", ")}.
          </p>
        </div>
      )}
      {progress.complete && typeMismatchIds.size === 0 && (
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-ms-positive-fg">
          <Icon name="ok" size="sm" className="size-3.5" />
          Module is structurally valid — ready to publish.
        </p>
      )}
    </div>
  ) : null;

  return (
    <div className="ms flex min-h-dvh flex-col lg:h-dvh" data-ms-temp="builder">
      {/* Top bar: the way back, the module, its actions (Shell board, "Builder editor · full-screen"). */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-ms-border bg-ms-card px-3 py-2.5 sm:px-4 lg:min-h-16 lg:px-5">
        <Link href={backHref ?? `/builder/pastpapers`} className={buttonClass({ variant: "ghost", size: "sm", className: "-ml-1" })}>
          <Icon name="left" size="sm" />
          {backLabel ?? "Past papers"}
        </Link>
        <span aria-hidden className="h-6 w-px shrink-0 bg-ms-border-strong max-sm:hidden" />
        {/* On a phone the module takes its own line under the way back, and the actions the next. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 max-sm:basis-full">
          {packTitle ? (
            <span className="max-w-[280px] truncate text-[14px] font-medium text-ms-fg-2" title={packTitle}>
              {packTitle}
            </span>
          ) : null}
          {subject ? (
            <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-ms-chip px-2 text-[12px] font-semibold", subject.look)}>
              <Icon name={subject.icon} size="sm" className="size-3.5" />
              {subject.label}
            </span>
          ) : (
            <span className="text-[14px] font-medium text-ms-fg-2">Test #{testId}</span>
          )}
          <h1 className="font-ms-display text-[17px] font-bold leading-6 tracking-[-0.01em] text-ms-fg">{moduleOrder ?? `Module #${moduleId}`}</h1>
          <span className={cn("text-[13px] tabular-nums", countTone)}>
            {isLoading
              ? "Loading…"
              : hasQuestionLimit
                ? `${progress.label} questions`
                : `${questions.length} question${questions.length !== 1 ? "s" : ""}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => void handleCsvFile(e.target.files?.[0] ?? null)}
          />
          <Button
            variant="secondary"
            size="sm"
            icon="upload"
            state={importCsv.isPending ? "busy" : "idle"}
            onClick={() => csvInputRef.current?.click()}
            disabled={atCapacity}
            title={atCapacity ? "This module is already full." : "Append questions from a CSV file"}
          >
            Import CSV
          </Button>
          {/* The WHOLE test, not this module — a reviewer wants one file with every
              question and its key. Renders only for super_admin; the endpoint 403s for
              anyone else. */}
          <DownloadQuestionsCsvButton
            look="console"
            fetchCsv={() => api.exportCsv(testId)}
            fallbackName={`${api.source}-${testId}-questions`}
            title="Download every question on this test, with its answer key"
          />
          <Button variant="secondary" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <Icon name="refresh" size="sm" className={isFetching ? "animate-ms-spin" : undefined} />
            Refresh
          </Button>
          {atCapacity ? (
            <>
              <span className="text-[13px] font-medium text-ms-fg-3">
                Module full ({progress.required}/{progress.required})
              </span>
              <Button
                variant="primary"
                size="sm"
                icon="plus"
                disabled
                title={`This module already has the maximum ${progress.required} questions for a ${subjectWord} module.`}
              >
                Add question
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              icon="plus"
              state={create.isPending ? "busy" : "idle"}
              disabled={reorderBulk.isPending}
              onClick={() => void handleAdd()}
            >
              Add question
            </Button>
          )}
        </div>
      </header>

      {csvMsg || listErrMsg || reorderErrMsg || createErrMsg ? (
        <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 sm:px-4 lg:px-5">
          {csvMsg ? (
            <Notice tone={csvMsg.ok ? "positive" : "critical"} onDismiss={() => setCsvMsg(null)}>
              {csvMsg.text}
            </Notice>
          ) : null}
          {listErrMsg ? (
            <Notice tone="critical" title="Could not load questions">
              {listErrMsg}
            </Notice>
          ) : null}
          {reorderErrMsg || createErrMsg ? <Notice tone="attention">{reorderErrMsg ?? createErrMsg}</Notice> : null}
        </div>
      ) : null}

      <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:flex-row">
        {/* Left: the outline — the module's health, then its questions in order. */}
        <aside
          aria-label="Questions in this module"
          className="flex shrink-0 flex-col border-ms-border bg-ms-card max-lg:max-h-[60vh] max-lg:overflow-y-auto max-lg:border-b lg:w-[300px] lg:border-r"
        >
          {points || health ? (
            <section aria-label="Module" className="animate-ms-fade-in mx-3 mt-3 flex shrink-0 flex-col gap-3 rounded-ms-ctl bg-ms-surface p-3.5">
              {points}
              {health}
            </section>
          ) : null}

          <div className="flex flex-col gap-1 p-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {isLoading ? (
              <div aria-busy="true" aria-label="Loading questions" className="flex flex-col gap-1.5 p-1">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-[62px] animate-ms-shimmer rounded-[12px] bg-ms-surface-2" />
                ))}
              </div>
            ) : orderedQuestions.length === 0 ? (
              <EmptyState icon="ms-question" title="No questions yet" detail="Click “Add question” to create the first one." />
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragCancel={() => setActiveId(null)}
                onDragEnd={(e) => { void handleDragEnd(e); }}
              >
                <SortableContext
                  items={localOrder}
                  strategy={verticalListSortingStrategy}
                >
                  {orderedQuestions.map((q, i) => (
                    <OutlineRow
                      key={q.id}
                      q={q}
                      index={i}
                      selected={q.id === selectedId}
                      reordering={reorderBulk.isPending}
                      wrongType={typeMismatchIds.has(q.id)}
                      examKind={examKind}
                      reduceMotion={reduceMotion}
                      onSelect={() => setSelectedId(q.id)}
                      onMove={(delta) => handleMove(q.id, delta)}
                      rowRef={(el) => {
                        if (el) rowRefs.current.set(q.id, el);
                        else rowRefs.current.delete(q.id);
                      }}
                    />
                  ))}
                </SortableContext>

                {/* The lifted question, under the pointer. */}
                <DragOverlay dropAnimation={reduceMotion ? null : DROP}>
                  {activeQ ? (
                    <OutlineGhost q={activeQ} index={activeIndex} examKind={examKind} wrongType={typeMismatchIds.has(activeQ.id)} />
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}

            {/* Reorder in-progress indicator */}
            {reorderBulk.isPending && (
              <div className="animate-ms-fade-in mt-1 flex items-center gap-1.5 rounded-[10px] bg-ms-surface-2 px-3 py-2 text-[13px] font-medium text-ms-fg-2">
                <Icon name="loader" size="sm" className="size-3.5 animate-ms-spin" />
                Saving order…
              </div>
            )}
            <p aria-live="polite" className="sr-only">
              {moveNote}
            </p>
          </div>

          {!isLoading && orderedQuestions.length > 0 ? <OutlineLegend /> : null}
        </aside>

        {/* Centre: the open question. Its insides keep their own look until PR 14b. */}
        <main className="min-w-0 p-3 sm:p-4 lg:min-h-0 lg:flex-1 lg:p-5">
          <div className="overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1 lg:h-full">
            {isLoading ? (
              <div aria-hidden className="flex flex-col gap-4 p-6">
                <div className="h-6 w-48 animate-ms-shimmer rounded-[8px] bg-ms-surface-2" />
                <div className="h-36 animate-ms-shimmer rounded-ms-ctl bg-ms-surface-2" />
                <div className="h-24 animate-ms-shimmer rounded-ms-ctl bg-ms-surface-2" />
              </div>
            ) : selectedQ ? (
              <div className="font-serif text-[16px] leading-[1.6] text-foreground lg:h-full">
                <QuestionEditor
                  key={selectedQ.id}
                  question={selectedQ}
                  testId={testId}
                  moduleId={moduleId}
                  api={api}
                  sectionSubject={sectionSubject}
                  examKind={examKind}
                  scoringScale={scoringScale}
                  midtermLevel={midtermLevel}
                  onSaved={(updated) => {
                    setSelectedId(updated.id);
                  }}
                  onDeleted={() => {
                    const remainingIds = orderedQuestions
                      .filter((q) => q.id !== selectedQ.id)
                      .map((q) => q.id);
                    setSelectedId(remainingIds[0] ?? null);
                  }}
                />
              </div>
            ) : (
              <EmptyState
                icon="plus"
                title="No question selected"
                detail="Select a question from the list, or add a new one."
                action={
                  <Button
                    variant="primary"
                    icon="plus"
                    disabled={mutationBusy || atCapacity}
                    onClick={() => void handleAdd()}
                    title={atCapacity ? `Module is at capacity (${progress.required} questions max)` : undefined}
                  >
                    Add first question
                  </Button>
                }
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
