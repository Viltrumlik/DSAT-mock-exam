"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Attempt, normalizeFlagged, normalizeSavedAnswers } from "../types";
import { questions as selectQuestions } from "../state/selectors";
import { type ExamDraft, readDraft } from "../services/draftStore";

/**
 * Merge the server snapshot with the local crash-safety draft by recency.
 *
 * The draft is written synchronously on every change, so it can hold answers
 * made inside the autosave debounce window or during a failed save that never
 * reached the server. Its stored `version` is the server `version_number` it was
 * based on: when that is >= the server's current version (or either is unknown)
 * the draft is at least as fresh, so it wins on conflicting questions. In every
 * case the draft fills in answers the server is missing, so nothing pending is
 * dropped — while a strictly-newer server stays authoritative on conflicts.
 */
function mergeServerAndDraft(
  serverAnswers: Record<string, string>,
  serverFlagged: number[],
  serverVersion: number | null,
  draft: ExamDraft | null,
): { answers: Record<string, string>; flagged: number[] } {
  if (!draft) return { answers: serverAnswers, flagged: serverFlagged };

  const draftAtLeastAsFresh =
    draft.version == null || serverVersion == null || draft.version >= serverVersion;

  const answers: Record<string, string> = { ...serverAnswers };
  for (const [qid, value] of Object.entries(draft.answers)) {
    if (draftAtLeastAsFresh || !(qid in serverAnswers)) answers[qid] = value;
  }

  // Flags are advisory (they don't affect grading): union so neither side's
  // flags are dropped when restoring from a draft.
  const flagged = Array.from(new Set([...serverFlagged, ...draft.flagged]));

  return { answers, flagged };
}

export interface UseAnswersResult {
  answers: Record<string, string>;
  flagged: number[];
  eliminated: Record<string, string[]>;
  currentIndex: number;
  /** Module id the current answers belong to — used to gate autosave. */
  moduleId: number | null;

  selectAnswer: (questionId: number, value: string) => void;
  toggleFlag: (questionId: number) => void;
  toggleEliminate: (questionId: number, optionKey: string) => void;
  goTo: (index: number) => void;
  next: () => void;
  prev: () => void;
}

/**
 * Owns per-module student work (answers, flags, eliminations) and navigation.
 *
 * Rehydrates from the server snapshot (with local draft as fallback) whenever
 * the active module changes, and fully resets when the module id changes so
 * Module 1 work can never leak into Module 2.
 */
export function useAnswers(attempt: Attempt | null, attemptId: number | string): UseAnswersResult {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flagged, setFlagged] = useState<number[]>([]);
  const [eliminated, setEliminated] = useState<Record<string, string[]>>({});
  const [currentIndex, setCurrentIndex] = useState(0);

  const moduleId = attempt?.current_module_details?.id ?? null;
  const hydratedModuleRef = useRef<number | null>(null);

  // Rehydrate once per module id.
  useEffect(() => {
    if (moduleId == null) return;
    if (hydratedModuleRef.current === moduleId) return;
    hydratedModuleRef.current = moduleId;

    const serverAnswers = normalizeSavedAnswers(attempt?.current_module_saved_answers);
    const serverFlagged = normalizeFlagged(attempt?.current_module_flagged_questions);

    // Merge server truth with the local draft by recency rather than discarding
    // the draft whenever the server has anything. That "server wins if non-empty"
    // rule threw away answers that lived only in the draft (made inside the
    // autosave debounce window, or during a failed save) on resume.
    const draft = readDraft(attemptId, moduleId);
    const merged = mergeServerAndDraft(
      serverAnswers,
      serverFlagged,
      attempt?.version_number ?? null,
      draft,
    );

    setAnswers(merged.answers);
    setFlagged(merged.flagged);
    setEliminated({});
    setCurrentIndex(0);
  }, [moduleId, attempt?.current_module_saved_answers, attempt?.current_module_flagged_questions, attempt?.version_number, attemptId]);

  const selectAnswer = useCallback((questionId: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  const toggleFlag = useCallback((questionId: number) => {
    setFlagged((prev) => (prev.includes(questionId) ? prev.filter((id) => id !== questionId) : [...prev, questionId]));
  }, []);

  const toggleEliminate = useCallback((questionId: number, optionKey: string) => {
    // Eliminating a chosen option also deselects it.
    setAnswers((prev) => {
      if (prev[questionId] !== optionKey) return prev;
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    setEliminated((prev) => {
      const current = prev[questionId] ?? [];
      const next = current.includes(optionKey)
        ? current.filter((k) => k !== optionKey)
        : [...current, optionKey];
      return { ...prev, [questionId]: next };
    });
  }, []);

  const count = selectQuestions(attempt).length;
  const goTo = useCallback((index: number) => setCurrentIndex(() => Math.max(0, Math.min(index, Math.max(0, count - 1)))), [count]);
  const next = useCallback(() => setCurrentIndex((i) => Math.min(i + 1, Math.max(0, count - 1))), [count]);
  const prev = useCallback(() => setCurrentIndex((i) => Math.max(i - 1, 0)), []);

  return { answers, flagged, eliminated, currentIndex, moduleId, selectAnswer, toggleFlag, toggleEliminate, goTo, next, prev };
}
