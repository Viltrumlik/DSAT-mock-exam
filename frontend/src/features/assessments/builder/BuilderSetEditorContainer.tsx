"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  useAssessmentSetDetail,
  useAssessmentSetsList,
  useDeleteAssessmentQuestion,
  useSetReviewStatus,
  useUpsertAssessmentQuestion,
  useUpsertAssessmentSet,
} from "@/features/assessments/hooks";
import { getRole } from "@/lib/permissions";
import { assessmentsAdminApi as assessmentAuthoringApi } from "@/features/assessmentsAdmin/api";
import { QuestionBankPickerModal } from "./QuestionBankPickerModal";
import { AssessmentCategorySelect } from "@/features/assessments/components/AssessmentCategorySelect";
import { allowedSourcesForSubject, sourceLabel } from "@/lib/assessmentSources";
import { levelsForSubject, levelLabel } from "@/lib/levels";
import { AssessmentQuestionEditorFields } from "@/features/assessments/components/AssessmentQuestionEditorFields";
import type {
  AssessmentQuestion,
  AssessmentQuestionType,
  AssessmentSet,
  ReviewStatus,
} from "@/features/assessments/types";
import { REVIEW_STATUS_LABELS } from "@/features/assessments/types";

const REVIEW_STATUS_STYLES: Record<ReviewStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  needs_review: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
};
const REVIEW_STATUS_ORDER: ReviewStatus[] = ["draft", "needs_review", "approved"];
import { normalizeApiError, formatApiErrorForToast } from "@/lib/apiError";
import ErrorPanel from "@/components/ErrorPanel";
import { useToast } from "@/components/ToastProvider";
import { normalizeQuestionList } from "@/features/assessments/builder/normalize";
import {
  useBuilderStore,
  useBuilderViewSet,
} from "@/features/assessments/builder/store";
import { SATQuestionPreview } from "@/features/assessments/builder/SATQuestionPreview";
import { QuestionRow } from "@/features/assessments/builder/QuestionRow";
import { FormulaToolbar } from "@/components/FormulaToolbar";
import { writeStudioSession } from "@/lib/studioSession";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Database,
  Lock,
  Monitor,
  Plus,
  Rocket,
  RotateCcw,
  Save,
  Smartphone,
  Upload,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { StateTag } from "@/components/governance";

// ─── Constants ────────────────────────────────────────────────────────────────

const INPUT =
  "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:border-primary/50 transition-colors";

const LABEL = "text-[11px] font-bold text-muted-foreground uppercase tracking-widest";

// Reject oversized images client-side with a friendly message before they hit
// nginx's 60M hard cap (which returns an opaque 413). 10 MB is generous for a
// question figure.
const MAX_QUESTION_IMAGE_MB = 10;
const MAX_QUESTION_IMAGE_BYTES = MAX_QUESTION_IMAGE_MB * 1024 * 1024;

// ─── Main editor ──────────────────────────────────────────────────────────────

