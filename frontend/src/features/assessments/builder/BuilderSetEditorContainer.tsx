"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { DownloadQuestionsCsvButton } from "@/features/questionsAdmin/DownloadQuestionsCsvButton";
import { QuestionBankPickerModal } from "./QuestionBankPickerModal";
import { AssessmentCategorySelect } from "@/features/assessments/components/AssessmentCategorySelect";
import { allowedSourcesForSubject, reconcileSource, sourceLabel } from "@/lib/assessmentSources";
import {
  levelsForSubject,
  levelLabel,
  reconcileSecondaryLevel,
  secondaryLevelOptions,
} from "@/lib/levels";
import { AssessmentQuestionEditorFields } from "@/features/assessments/components/AssessmentQuestionEditorFields";
import type {
  AssessmentQuestion,
  AssessmentQuestionType,
  AssessmentSet,
  ReviewStatus,
} from "@/features/assessments/types";
import { REVIEW_STATUS_LABELS } from "@/features/assessments/types";
import { normalizeApiError, formatApiErrorForToast } from "@/lib/apiError";
import { useToast } from "@/components/ToastProvider";
import { normalizeQuestionList } from "@/features/assessments/builder/normalize";
import {
  useBuilderStore,
  useBuilderViewSet,
} from "@/features/assessments/builder/store";
import { SATQuestionPreview } from "@/features/assessments/builder/SATQuestionPreview";
import { QuestionGhost, QuestionRow } from "@/features/assessments/builder/QuestionRow";
import { FormulaToolbar } from "@/components/FormulaToolbar";
import { writeStudioSession } from "@/lib/studioSession";
import { recordRecent } from "@/features/console/recent";
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
import { Icon, type IconName } from "@/components/ui/Icon";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Kbd,
  Menu,
  Segmented,
  Select,
  buttonClass,
  inputShell,
  prefersReducedMotion,
  useModKey,
  type BadgeTone,
} from "@/features/console/ui";
import { cn } from "@/lib/cn";

// ─── Constants ────────────────────────────────────────────────────────────────

const REVIEW_STATUS_TONE: Record<ReviewStatus, BadgeTone> = {
  draft: "neutral",
  needs_review: "attention",
  approved: "positive",
};
const REVIEW_STATUS_ORDER: ReviewStatus[] = ["draft", "needs_review", "approved"];

/** The console field shell (design handoff v0.3, PR 17b), on the set metadata's inputs and selects. */
const INPUT = inputShell({
  className:
    "w-full outline-none placeholder:text-ms-fg-3 disabled:cursor-not-allowed disabled:bg-ms-surface-2 disabled:text-ms-fg-disabled",
});
const AREA = inputShell({ area: true, className: "w-full outline-none placeholder:text-ms-fg-3" });

const LABEL = "mb-1.5 block text-[14px] font-medium leading-5 text-ms-fg";
const EYEBROW = "text-ms-over uppercase text-ms-fg-3";

/** The lifted question settles into its slot on the console's curve (Motion board). */
const DROP: DropAnimation = {
  duration: 200,
  easing: "cubic-bezier(.2,.8,.2,1)",
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0" } } }),
};

