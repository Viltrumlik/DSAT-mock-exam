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

/** Monotonic milliseconds: a wall-clock step (a Windows time sync) must not move the deadline. */
const monoNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export interface Countdown {
  remaining: number;
  /** The module this countdown is counting for — compare before acting on `remaining`. */
  moduleId: number;
}

/**
 * The module's countdown. Three rules, each a bug it once had:
 *   - it belongs to ITS module: a module change re-anchors synchronously, during the render that
 *     shows the new module — an effect-based reset left one render carrying the old module's 0,
 *     and the 0:00 auto-submit fired again on module 2 with module 1's answers;
 *   - it runs on the monotonic clock, so a laptop's clock jumping forward can't end a module early;
 *   - a newer snapshot re-anchors it only DOWNWARD (the server says less time is left), because a
 *     replayed reply can carry an old, larger remaining_seconds.
 * While `paused` it freezes, and resumes from where it stopped.
 */
export function useCountdown(attempt: Attempt, paused = false): Countdown {
  const moduleId = attempt.current_module_details?.id ?? 0;
  const anchor = useRef<{ moduleId: number; deadline: number } | null>(null);
  const frozen = useRef<number | null>(null);
  const wasPaused = useRef(false);

  if (!anchor.current || anchor.current.moduleId !== moduleId) {
    anchor.current = { moduleId, deadline: monoNow() + initialRemaining(attempt) * 1000 };
    frozen.current = null;
    wasPaused.current = false;
  }
  if (paused && !wasPaused.current) {
    frozen.current = Math.max(0, anchor.current.deadline - monoNow());
  } else if (!paused && wasPaused.current && frozen.current != null) {
    anchor.current.deadline = monoNow() + frozen.current;
    frozen.current = null;
  }
  wasPaused.current = paused;

  useEffect(() => {
    const a = anchor.current;
    if (!a || a.moduleId !== moduleId || attempt.is_paused || typeof attempt.remaining_seconds !== "number") return;
    const implied = monoNow() + Math.max(0, attempt.remaining_seconds) * 1000;
    if (implied < a.deadline - 2000) a.deadline = implied;
  }, [attempt, moduleId]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  const ms = frozen.current ?? anchor.current.deadline - monoNow();
  return { remaining: Math.max(0, Math.round(ms / 1000)), moduleId };
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
