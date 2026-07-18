"use client";

/**
 * /builder/full-mocks/[mockId] — Full Mock editor.
 *
 * Edit the mock's title/break, publish/unpublish, and author questions per
 * module. The four modules are grouped by section (Reading & Writing first,
 * then Math). Questions reuse the exams `AdminQuestionSerializer` shape.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  Calculator,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  mocksAdminApi,
  type AdminMockModule,
  type MockSubject,
} from "@/features/mocksAdmin/api";
import type { AdminModuleQuestion } from "@/features/questionsAdmin/types";
import { StateTag } from "@/components/governance";
import { ConfirmDialog } from "@/features/classroom/ui";
import { useToast } from "@/components/ToastProvider";
import { MathText } from "@/components/MathText";
import { FormulaToolbar } from "@/components/FormulaToolbar";
import { STUDIO_FIELD_LABEL, STUDIO_INPUT } from "@/components/studio/primitives";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseError(e: unknown): string {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (data) {
    if (typeof data === "string") return data;
    if (typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (typeof d.detail === "string") return d.detail;
      if (Array.isArray(d.non_field_errors)) return d.non_field_errors.join(" ");
      const parts = Object.entries(d)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : String(v)}`)
        .join(" ");
      if (parts) return parts;
    }
  }
  return (e as { message?: string })?.message || "Something went wrong.";
}

function subjectLabel(subject: string): string {
  return subject === "MATH" ? "Math" : "Reading & Writing";
}

const mockKey = (id: number) => ["mocks", "admin", "detail", id] as const;
const questionsKey = (mockId: number, moduleId: number) =>
  ["mocks", "admin", "questions", mockId, moduleId] as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FullMockEditorPage() {
  const params = useParams<{ mockId: string }>();
  const mockId = Number(params.mockId);
  const qc = useQueryClient();
  const toast = useToast();

  const { data: mock, isLoading, error } = useQuery({
    queryKey: mockKey(mockId),
    queryFn: () => mocksAdminApi.getMock(mockId),
    enabled: Number.isFinite(mockId) && mockId > 0,
  });

  const invalidateMock = () => qc.invalidateQueries({ queryKey: mockKey(mockId) });

  // ── Title / break editing ──
  const [title, setTitle] = useState("");
  const [breakMinutes, setBreakMinutes] = useState<number>(10);
  useEffect(() => {
    if (mock) {
      setTitle(mock.title ?? "");
      setBreakMinutes(mock.break_minutes ?? 10);
    }
  }, [mock]);

  const dirty = !!mock && (title.trim() !== (mock.title ?? "") || breakMinutes !== mock.break_minutes);

  const saveMeta = useMutation({
    mutationFn: () =>
      mocksAdminApi.updateMock(mockId, { title: title.trim(), break_minutes: breakMinutes }),
    onSuccess: () => {
      toast.push({ message: "Mock details saved.", tone: "success" });
      void invalidateMock();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  const publishMut = useMutation({
    mutationFn: () => mocksAdminApi.publishMock(mockId),
    onSuccess: () => {
      toast.push({ message: "Mock published.", tone: "success" });
      void invalidateMock();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });
  const unpublishMut = useMutation({
    mutationFn: () => mocksAdminApi.unpublishMock(mockId),
    onSuccess: () => {
      toast.push({ message: "Mock unpublished.", tone: "success" });
      void invalidateMock();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  // ── Selected module ──
  const [selectedModuleId, setSelectedModuleId] = useState<number | null>(null);
  const modules = useMemo(() => {
    const out: { module: AdminMockModule; subject: MockSubject }[] = [];
    for (const section of mock?.sections ?? []) {
      for (const m of section.modules) out.push({ module: m, subject: section.subject });
    }
    return out;
  }, [mock]);

  useEffect(() => {
    if (selectedModuleId == null && modules.length > 0) {
      setSelectedModuleId(modules[0].module.id);
    }
  }, [modules, selectedModuleId]);

  const selected = modules.find((m) => m.module.id === selectedModuleId);

  if (!Number.isFinite(mockId) || mockId <= 0) {
    return <div className="p-8 text-sm text-red-700">Invalid mock id.</div>;
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !mock) {
    return (
      <div className="space-y-4">
        <Link href="/builder/full-mocks" className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to full mocks
        </Link>
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error ? parseError(error) : "Mock not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Back link */}
      <Link
        href="/builder/full-mocks"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to full mocks
      </Link>

      {/* Header card */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <StateTag state={mock.is_published ? "PUBLISHED" : "DRAFT"} size="sm" />
            <span className="text-xs text-muted-foreground">
              {mock.question_count} question{mock.question_count !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {mock.is_published ? (
              <button
                type="button"
                onClick={() => unpublishMut.mutate()}
                disabled={unpublishMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
              >
                {unpublishMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
                Unpublish
              </button>
            ) : (
              <button
                type="button"
                onClick={() => publishMut.mutate()}
                disabled={publishMut.isPending || !mock.publish_ready}
                title={!mock.publish_ready ? mock.publish_block_reason : "Publish this mock"}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
              >
                {publishMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                Publish
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label className={STUDIO_FIELD_LABEL}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={STUDIO_INPUT} />
          </div>
          <div className="w-32">
            <label className={STUDIO_FIELD_LABEL}>Break (min)</label>
            <input
              type="number"
              min={0}
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(Math.max(0, Number(e.target.value) || 0))}
              className={STUDIO_INPUT}
            />
          </div>
          <button
            type="button"
            onClick={() => saveMeta.mutate()}
            disabled={!dirty || !title.trim() || saveMeta.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saveMeta.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save details
          </button>
        </div>

        {!mock.is_published && !mock.publish_ready && mock.publish_block_reason && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {mock.publish_block_reason}
          </div>
        )}
      </div>

      {/* Section / module picker */}
      <div className="space-y-3">
        {mock.sections.map((section) => (
          <div key={section.subject}>
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <div
                className={`rounded-md p-1 ${section.subject === "MATH" ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary"}`}
              >
                {section.subject === "MATH" ? <Calculator className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
              </div>
              <span className="text-xs font-bold text-foreground">{subjectLabel(section.subject)}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {section.modules.map((m) => {
                const active = m.id === selectedModuleId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedModuleId(m.id)}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border bg-card hover:border-primary/30 hover:bg-primary/5"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-foreground">Module {m.module_order}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {m.time_limit_minutes} min · {m.question_count} question
                        {m.question_count !== 1 ? "s" : ""}
                      </p>
                    </div>
                    {active && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Question editor for the selected module */}
      {selected && (
        <ModuleQuestionsEditor
          key={selected.module.id}
          mockId={mockId}
          module={selected.module}
          subject={selected.subject}
        />
      )}
    </div>
  );
}

// ─── Module questions editor ────────────────────────────────────────────────

function ModuleQuestionsEditor({
  mockId,
  module,
  subject,
}: {
  mockId: number;
  module: AdminMockModule;
  subject: MockSubject;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const moduleId = module.id;

  const { data: questions, isLoading } = useQuery({
    queryKey: questionsKey(mockId, moduleId),
    queryFn: () => mocksAdminApi.listModuleQuestions(mockId, moduleId),
  });
  const list = questions ?? [];

  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminModuleQuestion | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: questionsKey(mockId, moduleId) });
    void qc.invalidateQueries({ queryKey: mockKey(mockId) });
  };

  const addMut = useMutation({
    mutationFn: () => mocksAdminApi.createModuleQuestion(mockId, moduleId, {}),
    onSuccess: (q) => {
      invalidate();
      setEditingId(q.id);
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  const deleteMut = useMutation({
    mutationFn: (qid: number) => mocksAdminApi.deleteModuleQuestion(mockId, moduleId, qid),
    onSuccess: () => {
      setPendingDelete(null);
      toast.push({ message: "Question deleted.", tone: "success" });
      invalidate();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  const reorderMut = useMutation({
    mutationFn: (orderedIds: number[]) =>
      mocksAdminApi.reorderModuleQuestions(mockId, moduleId, orderedIds),
    onSuccess: () => invalidate(),
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  const move = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= list.length) return;
    const ids = list.map((q) => q.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    reorderMut.mutate(ids);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-extrabold text-foreground">
            {subjectLabel(subject)} · Module {module.module_order}
          </h2>
          <p className="text-xs text-muted-foreground">
            {isLoading ? "Loading…" : `${list.length} question${list.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => addMut.mutate()}
          disabled={addMut.isPending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {addMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add question
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-10">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : list.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No questions yet. Add one to get started.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {list.map((q, i) =>
            editingId === q.id ? (
              <QuestionEditor
                key={q.id}
                mockId={mockId}
                moduleId={moduleId}
                question={q}
                subject={subject}
                onClose={() => setEditingId(null)}
                onSaved={invalidate}
              />
            ) : (
              <div key={q.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-extrabold text-foreground">Q{i + 1}</span>
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-muted-foreground">
                      {q.is_math_input ? "SPR" : "MCQ"} · {q.question_type}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-sm text-foreground">
                    {q.question_text?.trim() ? (
                      <MathText text={q.question_text} className="text-sm" />
                    ) : (
                      <em className="text-muted-foreground/50">No text yet</em>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0 || reorderMut.isPending}
                    title="Move up"
                    aria-label="Move question up"
                    className="rounded-lg border border-border p-1.5 text-xs font-bold text-muted-foreground hover:bg-surface-2 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === list.length - 1 || reorderMut.isPending}
                    title="Move down"
                    aria-label="Move question down"
                    className="rounded-lg border border-border p-1.5 text-xs font-bold text-muted-foreground hover:bg-surface-2 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(q.id)}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(q)}
                    title="Delete question"
                    aria-label="Delete question"
                    className="rounded-lg border border-border p-1.5 text-muted-foreground hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        tone="danger"
        title="Delete question?"
        description="This question will be permanently removed from the module."
        confirmLabel="Delete question"
        loading={deleteMut.isPending}
        onConfirm={() => pendingDelete && deleteMut.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

// ─── Single-question editor ─────────────────────────────────────────────────

type QuestionDraft = {
  question_type: "MATH" | "READING" | "WRITING";
  is_math_input: boolean;
  score: number;
  question_text: string;
  question_prompt: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  explanation: string;
};

function toDraft(q: AdminModuleQuestion): QuestionDraft {
  return {
    question_type: q.question_type ?? "MATH",
    is_math_input: q.is_math_input ?? false,
    score: q.score ?? 10,
    question_text: q.question_text ?? "",
    question_prompt: q.question_prompt ?? "",
    option_a: q.option_a ?? "",
    option_b: q.option_b ?? "",
    option_c: q.option_c ?? "",
    option_d: q.option_d ?? "",
    correct_answer: q.correct_answer ?? "",
    explanation: q.explanation ?? "",
  };
}

function QuestionEditor({
  mockId,
  moduleId,
  question,
  subject,
  onClose,
  onSaved,
}: {
  mockId: number;
  moduleId: number;
  question: AdminModuleQuestion;
  subject: MockSubject;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<QuestionDraft>(() => toDraft(question));
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [clearImage, setClearImage] = useState(false);

  const patch = (p: Partial<QuestionDraft>) => setDraft((d) => ({ ...d, ...p }));

  // Formula toolbar insertion targeting whichever field is focused.
  const activeFieldRef = useRef<{
    el: HTMLTextAreaElement | HTMLInputElement;
    setVal: (v: string) => void;
  } | null>(null);

  const handleFormulaInsert = (snippet: string, cursorOffset: number) => {
    const active = activeFieldRef.current;
    if (!active) return;
    const { el, setVal } = active;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const newVal = el.value.slice(0, start) + snippet + el.value.slice(end);
    const newCursorPos = start + cursorOffset;
    setVal(newVal);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newCursorPos, newCursorPos);
    });
  };

  const saveMut = useMutation({
    mutationFn: () => {
      const needsMultipart = imageFile != null || clearImage;
      if (needsMultipart) {
        const fd = new FormData();
        fd.append("question_type", draft.question_type);
        fd.append("is_math_input", String(draft.is_math_input));
        fd.append("score", String(draft.score));
        fd.append("question_text", draft.question_text);
        fd.append("question_prompt", draft.question_prompt);
        fd.append("option_a", draft.is_math_input ? "" : draft.option_a);
        fd.append("option_b", draft.is_math_input ? "" : draft.option_b);
        fd.append("option_c", draft.is_math_input ? "" : draft.option_c);
        fd.append("option_d", draft.is_math_input ? "" : draft.option_d);
        fd.append("correct_answer", draft.correct_answer);
        fd.append("explanation", draft.explanation);
        if (imageFile) fd.append("question_image", imageFile);
        if (clearImage) fd.append("clear_question_image", "true");
        return mocksAdminApi.updateModuleQuestion(mockId, moduleId, question.id, fd, true);
      }
      return mocksAdminApi.updateModuleQuestion(mockId, moduleId, question.id, {
        question_type: draft.question_type,
        is_math_input: draft.is_math_input,
        score: draft.score,
        question_text: draft.question_text,
        question_prompt: draft.question_prompt,
        option_a: draft.is_math_input ? "" : draft.option_a,
        option_b: draft.is_math_input ? "" : draft.option_b,
        option_c: draft.is_math_input ? "" : draft.option_c,
        option_d: draft.is_math_input ? "" : draft.option_d,
        correct_answer: draft.correct_answer,
        explanation: draft.explanation,
      });
    },
    onSuccess: () => {
      toast.push({ message: "Question saved.", tone: "success" });
      onSaved();
      onClose();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  const isMC = !draft.is_math_input;
  const existingImage = question.question_image;

  return (
    <div className="bg-surface-2/30 p-5">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-extrabold text-foreground">
          Editing #{question.id} · {subjectLabel(subject)}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      </div>

      {/* Formula toolbar */}
      <div className="mb-4 overflow-hidden rounded-xl border border-border bg-card">
        <FormulaToolbar onInsert={handleFormulaInsert} />
      </div>

      <div className="space-y-4">
        {/* Type + score */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={STUDIO_FIELD_LABEL}>Question type</label>
            <select
              className={STUDIO_INPUT}
              value={draft.question_type}
              onChange={(e) => patch({ question_type: e.target.value as QuestionDraft["question_type"] })}
            >
              <option value="MATH">Math</option>
              <option value="READING">Reading</option>
              <option value="WRITING">Writing</option>
            </select>
          </div>
          <div>
            <label className={STUDIO_FIELD_LABEL}>Score weight</label>
            <select
              className={STUDIO_INPUT}
              value={draft.score}
              onChange={(e) => patch({ score: Number(e.target.value) })}
            >
              <option value={10}>10 ball</option>
              <option value={20}>20 ball</option>
              <option value={40}>40 ball</option>
            </select>
          </div>
        </div>

        {/* Answer format toggle */}
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id={`spr-${question.id}`}
            checked={draft.is_math_input}
            onChange={(e) => patch({ is_math_input: e.target.checked })}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <label htmlFor={`spr-${question.id}`} className="text-sm font-semibold text-foreground cursor-pointer select-none">
            Student-produced response (types the answer — no A/B/C/D choices)
          </label>
        </div>

        {/* Question text */}
        <div>
          <label className={STUDIO_FIELD_LABEL}>Question text (stem)</label>
          <textarea
            className={`${STUDIO_INPUT} min-h-[120px] leading-relaxed`}
            placeholder="Enter the full question text. LaTeX math is supported: \( x^2 + 1 = 0 \)"
            value={draft.question_text}
            onChange={(e) => patch({ question_text: e.target.value })}
            onFocus={(e) => {
              activeFieldRef.current = { el: e.currentTarget, setVal: (v) => patch({ question_text: v }) };
            }}
          />
          {draft.question_text.trim() && (
            <div className="mt-2 rounded-xl border border-border/60 bg-card px-3 py-2.5">
              <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Preview</p>
              <MathText text={draft.question_text} block className="text-sm leading-relaxed text-foreground" />
            </div>
          )}
        </div>

        {/* Question image */}
        <div>
          <label className={STUDIO_FIELD_LABEL}>Question image (optional)</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {existingImage && !clearImage && !imageFile && (
              <>
                <img src={existingImage} alt="Question" className="max-h-24 rounded-lg border border-border object-contain" />
                <button
                  type="button"
                  onClick={() => setClearImage(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
                >
                  <X className="h-3 w-3" /> Remove
                </button>
              </>
            )}
            {imageFile && (
              <>
                <img src={URL.createObjectURL(imageFile)} alt="Preview" className="max-h-24 rounded-lg border border-border object-contain" />
                <button
                  type="button"
                  onClick={() => setImageFile(null)}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-surface-2 transition-colors"
                >
                  <X className="h-3 w-3" /> Cancel
                </button>
              </>
            )}
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border bg-surface-2/30 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-surface-2/60 transition-colors">
              <ImagePlus className="h-3.5 w-3.5" />
              {imageFile ? "Change image" : existingImage && !clearImage ? "Replace image" : "Upload image"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setImageFile(f);
                    setClearImage(false);
                  }
                }}
              />
            </label>
          </div>
        </div>

        {/* Stimulus */}
        <div>
          <label className={STUDIO_FIELD_LABEL}>Stimulus / passage excerpt (optional)</label>
          <textarea
            className={`${STUDIO_INPUT} min-h-[70px] leading-relaxed`}
            placeholder="Secondary text shown above the answer choices — e.g. a short passage excerpt or graph description."
            value={draft.question_prompt}
            onChange={(e) => patch({ question_prompt: e.target.value })}
            onFocus={(e) => {
              activeFieldRef.current = { el: e.currentTarget, setVal: (v) => patch({ question_prompt: v }) };
            }}
          />
        </div>

        {/* Choices + correct answer */}
        {isMC ? (
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className={STUDIO_FIELD_LABEL}>Answer choices</p>
            {(["a", "b", "c", "d"] as const).map((letter) => {
              const key = `option_${letter}` as keyof QuestionDraft;
              const val = draft[key] as string;
              const selected = draft.correct_answer.toUpperCase() === letter.toUpperCase();
              return (
                <div key={letter} className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => patch({ correct_answer: letter.toUpperCase() })}
                    title={`Mark ${letter.toUpperCase()} correct`}
                    className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-extrabold transition-colors ${
                      selected
                        ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                        : "border-border bg-card text-foreground hover:bg-surface-2"
                    }`}
                  >
                    {letter.toUpperCase()}
                  </button>
                  <textarea
                    className={`${STUDIO_INPUT} flex-1`}
                    rows={1}
                    placeholder={`Option ${letter.toUpperCase()}`}
                    value={val}
                    onChange={(e) => patch({ [key]: e.target.value } as Partial<QuestionDraft>)}
                    onFocus={(e) => {
                      activeFieldRef.current = {
                        el: e.currentTarget,
                        setVal: (v) => patch({ [key]: v } as Partial<QuestionDraft>),
                      };
                    }}
                  />
                </div>
              );
            })}
            <p className="text-[11px] text-muted-foreground">
              Click a letter to mark it correct. Correct answer: {draft.correct_answer || "—"}
            </p>
          </div>
        ) : (
          <div>
            <label className={STUDIO_FIELD_LABEL}>
              Correct answer (comma-separated for multiple valid forms, e.g. 2/3, 0.667)
            </label>
            <input
              className={STUDIO_INPUT}
              placeholder="e.g. 42 or 2/3, 0.666, 0.667"
              value={draft.correct_answer}
              onChange={(e) => patch({ correct_answer: e.target.value })}
              onFocus={(e) => {
                activeFieldRef.current = { el: e.currentTarget, setVal: (v) => patch({ correct_answer: v }) };
              }}
            />
          </div>
        )}

        {/* Explanation */}
        <div>
          <label className={STUDIO_FIELD_LABEL}>Explanation / solution rationale</label>
          <textarea
            className={`${STUDIO_INPUT} min-h-[80px] leading-relaxed`}
            placeholder="Explain why the correct answer is right. Students see this after the test."
            value={draft.explanation}
            onChange={(e) => patch({ explanation: e.target.value })}
            onFocus={(e) => {
              activeFieldRef.current = { el: e.currentTarget, setVal: (v) => patch({ explanation: v }) };
            }}
          />
        </div>
      </div>
    </div>
  );
}