const NOTICE = {
  attention: { box: "border-ms-attention-line bg-ms-attention-soft text-ms-attention-fg", icon: "lock" },
  critical: { box: "border-ms-critical-line bg-ms-critical-soft text-ms-critical-fg", icon: "alert" },
} satisfies Record<string, { box: string; icon: IconName }>;
const NOTICE_BOX = "animate-ms-fade-in flex items-start gap-2.5 rounded-ms-ctl border px-3.5 py-2.5 text-[14px] leading-5";

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

  // Studio home's "Continue where you left off" (BuilderHome board).
  const savedTitle = (detail.data as { title?: string } | undefined)?.title;
  useEffect(() => {
    if (!Number.isFinite(setId) || setId <= 0 || !detail.data) return;
    recordRecent({ kind: "set", id: setId, name: savedTitle || `Set ${setId}`, href: `/builder/sets/${setId}` });
  }, [setId, detail.data, savedTitle]);

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
  // Save only / Save & next / Save & new — picked from the menu beside Save (a console Menu closes itself).
  const [saveMode, setSaveMode] = useState<"save" | "save-next" | "save-new">("save");

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

  // ── Reorder: a drag or ⌥↑ / ⌥↓ ─────────────────────────────────────────────
  // The outline shows the new order at once (`pendingOrder`) and goes back to the server's if it refuses.
  const [pendingOrder, setPendingOrder] = useState<number[] | null>(null);
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const [reduceMotion] = useState(prefersReducedMotion);
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());
  const focusAfterMove = useRef<number | null>(null);
  const [moveNote, setMoveNote] = useState("");

  const shownQuestions = useMemo(() => {
    if (!pendingOrder) return questions;
    const byId = new Map(questions.map((q) => [q.id, q]));
    const ordered = pendingOrder.map((id) => byId.get(id)).filter((q): q is AssessmentQuestion => Boolean(q));
    return ordered.length === questions.length ? ordered : questions;
  }, [questions, pendingOrder]);

  useEffect(() => {
    const id = focusAfterMove.current;
    if (id == null) return;
    focusAfterMove.current = null;
    rowRefs.current.get(id)?.focus();
  }, [shownQuestions]);

  const saveOrder = async (nextIds: number[]) => {
    pushUndoPoint();
    setPendingOrder(nextIds);
    try {
      // Single atomic reorder: the backend reindexes ALL questions to a dense,
      // unique 0..n-1 under a set row-lock. Replaces the old N-PATCH loop, which
      // left duplicate/gapped orders if a request failed midway.
      // The moved ids go as they are: `normalizeQuestionList` re-sorts by the OLD `order`, so running the
      // moved list through it (as this did until PR 17b) sent the unchanged order and a drag never stuck.
      await assessmentAuthoringApi.reorderQuestions(setId, nextIds);
      await detail.refetch();
      toast.push({ tone: "success", message: "Order saved." });
    } catch (e) {
      toast.push({ tone: "error", message: formatApiErrorForToast(e) });
    } finally {
      setPendingOrder(null);
    }
  };

  const onDragStart = (event: DragStartEvent) => setActiveDragId(Number(event.active.id));

  const onDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id || pendingOrder) return;
    const ids = shownQuestions.map((q) => q.id);
    const oldIndex = ids.indexOf(Number(active.id));
    const newIndex = ids.indexOf(Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    await saveOrder(arrayMove(ids, oldIndex, newIndex));
  };

  // ⌥↑ / ⌥↓: the drag without a mouse. The moved row keeps the keyboard focus and a polite line says where.
  const moveQuestion = (id: number, delta: -1 | 1) => {
    if (pendingOrder) return;
    const ids = shownQuestions.map((q) => q.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    focusAfterMove.current = id;
    setMoveNote(`Q${from + 1} moved to position ${to + 1} of ${ids.length}.`);
    void saveOrder(arrayMove(ids, from, to));
  };

  // ── Delete a question: Yes on the row; a 409 (student answers) asks again in the console dialog ──
  const [forceDeleteQ, setForceDeleteQ] = useState<{ id: number; n: number } | null>(null);
  const [forceDeleteOpen, setForceDeleteOpen] = useState(false);
  const applyDeleted = (qId: number) => {
    removeQuestionPatch(qId);
    if (selectedQuestionId === qId) selectQuestion(null);
    toast.push({ tone: "success", message: "Deleted." });
  };
  const deleteQuestion = async (qId: number, n: number) => {
    pushUndoPoint();
    try {
      await delQuestion.mutateAsync(qId);
      applyDeleted(qId);
    } catch (e) {
      const err = normalizeApiError(e);
      // 409 = the question has student answers (PROTECT). Offer to
      // force-delete it along with those answers; scores are kept.
      if (err.status === 409) {
        setForceDeleteQ({ id: qId, n });
        setForceDeleteOpen(true);
      } else {
        toast.push({ tone: "error", message: err.message });
      }
    }
  };
  const forceDelete = async () => {
    if (!forceDeleteQ) return;
    try {
      await delQuestion.mutateAsync({ questionId: forceDeleteQ.id, force: true });
    } catch (e2) {
      throw new Error(normalizeApiError(e2).message);
    }
    applyDeleted(forceDeleteQ.id);
  };

  const saveSetMeta = async () => {
    if (!view) return;
    try {
      await upsertSet.mutateAsync({
        id: view.id,
        // A WHITELIST: a field left out here is silently never saved. secondary_level is
        // the optional second cohort (2026-10-11, the school's request); "" clears it.
        payload: {
          title: view.title,
          category: view.category,
          description: view.description,
          source: view.source ?? "",
          level: view.level ?? "",
          secondary_level: view.secondary_level ?? "",
        },
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
  const metaId = useId();
  const mod = useModKey();

  if (isLoading && !view) {
    return (
      <div className="ms flex min-h-dvh items-center justify-center" data-ms-temp="builder" aria-busy="true" aria-label="Loading">
        <Icon name="loader" className="size-8 animate-ms-spin text-ms-fg-3" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="ms flex min-h-dvh items-center justify-center p-6" data-ms-temp="builder">
        <div role="alert" className="animate-ms-card-in flex max-w-md flex-col items-start gap-3 rounded-ms-card bg-ms-card p-6 shadow-ms-1">
          <span className="grid size-10 place-items-center rounded-[12px] bg-ms-critical-soft text-ms-critical-fg">
            <Icon name="alert" />
          </span>
          <h1 className="text-[20px] font-bold leading-7 text-ms-fg">Failed to load</h1>
          <p className="text-[14px] text-ms-fg-2">{String((error as any)?.message || error)}</p>
          <Button variant="secondary" icon="refresh" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="ms flex min-h-dvh flex-col items-center justify-center gap-3 p-6" data-ms-temp="builder">
        <p className="text-[16px] font-semibold text-ms-fg-2">Set not found.</p>
        <Link href="/builder/sets" className={buttonClass({ variant: "secondary" })}>
          <Icon name="left" size="sm" />
          Sets
        </Link>
      </div>
    );
  }

  const isPublished = Boolean((view as any)?.is_active);
  const reviewStatus = (((detail.data as any)?.review_status ?? "draft") as ReviewStatus);
  const activeDragQ = activeDragId != null ? shownQuestions.find((q) => q.id === activeDragId) ?? null : null;
  const activeDragIndex = activeDragQ ? shownQuestions.indexOf(activeDragQ) : -1;
  const saveLabel = upsertQuestion.isPending
    ? "Saving…"
    : saveMode === "save-next"
      ? "Save & Next"
      : saveMode === "save-new"
        ? "Save & New"
        : editing.questionId
          ? "Save changes"
          : "Create";
  const saveDisabled = upsertQuestion.isPending || versionOutdated;
  const metaDisabled = upsertSet.isPending || versionOutdated;

  return (
    <div className="ms flex min-h-dvh flex-col lg:h-dvh" data-ms-temp="builder">
      {/* ── Top bar: the way back, the set, its review status, Undo / Redo (Shell board, "Builder editor") ── */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-ms-border bg-ms-card px-3 py-2.5 sm:px-4 lg:min-h-16 lg:px-5">
        <Link href="/builder/sets" className={buttonClass({ variant: "ghost", size: "sm", className: "-ml-1" })}>
          <Icon name="left" size="sm" />
          Sets
        </Link>
        <span aria-hidden className="h-6 w-px shrink-0 bg-ms-border-strong max-sm:hidden" />
        {/* On a phone the set takes its own line under the way back, and the actions the next. */}
        <div className="min-w-0 flex-1 max-sm:basis-full">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="text-[13px] font-semibold tabular-nums text-ms-fg-3">#{view.id}</span>
            <h1 className="min-w-0 truncate font-ms-display text-[17px] font-bold leading-6 tracking-[-0.01em] text-ms-fg">
              {view.title || "Untitled set"}
            </h1>
            <Badge tone={REVIEW_STATUS_TONE[reviewStatus]}>{REVIEW_STATUS_LABELS[reviewStatus]}</Badge>
            {/* The select is w-full; its width comes from this wrapper (cn does not merge a w-[…] over it). */}
            <span className="w-[150px] shrink-0">
              <Select<ReviewStatus>
                aria-label="Review status"
                value={reviewStatus}
                disabled={setReviewStatus.isPending}
                onChange={(rs) => {
                  if (rs !== reviewStatus) changeReviewStatus(rs);
                }}
                options={REVIEW_STATUS_ORDER.map((opt) => ({
                  value: opt,
                  label: REVIEW_STATUS_LABELS[opt],
                  disabledReason: opt === "approved" && !canApprove ? "Only an admin can approve" : undefined,
                }))}
              />
            </span>
            {isPublished ? (
              <Badge tone="positive" dot>
                Published
              </Badge>
            ) : (
              <Badge tone="line">Draft</Badge>
            )}
            {dirty ? (
              <Badge tone="attention" dot>
                Unsaved
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-[13px] text-ms-fg-2">
            {view.subject} · {view.category || "No category"} · {questions.length} question{questions.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon="undo" disabled={!pastLen || versionOutdated} onClick={() => undo()} title="Undo (⌘Z)">
            Undo
          </Button>
          <Button variant="secondary" size="sm" disabled={!futureLen || versionOutdated} onClick={() => redo()} title="Redo (⇧⌘Z)">
            <Icon name="undo" size="sm" className="-scale-x-100" />
            Redo
          </Button>
          {validation.length > 0 ? (
            <span title="Fix these before this set can be approved">
              <Badge tone="attention" icon="warn">
                {validation.length} issue{validation.length !== 1 ? "s" : ""} to fix
              </Badge>
            </span>
          ) : null}
        </div>
      </header>

      {/* ── Notices: published (edits make a new revision), and an outdated copy ── */}
      {isPublished || versionOutdated ? (
        <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 sm:px-4 lg:px-5">
          {isPublished ? (
            <div role="status" className={cn(NOTICE_BOX, NOTICE.attention.box)}>
              <Icon name={NOTICE.attention.icon} size="sm" className="mt-0.5 shrink-0" />
              <p>
                <strong className="font-semibold">Published set.</strong> Any edits you save will create a new revision
                automatically. Existing student attempts are not affected.
              </p>
            </div>
          ) : null}
          {versionOutdated ? (
            <div role="alert" className={cn(NOTICE_BOX, "items-center", NOTICE.critical.box)}>
              <Icon name={NOTICE.critical.icon} size="sm" className="shrink-0" />
              <p className="flex-1 font-semibold">This set was updated elsewhere while you had unsaved edits.</p>
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                Reload
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Three panes; on a phone they stack ── */}
      <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:flex-row">
        {/* LEFT: the outline — add questions, the questions in order, the set's issues and metadata */}
        <aside
          aria-label="Questions in this set"
          className="flex shrink-0 flex-col border-ms-border bg-ms-card max-lg:border-b lg:w-[300px] lg:border-r"
        >
          <div className="flex shrink-0 flex-col gap-2 border-b border-ms-line p-3">
            <Button variant="primary" icon="plus" className="w-full" onClick={newQuestion}>
              New question
            </Button>
            <Button variant="secondary" icon="library" className="w-full" onClick={() => setPickerOpen(true)}>
              Add from Question Bank
            </Button>
            <Button
              variant="secondary"
              icon="upload"
              className="w-full"
              state={csvBusy ? "busy" : "idle"}
              busyLabel="Importing…"
              onClick={() => csvInputRef.current?.click()}
              title="Append questions from a CSV file (columns: question_type, prompt, option_a–d, correct_answer, points, explanation)"
            >
              Import CSV
            </Button>
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
            {/* Renders only for super_admin; the endpoint 403s for anyone else. Same
                columns as the importer above, so a downloaded file goes back in. */}
            <DownloadQuestionsCsvButton
              fetchCsv={() => assessmentAuthoringApi.exportQuestionsCsv(setId)}
              fallbackName={`assessment-${setId}-questions`}
              title="Download every question in this set, with its answer key"
            />
          </div>

          <QuestionBankPickerModal
            open={pickerOpen}
            subject={bankSubject}
            busy={pickerBusy}
            onClose={() => setPickerOpen(false)}
            onAdd={(bankQuestionId) => void addFromBank(bankQuestionId)}
          />

          {/* The questions, in order: dragged (lifted) or ⌥↑ / ⌥↓ to reorder */}
          <div className="flex flex-col gap-1 p-2 max-lg:max-h-[50vh] max-lg:overflow-y-auto lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {shownQuestions.length === 0 ? (
              <EmptyState icon="ms-question" title="No questions yet" detail={`Click "New question" to add the first one`} />
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={onDragStart}
                onDragCancel={() => setActiveDragId(null)}
                onDragEnd={(e) => void onDragEnd(e)}
              >
                <SortableContext items={shownQuestions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                  {shownQuestions.map((q, idx) => (
                    <QuestionRow
                      key={q.id}
                      q={q}
                      index={idx}
                      active={q.id === selectedQuestionId}
                      reordering={Boolean(pendingOrder)}
                      reduceMotion={reduceMotion}
                      onSelect={() => selectQuestion(q.id)}
                      onDelete={() => void deleteQuestion(q.id, idx + 1)}
                      onMove={(delta) => moveQuestion(q.id, delta)}
                      rowRef={(el) => {
                        if (el) rowRefs.current.set(q.id, el);
                        else rowRefs.current.delete(q.id);
                      }}
                    />
                  ))}
                </SortableContext>
                {/* The lifted question, under the pointer. */}
                <DragOverlay dropAnimation={reduceMotion ? null : DROP}>
                  {activeDragQ ? <QuestionGhost q={activeDragQ} index={activeDragIndex} /> : null}
                </DragOverlay>
              </DndContext>
            )}
            {pendingOrder ? (
              <div className="animate-ms-fade-in mt-1 flex items-center gap-1.5 rounded-[10px] bg-ms-surface-2 px-3 py-2 text-[13px] font-medium text-ms-fg-2">
                <Icon name="loader" size="sm" className="size-3.5 animate-ms-spin" />
                Saving order…
              </div>
            ) : null}
            <p aria-live="polite" className="sr-only">
              {moveNote}
            </p>
          </div>

          {shownQuestions.length > 1 ? (
            <p className="flex shrink-0 items-center gap-1 border-t border-ms-line px-4 py-2.5 text-[13px] text-ms-fg-3">
              <Kbd>{mod === "⌘" ? "⌥" : "Alt"}</Kbd>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span className="ml-1">move a question</span>
            </p>
          ) : null}

          {/* Validation summary */}
          {validation.length > 0 && (
            <div className="shrink-0 border-t border-ms-line px-4 py-3">
              <p className="mb-2 text-ms-over uppercase text-ms-critical-fg">
                {validation.length} validation issue{validation.length !== 1 ? "s" : ""}
              </p>
              <ul className="flex flex-col gap-1">
                {validation.slice(0, 5).map((e, i) => (
                  <li key={i} className="text-[13px] leading-[18px] text-ms-fg-2">
                    <span className="font-semibold text-ms-fg">{e.scope}</span>: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Set metadata (collapsible) */}
          <div className="shrink-0 border-t border-ms-line">
            <button
              type="button"
              aria-expanded={metaOpen}
              aria-controls={`${metaId}-meta`}
              onClick={() => setMetaOpen((v) => !v)}
              className="ms-transition flex w-full items-center justify-between px-4 py-3 text-[14px] font-semibold text-ms-fg hover:bg-ms-surface"
            >
              Set metadata
              <Icon name="down" size="sm" className={cn("text-ms-fg-3 transition-transform duration-200", metaOpen && "rotate-180")} />
            </button>
            {metaOpen && (
              <div id={`${metaId}-meta`} className="animate-ms-fade-in flex flex-col gap-3 border-t border-ms-line p-3 lg:max-h-[40vh] lg:overflow-y-auto">
                <div>
                  <label htmlFor={`${metaId}-title`} className={LABEL}>
                    Title
                  </label>
                  <input
                    id={`${metaId}-title`}
                    className={INPUT}
                    value={String(view.title || "")}
                    onChange={(e) => patchSetTracked({ title: e.target.value })}
                    placeholder="Set title"
                  />
                </div>
                <div>
                  <label htmlFor={`${metaId}-category`} className={LABEL}>
                    Category
                  </label>
                  <AssessmentCategorySelect
                    id={`${metaId}-category`}
                    subject={view.subject === "math" ? "math" : "english"}
                    value={String(view.category || "")}
                    onChange={(v) => patchSetTracked({ category: v })}
                    className={INPUT}
                    disabled={metaDisabled}
                  />
                </div>
                <div>
                  <label htmlFor={`${metaId}-source`} className={LABEL}>
                    Source
                  </label>
                  <select
                    id={`${metaId}-source`}
                    className={INPUT}
                    value={String(view.source || "")}
                    onChange={(e) => patchSetTracked({ source: e.target.value })}
                    disabled={metaDisabled}
                  >
                    <option value="">None</option>
                    {allowedSourcesForSubject(view.subject, [view.level, view.secondary_level]).map((s) => (
                      <option key={s} value={s}>{sourceLabel(s)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${metaId}-level`} className={LABEL}>
                    Level
                  </label>
                  <select
                    id={`${metaId}-level`}
                    className={INPUT}
                    value={String(view.level || "")}
                    onChange={(e) => {
                      const level = e.target.value;
                      // Blanking the primary, or moving it onto the second level, clears
                      // the second level in the same undo step — the server rejects
                      // either pair, and this way the save just works. Same for a
                      // Foundation homework source once no level is Foundation.
                      const secondary_level = reconcileSecondaryLevel(view.subject, level, view.secondary_level);
                      patchSetTracked({
                        level,
                        secondary_level,
                        source: reconcileSource(view.subject, view.source, [level, secondary_level]),
                      });
                    }}
                    disabled={metaDisabled}
                  >
                    <option value="">None</option>
                    {levelsForSubject(view.subject).map((l) => (
                      <option key={l} value={l}>{levelLabel(l)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  {/* Optional second level (2026-10-11, the school's request): the set is
                      also shown to this cohort. Needs a primary first. */}
                  <label htmlFor={`${metaId}-second`} className={LABEL}>
                    Second level (optional)
                  </label>
                  <select
                    id={`${metaId}-second`}
                    className={INPUT}
                    value={String(view.secondary_level || "")}
                    onChange={(e) =>
                      patchSetTracked({
                        secondary_level: e.target.value,
                        source: reconcileSource(view.subject, view.source, [view.level, e.target.value]),
                      })
                    }
                    disabled={metaDisabled || !view.level}
                  >
                    <option value="">None</option>
                    {secondaryLevelOptions(view.subject, view.level).map((l) => (
                      <option key={l} value={l}>{levelLabel(l)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${metaId}-description`} className={LABEL}>
                    Description
                  </label>
                  <textarea
                    id={`${metaId}-description`}
                    className={cn(AREA, "min-h-[80px]")}
                    value={String(view.description || "")}
                    onChange={(e) => patchSetTracked({ description: e.target.value })}
                    placeholder="Optional description"
                  />
                </div>
                <Button
                  variant="secondary"
                  icon="check"
                  className="w-full"
                  state={upsertSet.isPending ? "busy" : "idle"}
                  busyLabel="Saving…"
                  disabled={metaDisabled}
                  onClick={() => void saveSetMeta()}
                >
                  Save metadata
                </Button>
              </div>
            )}
          </div>
        </aside>

        {/* CENTRE: the question being edited */}
        <main className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
          {/* ── Formula toolbar — sticky, never scrolls away ─────────────── */}
          <div className="shrink-0 border-b border-ms-border bg-ms-card">
            <p className={cn(EYEBROW, "px-3 pt-2")}>Formula insert — click a symbol, then type in a field below</p>
            <FormulaToolbar onInsert={(snippet, cursorOffset) => formulaInsertRef.current?.(snippet, cursorOffset)} />
          </div>

          {/* ── Scrollable form body ─────────────────────────────────────── */}
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
              {/* Heading — Q{n}/{total} nav, Duplicate, and Save with its modes */}
              <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="left"
                      aria-label="Previous question"
                      shortcut="⌘["
                      disabled={currentIndex <= 0 || upsertQuestion.isPending}
                      onClick={() => navigateTo(currentIndex - 1)}
                    />
                    <span className="min-w-[88px] text-center text-[13px] font-semibold tabular-nums text-ms-fg-2">
                      {currentIndex >= 0
                        ? `Q${currentIndex + 1} / ${questions.length}`
                        : questions.length > 0
                          ? `New · ${questions.length} total`
                          : "New question"}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="right"
                      aria-label="Next question"
                      shortcut="⌘]"
                      disabled={currentIndex < 0 || currentIndex >= questions.length - 1 || upsertQuestion.isPending}
                      onClick={() => navigateTo(currentIndex + 1)}
                    />
                    {editing.questionId ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="clipboard"
                        disabled={upsertQuestion.isPending}
                        onClick={() => void duplicateQuestion()}
                        title="Duplicate this question"
                        className="ml-1"
                      >
                        Duplicate
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-ms-over uppercase text-ms-primary-text">
                    {editing.questionId ? `Question #${editing.questionId}` : "New question"}
                  </p>
                  <h2 className="mt-0.5 font-ms-display text-[22px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">
                    {editing.questionId ? "Edit question" : "Create question"}
                  </h2>
                </div>

                {/* Save, and beside it the menu that picks what happens after a save */}
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="primary"
                    icon="check"
                    state={upsertQuestion.isPending ? "busy" : "idle"}
                    busyLabel="Saving…"
                    disabled={saveDisabled}
                    onClick={() => void saveQuestion()}
                  >
                    {saveLabel}
                  </Button>
                  <Menu
                    label="Save options"
                    icon="down"
                    variant="primary"
                    disabled={saveDisabled}
                    items={(
                      [
                        { mode: "save", label: "Save only" },
                        { mode: "save-next", label: "Save & next →" },
                        { mode: "save-new", label: "Save & new question" },
                      ] as const
                    ).map(({ mode, label }) => ({
                      label,
                      icon: saveMode === mode ? ("check" as const) : undefined,
                      onSelect: () => setSaveMode(mode),
                    }))}
                  />
                </div>
              </div>

              {/* Empty state when nothing selected */}
              {!selectedQuestionId && !editing.prompt && (
                <div className="animate-ms-fade-in mb-8 rounded-ms-card border border-dashed border-ms-border-strong p-6 text-center text-[14px] text-ms-fg-2">
                  Select a question from the left to edit it, or click{" "}
                  <button type="button" onClick={newQuestion} className="font-semibold text-ms-primary-text hover:underline">
                    New question
                  </button>{" "}
                  to create one.
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
              <div className="mt-8 flex justify-end border-t border-ms-line pt-6">
                <Button
                  variant="primary"
                  state={upsertQuestion.isPending ? "busy" : "idle"}
                  busyLabel="Saving…"
                  disabled={saveDisabled}
                  onClick={() => void saveQuestion()}
                >
                  {editing.questionId ? "Save changes" : "Create question"}
                </Button>
              </div>
            </div>
          </div>
        </main>

        {/* RIGHT: what the student sees */}
        <aside
          aria-label="Student preview"
          className="flex shrink-0 flex-col border-ms-border bg-ms-surface max-lg:border-t lg:w-80 lg:overflow-y-auto lg:border-l"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ms-line px-4 py-2.5">
            <p className={cn(EYEBROW, "flex items-center gap-1.5")}>
              <Icon name="eye" size="sm" className="size-3.5" />
              Student preview
            </p>
            <Segmented<"desktop" | "mobile">
              label="Preview size"
              size="sm"
              value={viewportMode}
              onChange={setViewportMode}
              options={[
                { value: "desktop", icon: "monitor", label: <span className="sr-only">Desktop view</span> },
                { value: "mobile", icon: "mobile", label: <span className="sr-only">Mobile view</span> },
              ]}
            />
          </div>
          <div className={cn("flex-1 p-4", viewportMode === "mobile" && "flex justify-center")}>
            <div className={cn(viewportMode === "mobile" ? "w-[320px] max-w-full" : "w-full")}>
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

      {/* A question with student answers: delete it anyway? (was the browser's confirm) */}
      <ConfirmDialog
        open={forceDeleteOpen}
        onClose={() => setForceDeleteOpen(false)}
        tone="critical"
        icon="trash"
        title={forceDeleteQ ? `Delete Q${forceDeleteQ.n} anyway?` : "Delete it anyway?"}
        confirmLabel="Delete anyway"
        busyLabel="Deleting…"
        onConfirm={forceDelete}
      >
        <p>This question already has student answers.</p>
        <p>This also removes those answer records (existing scores are not changed). This cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}