export default function BuilderSetEditorContainer() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const setId = Number(id);
  const toast = useToast();

  const { data, isLoading, error, refetch } = useAssessmentSetsList();
  const detail = useAssessmentSetDetail(setId);
  const upsertSet = useUpsertAssessmentSet();
  const upsertQuestion = useUpsertAssessmentQuestion(setId);
  const delQuestion = useDeleteAssessmentQuestion(setId);
  const setReviewStatus = useSetReviewStatus();
  const canApprove =
    getRole() === "admin" || getRole() === "super_admin" || getRole() === "test_auditor";
  const changeReviewStatus = (status: ReviewStatus) => {
    setReviewStatus.mutate(
      { id: setId, status },
      {
        onSuccess: () =>
          toast.push({ message: `Status set to “${REVIEW_STATUS_LABELS[status]}”.`, tone: "success" }),
        onError: (e: unknown) =>
          toast.push({
            message: (e as { message?: string })?.message || "Could not change status.",
            tone: "error",
          }),
      },
    );
  };

  const hydrate = useBuilderStore((s) => s.hydrateFromServer);
  const selectedQuestionId = useBuilderStore((s) => s.selectedQuestionId);
  const selectQuestion = useBuilderStore((s) => s.selectQuestion);
  const patchSet = useBuilderStore((s) => s.patchSet);
  const dirty = useBuilderStore((s) => s.dirty);
  const validation = useBuilderStore((s) => s.validation);
  const versionOutdated = useBuilderStore((s) => s.versionOutdated);
  const baseVersion = useBuilderStore((s) => s.baseVersion);
  const markOutdated = useBuilderStore((s) => s.markOutdated);
  const pushUndoPoint = useBuilderStore((s) => s.pushUndoPoint);
  const undo = useBuilderStore((s) => s.undo);
  const redo = useBuilderStore((s) => s.redo);
  const pastLen = useBuilderStore((s) => s.past.length);
  const futureLen = useBuilderStore((s) => s.future.length);
  const removeQuestionPatch = useBuilderStore((s) => s.removeQuestionPatch);

  const metaUndoArm = useRef(false);

  const patchSetTracked = (patch: Partial<AssessmentSet>) => {
    if (!metaUndoArm.current) { pushUndoPoint(); metaUndoArm.current = true; }
    patchSet(patch);
  };

  const view = useBuilderViewSet();
  const questions = useMemo(() => {
    const qs = Array.isArray(view?.questions) ? (view!.questions as AssessmentQuestion[]) : [];
    return normalizeQuestionList(qs);
  }, [view]);

  // ── Question Bank picker (M4) ──────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const bankSubject = String(view?.subject || "").toLowerCase() === "english" ? "ENGLISH" : "MATH";

  const addFromBank = useCallback(
    async (bankQuestionId: number) => {
      setPickerBusy(true);
      try {
        await assessmentAuthoringApi.addQuestionFromBank(setId, bankQuestionId);
        await detail.refetch();
        toast.push({ tone: "success", message: "Added from Question Bank." });
        setPickerOpen(false);
      } catch (e) {
        toast.push({ tone: "error", message: normalizeApiError(e).message });
      } finally {
        setPickerBusy(false);
      }
    },
    [setId, detail, toast],
  );

  // ── CSV import (append questions to this set) ──────────────────────────────
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const importCsv = useCallback(
    async (file: File) => {
      setCsvBusy(true);
      try {
        const res = await assessmentAuthoringApi.appendQuestionsCsv(setId, file);
        await detail.refetch();
        toast.push({ tone: "success", message: `Imported ${res.created_count} question${res.created_count === 1 ? "" : "s"} from CSV.` });
      } catch (e) {
        // The backend returns per-row errors when a CSV is invalid — surface the first one.
        const err = e as { response?: { data?: { detail?: string; errors?: { row: number; errors: unknown }[] } } };
        const data = err?.response?.data;
        let msg = normalizeApiError(e).message;
        if (data?.errors?.length) {
          const first = data.errors[0];
          msg = `${data.detail ?? "Some rows are invalid."} (row ${first.row})`;
        } else if (data?.detail) {
          msg = data.detail;
        }
        toast.push({ tone: "error", message: msg });
      } finally {
        setCsvBusy(false);
      }
    },
    [setId, detail, toast],
  );

  // ── Session continuity: persist last-edited set + question to localStorage ──
  useEffect(() => {
    if (!Number.isFinite(setId) || setId <= 0) return;
    writeStudioSession({
      lastSetId: setId,
      lastQuestionId: selectedQuestionId ?? undefined,
    });
  }, [setId, selectedQuestionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inInput = !!t?.closest?.("input, textarea, select, [contenteditable=true]");
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      // ⌘Z / ⌘⇧Z — undo / redo (skip if in input)
      if (!inInput && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }

      // ⌘] — next question  |  ⌘[ — previous question
      if (!inInput && (e.key === "]" || e.key === "[")) {
        e.preventDefault();
        if (e.key === "]") {
          const idx = questions.findIndex((q) => q.id === selectedQuestionId);
          if (idx >= 0 && idx < questions.length - 1) selectQuestion(questions[idx + 1].id);
        } else {
          const idx = questions.findIndex((q) => q.id === selectedQuestionId);
          if (idx > 0) selectQuestion(questions[idx - 1].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [redo, undo, questions, selectedQuestionId, selectQuestion]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const setRow = (detail.data as any) || null;

  useEffect(() => {
    if (!Number.isFinite(setId) || setId <= 0) {
      toast.push({ tone: "error", message: "Invalid set id in the URL." });
    }
  }, [setId, toast]);

  const serverUpdatedAt = (setRow as any)?.updated_at;
  useEffect(() => { metaUndoArm.current = false; }, [setId, serverUpdatedAt]);

  useEffect(() => {
    if (!setRow) return;
    const nextVersion = (setRow as any)?.updated_at ? String((setRow as any).updated_at) : null;
    if (baseVersion && nextVersion && baseVersion !== nextVersion && dirty) {
      markOutdated(true);
      return;
    }
    hydrate(setRow);
  }, [setRow]);

  useEffect(() => {
    if (detail.isLoading || !Number.isFinite(setId) || setId <= 0 || !detail.data || setRow) return;
    toast.push({ tone: "error", message: "This set no longer exists. Refreshing…" });
    void detail.refetch();
  }, [detail, setId, setRow, toast]);

  useEffect(() => {
    if (!selectedQuestionId) return;
    if (questions.some((q) => q.id === selectedQuestionId)) return;
    selectQuestion(null);
  }, [questions, selectQuestion, selectedQuestionId]);

  const autoSelectFired = useRef(false);
  useEffect(() => {
    if (autoSelectFired.current || questions.length === 0) return;
    const paramId = searchParams.get("questionId");
    if (!paramId) return;
    const qId = Number(paramId);
    if (!Number.isFinite(qId) || qId <= 0 || !questions.some((q) => q.id === qId)) return;
    autoSelectFired.current = true;
    selectQuestion(qId);
  }, [questions, searchParams, selectQuestion]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const selected = useMemo(
    () => (selectedQuestionId ? questions.find((q) => q.id === selectedQuestionId) ?? null : null),
    [questions, selectedQuestionId],
  );

  // ── Viewport toggle ──────────────────────────────────────
  const [viewportMode, setViewportMode] = useState<"desktop" | "mobile">("desktop");
  const [saveMode, setSaveMode] = useState<"save" | "save-next" | "save-new">("save");
  const [saveModeOpen, setSaveModeOpen] = useState(false);
  const saveModeRef = useRef<HTMLDivElement>(null);

  // Close save-mode dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (saveModeRef.current && !saveModeRef.current.contains(e.target as Node)) {
        setSaveModeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const [editing, setEditing] = useState<{
    questionId: number | null;
    prompt: string;
    question_prompt: string;
    question_type: string;
    order: number;
    points: number;
    is_active: boolean;
    explanation: string;
    choicesText: string;
    correctAnswerText: string;
    gradingConfigText: string;
    stimulusContext: string;
  }>({
    questionId: null,
    prompt: "",
    question_prompt: "",
    question_type: "multiple_choice",
    order: 0,
    points: 1,
    is_active: true,
    explanation: "",
    choicesText: JSON.stringify(["A", "B", "C", "D"].map((id) => ({ id, text: "" })), null, 2),
    correctAnswerText: JSON.stringify("A"),
    gradingConfigText: "{}",
    stimulusContext: "",
  });

  // Stable key representing the server-side correct_answer for the currently
  // selected question. Used as a secondary useEffect dependency so that the
  // editing state is re-hydrated when:
  //   (a) the user switches to a different question (selected?.id changes), OR
  //   (b) the server data for the SAME question arrives/updates with a
  //       correct_answer value that differs from what we last loaded
  //       (e.g. React Query returned a stale cache without correct_answer,
  //        then a background refetch returned the real value — the ID hasn't
  //        changed so [selected?.id] alone would miss this update).
  // JSON.stringify normalises undefined → "null" so Object.is comparisons
  // in React's dep-diffing work correctly for all value types.
  const _selectedCorrectAnswerKey = JSON.stringify((selected as any)?.correct_answer ?? null);

  // Guard: after saving a question we record the authoritative correct_answer
  // that the server accepted. React's effect system fires [selected?.id,
  // _selectedCorrectAnswerKey] using the VALUES from the render in which it
  // fires — which may still see correct_answer=null if the Zustand store
  // hasn't yet been updated by the [setRow] effect that runs just before it.
  // The guard prevents that stale hydration from silently wiping the answer
  // the user just saved. It is cleared once the store catches up with a
  // non-null correct_answer, or when the user navigates to a different question.
  const lastSavedAnswerRef = useRef<{ questionId: number; correctAnswerText: string } | null>(null);

  useEffect(() => {
    if (!selected) {
      lastSavedAnswerRef.current = null;
      return;
    }
    // Clear the guard when navigating to a different question.
    if (lastSavedAnswerRef.current && lastSavedAnswerRef.current.questionId !== selected.id) {
      lastSavedAnswerRef.current = null;
    }

    const rawChoices: Array<{ id?: unknown }> = (selected as any).choices ?? [];
    const rawCorrect = (selected as any).correct_answer;

    let correctAnswerText: string;
    if (rawCorrect != null) {
      // Fresh server data with a real value — use it and clear the guard.
      correctAnswerText = JSON.stringify(rawCorrect);
      lastSavedAnswerRef.current = null;
    } else if (lastSavedAnswerRef.current?.questionId === selected.id) {
      // Store has null (stale / background-refetch not yet settled) but we
      // just saved a real answer — use the saved value to avoid a flash of
      // "no answer selected".
      correctAnswerText = lastSavedAnswerRef.current.correctAnswerText;
    } else {
      // No guard and no server value — show null (honest state).
      // Guard: JSON.stringify(undefined) returns the JS value `undefined`
      // (not a string), which breaks parseJson later. Use null as safe sentinel.
      correctAnswerText = JSON.stringify(null);
    }

    setEditing({
      questionId: selected.id,
      prompt: String(selected.prompt || ""),
      question_prompt: String((selected as any).question_prompt ?? ""),
      question_type: selected.question_type,
      order: Number(selected.order ?? 0),
      points: Number(selected.points ?? 1),
      is_active: Boolean(selected.is_active ?? true),
      explanation: String((selected as any).explanation ?? ""),
      choicesText: JSON.stringify(rawChoices, null, 2),
      correctAnswerText,
      gradingConfigText: JSON.stringify((selected as any).grading_config ?? {}, null, 2),
      stimulusContext: String((selected as any).question_prompt ?? ""),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, _selectedCorrectAnswerKey]);

  const parseJson = (s: string, fallback: any) => {
    try { return JSON.parse(s); } catch { return fallback; }
  };

  const saveQuestion = async () => {
    // Freeze the image selection up-front so the multipart body is built from a
    // stable snapshot that a concurrent re-render or the [selected.id] reset
    // effect cannot mutate mid-save.
    const capturedImageFiles = imageFiles;
    const capturedImageClears = imageClears;
    try {
      const payload: any = {
        // `order` is intentionally NOT sent: it is server-owned (append-on-create
        // under a set lock + the atomic reorder endpoint). Sending a stale
        // editing.order could collide under UNIQUE(assessment_set, order); the
        // backend now treats it as read-only, so it would be ignored anyway.
        prompt: String(editing.prompt || "").trim(),
        question_prompt: String(editing.question_prompt || ""),
        question_type: editing.question_type,
        points: Number(editing.points || 1),
        is_active: Boolean(editing.is_active),
        explanation: String(editing.explanation || ""),
        choices: parseJson(editing.choicesText, []),
        correct_answer: parseJson(editing.correctAnswerText, null),
        grading_config: parseJson(editing.gradingConfigText, {}),
      };
      if (!payload.prompt) {
        toast.push({ tone: "error", message: "Question text is required." });
        return;
      }
      if (payload.question_type === "multiple_choice") {
        const idList = (payload.choices || []).map((c: { id?: unknown }) => String(c?.id ?? "").trim()).filter(Boolean);
        const ids = new Set(idList);
        const ca = payload.correct_answer;
        const cStr = typeof ca === "string" ? ca : ca != null ? String(ca) : "";
        if (idList.length === 0) {
          toast.push({ tone: "error", message: "Add at least one answer choice before saving." });
          return;
        }
        if (!cStr) {
          toast.push({ tone: "error", message: "Pick which choice is correct before saving." });
          return;
        }
        if (!ids.has(cStr)) {
          // DO NOT silently fall back to choices[0] — that turned the user's
          // pick of "D" into "A". Instead, surface the mismatch so they can
          // re-click the correct badge.
          toast.push({
            tone: "error",
            message: `Selected answer "${cStr}" no longer matches any choice. Re-select the correct badge and try again.`,
          });
          return;
        }
        payload.correct_answer = cStr;
      } else if (payload.question_type === "numeric") {
        // A numeric answer is either a plain number ("5", "3.14") — stored as a JSON
        // number — or a simple fraction ("1/2") — stored as a string and graded as a
        // decimal on the backend. Empty/invalid is rejected.
        const ca = payload.correct_answer;
        if (ca === null || ca === undefined || ca === "") {
          toast.push({ tone: "error", message: "Enter a correct value for the numeric question." });
          return;
        }
        // Accept one value OR several comma-separated acceptable values (SAT grid-in,
        // e.g. "10.25, 21/2"). Each token is a plain number or a simple fraction.
        const tokens = (Array.isArray(ca) ? ca.map((x) => String(x)) : String(ca).split(","))
          .map((t) => t.trim())
          .filter((t) => t !== "");
        if (tokens.length === 0) {
          toast.push({ tone: "error", message: "Enter a correct value for the numeric question." });
          return;
        }
        const coerced: Array<string | number> = [];
        let invalidToken = false;
        for (const tok of tokens) {
          if (/^-?\d+(?:\.\d+)?\/-?\d+(?:\.\d+)?$/.test(tok)) {
            coerced.push(tok); // fraction — kept as a string, graded as a decimal
          } else if (Number.isFinite(Number(tok))) {
            coerced.push(Number(tok));
          } else {
            invalidToken = true;
            break;
          }
        }
        if (invalidToken) {
          toast.push({ tone: "error", message: "Each value must be a number or a fraction like 1/2." });
          return;
        }
        // Scalar for a single answer (unchanged); a list only for several.
        payload.correct_answer = coerced.length === 1 ? coerced[0] : coerced;
      }
      // Use FormData when any image is attached or cleared (read from the frozen snapshot)
      const hasImages = Object.keys(capturedImageFiles).length > 0 || Object.values(capturedImageClears).some(Boolean);
      let finalPayload: any = payload;
      if (hasImages) {
        const fd = new FormData();
        // These map to JSONField columns on the backend — they must be sent as JSON,
        // even when the value is a bare string/number (e.g. correct_answer "A" or "1/2"),
        // otherwise DRF rejects them with "Value must be valid JSON".
        const JSON_FIELDS = new Set(["choices", "correct_answer", "grading_config"]);
        Object.entries(payload).forEach(([k, v]) => {
          if (v !== null && v !== undefined) {
            const encode = JSON_FIELDS.has(k) || (typeof v === "object" && !(v instanceof File));
            fd.append(k, encode ? JSON.stringify(v) : String(v));
          }
        });
        const imgFieldMap: Record<ImgKey, string> = {
          question: "question_image",
          a: "option_a_image",
          b: "option_b_image",
          c: "option_c_image",
          d: "option_d_image",
        };
        (Object.entries(imgFieldMap) as [ImgKey, string][]).forEach(([key, field]) => {
          if (capturedImageFiles[key]) fd.append(field, capturedImageFiles[key]!);
          if (capturedImageClears[key]) fd.append(`clear_${field}`, "true");
        });
        finalPayload = fd;
      }
      const res = await upsertQuestion.mutateAsync({ id: editing.questionId, payload: finalPayload });
      const savedId = (res as any).id as number;
      setImageFiles({});
      setImageClears({});

      // Immediately sync editing state from the mutation response so the correct
      // answer is visible right after save — without waiting for the
      // cache → store → effect reactive chain to settle.
      // The reactive chain (setQueryData in hooks.ts → hydrate → _selectedCorrectAnswerKey
      // effect) will fire later and confirm the same values; this call just
      // eliminates any flash where the UI would show "no answer selected".
      const savedRes = res as any;
      const newCorrectAnswerText =
        savedRes.correct_answer != null
          ? JSON.stringify(savedRes.correct_answer)
          : null;

      // Arm the guard ref so the hydration useEffect can't wipe this value
      // with a stale null from the background refetch before the store catches up.
      if (newCorrectAnswerText != null) {
        lastSavedAnswerRef.current = { questionId: savedId, correctAnswerText: newCorrectAnswerText };
      }

      setEditing((prev) => ({
        ...prev,
        questionId: savedId,
        correctAnswerText: newCorrectAnswerText ?? prev.correctAnswerText,
        choicesText:
          Array.isArray(savedRes.choices)
            ? JSON.stringify(savedRes.choices, null, 2)
            : prev.choicesText,
        gradingConfigText:
          savedRes.grading_config !== undefined
            ? JSON.stringify(savedRes.grading_config ?? {}, null, 2)
            : prev.gradingConfigText,
      }));

      toast.push({ tone: "success", message: editing.questionId ? "Question updated." : "Question created." });

      // Post-save navigation based on current mode
      if (saveMode === "save-next") {
        const currentIndex = questions.findIndex((q) => q.id === (editing.questionId ?? savedId));
        const nextQ = questions[currentIndex + 1];
        if (nextQ) {
          selectQuestion(nextQ.id);
        } else {
          // Last question — stay on saved question
          selectQuestion(savedId);
          toast.push({ tone: "success", message: "Last question — at the end of the set." });
        }
      } else if (saveMode === "save-new") {
        newQuestion();
      } else {
        selectQuestion(savedId);
      }
    } catch (e) {
      // Surface DRF field errors (e.g. "question_image: The submitted data was not
      // a file") so the teacher can see exactly why a save was rejected.
      toast.push({ tone: "error", message: formatApiErrorForToast(e) });
    }
  };

  const newQuestion = useCallback(() => {
    selectQuestion(null);
    setEditing({
      questionId: null,
      prompt: "",
      question_prompt: "",
      question_type: "multiple_choice",
      order: questions.length ? (questions[questions.length - 1].order ?? 0) + 1 : 0,
      points: 1,
      is_active: true,
      explanation: "",
      choicesText: JSON.stringify(["A", "B", "C", "D"].map((id) => ({ id, text: "" })), null, 2),
      correctAnswerText: JSON.stringify("A"),
      gradingConfigText: "{}",
      stimulusContext: "",
    });
  }, [questions, selectQuestion]);

  // ── Navigation helpers ─────────────────────────────────────────────────────
  const currentIndex = useMemo(
    () => questions.findIndex((q) => q.id === selectedQuestionId),
    [questions, selectedQuestionId],
  );

  const navigateTo = useCallback(
    (index: number) => {
      const q = questions[index];
      if (q) selectQuestion(q.id);
    },
    [questions, selectQuestion],
  );

  // ── Duplicate question ─────────────────────────────────────────────────────
  const duplicateQuestion = useCallback(async () => {
    if (!editing.questionId && !editing.prompt) return;
    const payload: any = {
      // `order` omitted — the backend appends the duplicate under a set lock.
      prompt: editing.prompt ? `${editing.prompt} (copy)` : "(copy)",
      question_type: editing.question_type,
      points: editing.points,
      is_active: editing.is_active,
      explanation: editing.explanation,
      choices: parseJson(editing.choicesText, []),
      correct_answer: parseJson(editing.correctAnswerText, null),
      grading_config: parseJson(editing.gradingConfigText, {}),
    };
    try {
      const res = await upsertQuestion.mutateAsync({ id: null, payload });
      toast.push({ tone: "success", message: "Question duplicated." });
      selectQuestion((res as any).id);
    } catch (e) {
      toast.push({ tone: "error", message: formatApiErrorForToast(e) });
    }
  }, [editing, questions, upsertQuestion, selectQuestion, toast]);

  const onDragEnd = async (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = questions.map((q) => q.id);
    const oldIndex = ids.indexOf(active.id);
    const newIndex = ids.indexOf(over.id);
    const next = normalizeQuestionList(arrayMove(questions, oldIndex, newIndex));
    pushUndoPoint();
    try {
      // Single atomic reorder: the backend reindexes ALL questions to a dense,
      // unique 0..n-1 under a set row-lock. Replaces the old N-PATCH loop, which
      // left duplicate/gapped orders if a request failed midway.
      await assessmentAuthoringApi.reorderQuestions(setId, next.map((q) => q.id));
      await detail.refetch();
      toast.push({ tone: "success", message: "Order saved." });
    } catch (e) {
      toast.push({ tone: "error", message: formatApiErrorForToast(e) });
    }
  };

  const saveSetMeta = async () => {
    if (!view) return;
    try {
      await upsertSet.mutateAsync({
        id: view.id,
        payload: { title: view.title, category: view.category, description: view.description, source: view.source ?? "", level: view.level ?? "" },
      });
      toast.push({ tone: "success", message: "Set metadata saved." });
    } catch (e) {
      toast.push({ tone: "error", message: normalizeApiError(e).message });
    }
  };

  // ── Image upload state ─────────────────────────────────────────────────────
  type ImgKey = "question" | "a" | "b" | "c" | "d";
  const [imageFiles, setImageFiles] = useState<Partial<Record<ImgKey, File>>>({});
  const [imageClears, setImageClears] = useState<Partial<Record<ImgKey, boolean>>>({});

  const handleSetImage = useCallback((key: ImgKey, file: File | null, clear: boolean) => {
    if (file) {
      // Validate before staging so a bad file fails fast with a clear message,
      // instead of silently breaking the multipart save (the "image sometimes
      // doesn't upload" symptom for oversized/non-image files).
      if (!file.type.startsWith("image/")) {
        toast.push({ tone: "error", message: "That file isn't an image. Pick a PNG, JPG, or SVG." });
        return;
      }
      if (file.size > MAX_QUESTION_IMAGE_BYTES) {
        toast.push({
          tone: "error",
          message: `Image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_QUESTION_IMAGE_MB} MB.`,
        });
        return;
      }
      setImageFiles((prev) => ({ ...prev, [key]: file }));
      setImageClears((prev) => ({ ...prev, [key]: false }));
    } else if (clear) {
      setImageFiles((prev) => { const n = { ...prev }; delete n[key]; return n; });
      setImageClears((prev) => ({ ...prev, [key]: true }));
    } else {
      setImageFiles((prev) => { const n = { ...prev }; delete n[key]; return n; });
      setImageClears((prev) => ({ ...prev, [key]: false }));
    }
  }, [toast]);

  // Reset image state when selected question changes
  useEffect(() => {
    setImageFiles({});
    setImageClears({});
  }, [selected?.id]);

  // ── Formula toolbar: ref receives the insert handler from AssessmentQuestionEditorFields ──
  const formulaInsertRef = useRef<((snippet: string, cursorOffset: number) => void) | null>(null);

  // ── Collapse state for left panel sections ─────────────────────────────────
  const [metaOpen, setMetaOpen] = useState(false);

  if (isLoading && !view) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }
  if (error) {
    return <ErrorPanel title="Failed to load" message={String((error as any)?.message || error)} actionLabel="Retry" onAction={() => void refetch()} />;
  }
  if (!view) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground font-semibold">Set not found.</p>
      </div>
    );
  }

  const isPublished = Boolean((view as any)?.is_active);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* ── Top header bar ──────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-5 py-3 shadow-sm">
        <Link
          href="/builder/sets"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-bold text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          Sets
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-black uppercase tracking-widest text-primary/60">
              #{view.id}
            </span>
            <p className="font-extrabold text-foreground truncate">{view.title || "Untitled set"}</p>
            {(() => {
              const rs = (((detail.data as any)?.review_status ?? "draft") as ReviewStatus);
              return (
                <>
                  <span
                    className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${REVIEW_STATUS_STYLES[rs]}`}
                    title="Review status"
                  >
                    {REVIEW_STATUS_LABELS[rs]}
                  </span>
                  <select
                    value={rs}
                    disabled={setReviewStatus.isPending}
                    onChange={(e) => changeReviewStatus(e.target.value as ReviewStatus)}
                    title={canApprove ? "Change review status" : "Only an admin can approve"}
                    className="rounded-lg border border-border bg-card px-2 py-0.5 text-[11px] font-bold text-foreground disabled:opacity-50"
                  >
                    {REVIEW_STATUS_ORDER.map((opt) => (
                      <option key={opt} value={opt} disabled={opt === "approved" && !canApprove}>
                        {REVIEW_STATUS_LABELS[opt]}
                      </option>
                    ))}
                  </select>
                </>
              );
            })()}
            <StateTag state={isPublished ? "PUBLISHED" : "DRAFT"} size="xs" />
            {dirty && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Unsaved
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {view.subject} · {view.category || "No category"} · {questions.length} question{questions.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={!pastLen || versionOutdated}
            onClick={() => undo()}
            title="Undo (⌘Z)"
            className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold hover:bg-surface-2 disabled:opacity-40 transition-colors"
          >
            ↩ Undo
          </button>
          <button
            type="button"
            disabled={!futureLen || versionOutdated}
            onClick={() => redo()}
            title="Redo (⇧⌘Z)"
            className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold hover:bg-surface-2 disabled:opacity-40 transition-colors"
          >
            ↪ Redo
          </button>
          {validation.length > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700"
              title="Fix these before this set can be approved"
            >
              <Rocket className="h-3.5 w-3.5" />
              {validation.length} issue{validation.length !== 1 ? "s" : ""} to fix
            </span>
          )}
        </div>
      </header>

      {/* ── Immutable published warning ──────────────────────────────────────── */}
      {isPublished && (
        <div className="shrink-0 flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2.5">
          <Lock className="h-4 w-4 text-amber-700 shrink-0" />
          <p className="text-sm text-amber-800">
            <strong className="font-bold text-amber-900">Published set.</strong>{" "}
            Any edits you save will create a new revision automatically. Existing student attempts are not affected.
          </p>
        </div>
      )}

      {/* ── Outdated version warning ─────────────────────────────────────────── */}
      {versionOutdated && (
        <div className="shrink-0 flex items-center gap-3 border-b border-red-200 bg-red-50 px-5 py-2.5">
          <p className="text-sm text-red-800 font-semibold flex-1">
            This set was updated elsewhere while you had unsaved edits.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl border border-red-300 bg-red-100 px-3 py-1.5 text-xs font-bold text-red-800 hover:bg-red-200 shrink-0"
          >
            Reload
          </button>
        </div>
      )}

      {/* ── 3-pane content ───────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">

        {/* LEFT PANEL: Question list + set metadata */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
          {/* Add question buttons */}
          <div className="shrink-0 space-y-2 border-b border-border p-3">
            <button
              type="button"
              onClick={newQuestion}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              New question
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
            >
              <Database className="h-4 w-4" />
              Add from Question Bank
            </button>
            <button
              type="button"
              disabled={csvBusy}
              onClick={() => csvInputRef.current?.click()}
              title="Append questions from a CSV file (columns: question_type, prompt, option_a–d, correct_answer, points, explanation)"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {csvBusy ? "Importing…" : "Import CSV"}
            </button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ""; // allow re-selecting the same file
                if (f) void importCsv(f);
              }}
            />
          </div>

          <QuestionBankPickerModal
            open={pickerOpen}
            subject={bankSubject}
            busy={pickerBusy}
            onClose={() => setPickerOpen(false)}
            onAdd={(bankQuestionId) => void addFromBank(bankQuestionId)}
          />

          {/* Question list */}
          <div className="flex-1 overflow-y-auto p-3">
            {questions.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm font-semibold text-muted-foreground">No questions yet</p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Click "New question" to add the first one
                </p>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1.5">
                    {questions.map((q, idx) => (
                      <QuestionRow
                        key={q.id}
                        q={q}
                        index={idx}
                        active={q.id === selectedQuestionId}
                        onSelect={() => selectQuestion(q.id)}
                        onDelete={() =>
                          void (async () => {
                            pushUndoPoint();
                            const applyLocal = () => {
                              removeQuestionPatch(q.id);
                              if (selectedQuestionId === q.id) selectQuestion(null);
                              toast.push({ tone: "success", message: "Deleted." });
                            };
                            try {
                              await delQuestion.mutateAsync(q.id);
                              applyLocal();
                            } catch (e) {
                              const err = normalizeApiError(e);
                              // 409 = the question has student answers (PROTECT). Offer to
                              // force-delete it along with those answers; scores are kept.
                              if (
                                err.status === 409 &&
                                window.confirm(
                                  "This question already has student answers.\n\n" +
                                    "Delete it anyway? This also removes those answer records " +
                                    "(existing scores are not changed). This cannot be undone.",
                                )
                              ) {
                                try {
                                  await delQuestion.mutateAsync({ questionId: q.id, force: true });
                                  applyLocal();
                                } catch (e2) {
                                  toast.push({ tone: "error", message: normalizeApiError(e2).message });
                                }
                              } else {
                                toast.push({ tone: "error", message: err.message });
                              }
                            }
                          })()
                        }
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>

          {/* Validation summary */}
          {validation.length > 0 && (
            <div className="shrink-0 border-t border-border p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-600 mb-2">
                {validation.length} validation issue{validation.length !== 1 ? "s" : ""}
              </p>
              <ul className="space-y-1">
                {validation.slice(0, 5).map((e, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{e.scope}</span>: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Set metadata (collapsible) */}
          <div className="shrink-0 border-t border-border">
            <button
              type="button"
              onClick={() => setMetaOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
            >
              Set metadata
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", metaOpen && "rotate-180")} />
            </button>
            {metaOpen && (
              <div className="border-t border-border px-3 pb-3 pt-3 space-y-3">
                <div>
                  <p className={cn(LABEL, "mb-1.5")}>Title</p>
                  <input
                    className={INPUT}
                    value={String(view.title || "")}
                    onChange={(e) => patchSetTracked({ title: e.target.value })}
                    placeholder="Set title"
                  />
                </div>
                <div>
                  <p className={cn(LABEL, "mb-1.5")}>Category</p>
                  <AssessmentCategorySelect
                    subject={view.subject === "math" ? "math" : "english"}
                    value={String(view.category || "")}
                    onChange={(v) => patchSetTracked({ category: v })}
                    className={INPUT}
                    disabled={upsertSet.isPending || versionOutdated}
                  />
                </div>
                <div>
                  <p className={cn(LABEL, "mb-1.5")}>Source</p>
                  <select
                    className={INPUT}
                    value={String(view.source || "")}
                    onChange={(e) => patchSetTracked({ source: e.target.value })}
                    disabled={upsertSet.isPending || versionOutdated}
                  >
                    <option value="">None</option>
                    {allowedSourcesForSubject(view.subject).map((s) => (
                      <option key={s} value={s}>{sourceLabel(s)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className={cn(LABEL, "mb-1.5")}>Level</p>
                  <select
                    className={INPUT}
                    value={String(view.level || "")}
                    onChange={(e) => patchSetTracked({ level: e.target.value })}
                    disabled={upsertSet.isPending || versionOutdated}
                  >
                    <option value="">None</option>
                    {levelsForSubject(view.subject).map((l) => (
                      <option key={l} value={l}>{levelLabel(l)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className={cn(LABEL, "mb-1.5")}>Description</p>
                  <textarea
                    className={`${INPUT} min-h-[80px]`}
                    value={String(view.description || "")}
                    onChange={(e) => patchSetTracked({ description: e.target.value })}
                    placeholder="Optional description"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void saveSetMeta()}
                  disabled={upsertSet.isPending || versionOutdated}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-2 text-sm font-bold hover:bg-surface-2 disabled:opacity-50 transition-colors"
                >
                  <Save className="h-3.5 w-3.5" />
                  {upsertSet.isPending ? "Saving…" : "Save metadata"}
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* CENTER PANEL: Question editor */}
        <main className="flex min-w-0 flex-1 flex-col">

          {/* ── Formula toolbar — sticky, never scrolls away ─────────────── */}
          <div className="shrink-0 border-b border-border bg-card">
            <div className="px-3 pt-2 pb-0">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1">
                Formula insert — click a symbol, then type in a field below
              </p>
            </div>
            <FormulaToolbar onInsert={(snippet, cursorOffset) => formulaInsertRef.current?.(snippet, cursorOffset)} />
          </div>

          {/* ── Scrollable form body ─────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-8 py-8">
            {/* Panel heading — Q{n}/{total} nav + save controls */}
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="min-w-0">
                {/* Prev / Next navigation */}
                <div className="mb-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentIndex <= 0 || upsertQuestion.isPending}
                    onClick={() => navigateTo(currentIndex - 1)}
                    title="Previous question (⌘[)"
                    className="rounded-lg border border-border bg-card p-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-xs font-bold tabular-nums text-muted-foreground">
                    {currentIndex >= 0 ? `Q${currentIndex + 1} / ${questions.length}` : questions.length > 0 ? `New · ${questions.length} total` : "New question"}
                  </span>
                  <button
                    type="button"
                    disabled={currentIndex < 0 || currentIndex >= questions.length - 1 || upsertQuestion.isPending}
                    onClick={() => navigateTo(currentIndex + 1)}
                    title="Next question (⌘])"
                    className="rounded-lg border border-border bg-card p-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  {/* Duplicate */}
                  {editing.questionId && (
                    <button
                      type="button"
                      disabled={upsertQuestion.isPending}
                      onClick={() => void duplicateQuestion()}
                      title="Duplicate this question"
                      className="ml-1 inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-bold text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-40 transition-colors"
                    >
                      <Copy className="h-3 w-3" />
                      Duplicate
                    </button>
                  )}
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                  {editing.questionId ? `Question #${editing.questionId}` : "New question"}
                </p>
                <h2 className="text-lg font-extrabold text-foreground mt-0.5">
                  {editing.questionId ? "Edit question" : "Create question"}
                </h2>
              </div>

              {/* Save button with Save & Next / Save & New split */}
              <div ref={saveModeRef} className="relative shrink-0 flex">
                <button
                  type="button"
                  onClick={() => void saveQuestion()}
                  disabled={upsertQuestion.isPending || versionOutdated}
                  className="inline-flex items-center gap-2 rounded-l-xl bg-primary px-4 py-2.5 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {upsertQuestion.isPending ? (
                    <RotateCcw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {upsertQuestion.isPending
                    ? "Saving…"
                    : saveMode === "save-next"
                      ? "Save & Next"
                      : saveMode === "save-new"
                        ? "Save & New"
                        : editing.questionId
                          ? "Save changes"
                          : "Create"}
                </button>
                {/* Split chevron */}
                <button
                  type="button"
                  disabled={upsertQuestion.isPending || versionOutdated}
                  onClick={() => setSaveModeOpen((v) => !v)}
                  className="inline-flex items-center justify-center rounded-r-xl border-l border-primary/30 bg-primary px-2 py-2.5 text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
                  aria-label="Save options"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {/* Dropdown */}
                {saveModeOpen && (
                  <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
                    {(
                      [
                        { mode: "save", label: "Save only" },
                        { mode: "save-next", label: "Save & next →" },
                        { mode: "save-new", label: "Save & new question" },
                      ] as const
                    ).map(({ mode, label }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => { setSaveMode(mode); setSaveModeOpen(false); }}
                        className={cn(
                          "flex w-full items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                          saveMode === mode
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-surface-2",
                        )}
                      >
                        {saveMode === mode && <CheckCircle2 className="h-3.5 w-3.5" />}
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Empty state when nothing selected */}
            {!selectedQuestionId && !editing.prompt && (
              <div className="mb-8 rounded-2xl border border-dashed border-border bg-surface-2/20 p-6 text-center">
                <p className="text-sm font-semibold text-muted-foreground">
                  Select a question from the left to edit it, or click{" "}
                  <button
                    type="button"
                    onClick={newQuestion}
                    className="font-extrabold text-primary hover:underline"
                  >
                    New question
                  </button>{" "}
                  to create one.
                </p>
              </div>
            )}

            {/* Editor form */}
            <AssessmentQuestionEditorFields
              draft={{
                prompt: editing.prompt,
                question_prompt: editing.question_prompt,
                question_type: editing.question_type as AssessmentQuestionType,
                order: editing.order,
                points: editing.points,
                is_active: editing.is_active,
                explanation: editing.explanation,
                choicesText: editing.choicesText,
                correctAnswerText: editing.correctAnswerText,
                gradingConfigText: editing.gradingConfigText,
              }}
              onPatch={(p) => setEditing((e) => ({ ...e, ...p }))}
              disabled={upsertQuestion.isPending || versionOutdated}
              insertHandlerRef={formulaInsertRef}
              savedQuestion={selected ?? null}
              imageState={{ files: imageFiles, clears: imageClears }}
              onSetImage={handleSetImage}
            />

            {/* Save button repeated at bottom for long forms */}
            <div className="mt-8 flex justify-end border-t border-border pt-6">
              <button
                type="button"
                onClick={() => void saveQuestion()}
                disabled={upsertQuestion.isPending || versionOutdated}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
              >
                {upsertQuestion.isPending ? "Saving…" : editing.questionId ? "Save changes" : "Create question"}
              </button>
            </div>
          </div>
          </div>
        </main>

        {/* RIGHT PANEL: Student preview */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-surface-2/20 overflow-y-auto">
          {/* Preview header with viewport toggle */}
          <div className="shrink-0 border-b border-border px-4 py-2.5 flex items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              Student preview
            </p>
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
              <button
                type="button"
                onClick={() => setViewportMode("desktop")}
                title="Desktop view"
                className={cn(
                  "rounded p-1 transition-colors",
                  viewportMode === "desktop"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Monitor className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setViewportMode("mobile")}
                title="Mobile view"
                className={cn(
                  "rounded p-1 transition-colors",
                  viewportMode === "mobile"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Smartphone className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Preview content */}
          <div className={cn(
            "flex-1 p-4",
            viewportMode === "mobile" ? "flex justify-center" : "",
          )}>
            <div className={cn(viewportMode === "mobile" ? "w-[320px]" : "w-full")}>
              <SATQuestionPreview
                prompt={editing.prompt}
                question_type={editing.question_type}
                choicesText={editing.choicesText}
                correctAnswerText={editing.correctAnswerText}
                explanation={editing.explanation}
                stimulusContext={editing.question_prompt}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
