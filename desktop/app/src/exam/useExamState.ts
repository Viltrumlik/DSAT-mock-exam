/**
 * The runner's local state: a module countdown and the student's in-module work (answers, flags,
 * eliminations, which question is on screen). The server stays the source of truth for the clock
 * and the saved answers — this seeds from the attempt snapshot and re-seeds when the module
 * changes. Autosave + submit are wired in the next increment.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Attempt } from "./types";
import { moduleLimitSeconds } from "./util";

function initialRemaining(a: Attempt): number {
  if (typeof a.remaining_seconds === "number") return Math.max(0, Math.round(a.remaining_seconds));
  return moduleLimitSeconds(a);
}

/** A countdown anchored to a fixed deadline, re-anchored only when the module id changes. */
export function useCountdown(attempt: Attempt): number {
  const moduleId = attempt.current_module_details?.id ?? 0;
  const deadlineRef = useRef<number>(Date.now() + initialRemaining(attempt) * 1000);
  const [remaining, setRemaining] = useState<number>(() => initialRemaining(attempt));

  useEffect(() => {
    deadlineRef.current = Date.now() + initialRemaining(attempt) * 1000;
    const tick = () => setRemaining(Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  return remaining;
}

function seedAnswers(a: Attempt): Record<number, string> {
  const saved = a.current_module_saved_answers ?? {};
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(saved)) {
    const id = Number(k);
    if (!Number.isNaN(id) && v != null) out[id] = String(v);
  }
  return out;
}

export interface RunnerState {
  index: number;
  answers: Record<number, string>;
  flagged: Set<number>;
  eliminated: Record<number, Set<string>>;
  select: (qid: number, value: string) => void;
  toggleFlag: (qid: number) => void;
  toggleEliminate: (qid: number, key: string) => void;
  goTo: (i: number) => void;
  next: () => void;
  prev: () => void;
}

export function useRunner(attempt: Attempt): RunnerState {
  const count = attempt.current_module_details?.questions.length ?? 0;
  const moduleId = attempt.current_module_details?.id ?? 0;

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>(() => seedAnswers(attempt));
  const [flagged, setFlagged] = useState<Set<number>>(() => new Set(attempt.current_module_flagged_questions ?? []));
  const [eliminated, setEliminated] = useState<Record<number, Set<string>>>({});

  useEffect(() => {
    setIndex(0);
    setAnswers(seedAnswers(attempt));
    setFlagged(new Set(attempt.current_module_flagged_questions ?? []));
    setEliminated({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  const select = useCallback((qid: number, value: string) => {
    setAnswers((a) => ({ ...a, [qid]: value }));
  }, []);

  const toggleFlag = useCallback((qid: number) => {
    setFlagged((f) => {
      const n = new Set(f);
      if (n.has(qid)) n.delete(qid);
      else n.add(qid);
      return n;
    });
  }, []);

  const toggleEliminate = useCallback((qid: number, key: string) => {
    setEliminated((e) => {
      const cur = new Set(e[qid] ?? []);
      if (cur.has(key)) cur.delete(key);
      else cur.add(key);
      return { ...e, [qid]: cur };
    });
  }, []);

  const goTo = useCallback((i: number) => setIndex(Math.max(0, Math.min(count - 1, i))), [count]);
  const next = useCallback(() => setIndex((i) => Math.min(count - 1, i + 1)), [count]);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  return { index, answers, flagged, eliminated, select, toggleFlag, toggleEliminate, goTo, next, prev };
}
