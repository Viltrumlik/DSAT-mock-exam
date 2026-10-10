/**
 * Loads one exam attempt and owns the writes to it. Create-or-resume on mount, then hold the
 * server's attempt snapshot; save (autosave) and submitModule return the next snapshot and the
 * server stays authoritative. Importer: exam/ExamScreen.tsx.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { makeExamApi, type ExamSource } from "./examApi";
import type { Attempt } from "./types";

export type ExamLoad = "loading" | "error" | "ready";

export interface ExamAttempt {
  attempt: Attempt | null;
  status: ExamLoad;
  submitting: boolean;
  save: (answers: Record<string, string>, flagged: number[]) => void;
  submit: (answers: Record<string, string>, flagged: number[]) => Promise<void>;
}

export function useExamAttempt(source: ExamSource): ExamAttempt {
  const apiRef = useRef(makeExamApi(source));
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [status, setStatus] = useState<ExamLoad>("loading");
  const [submitting, setSubmitting] = useState(false);

  const attemptRef = useRef<Attempt | null>(null);
  attemptRef.current = attempt;
  // Serialises writes so a save and a submit never race on the version token.
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const id = await apiRef.current.createOrResume();
        const a = await apiRef.current.getStatus(id);
        if (alive) {
          setAttempt(a);
          setStatus("ready");
        }
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback((answers: Record<string, string>, flagged: number[]) => {
    const a = attemptRef.current;
    if (!a || a.is_completed) return;
    chain.current = chain.current
      .then(async () => {
        const cur = attemptRef.current;
        if (!cur || cur.is_completed) return;
        try {
          const next = await apiRef.current.save(cur.id, answers, flagged, cur.version_number);
          setAttempt(next);
        } catch {
          /* a dropped autosave is retried by the next change; never surfaced mid-answer */
        }
      })
      .catch(() => {});
  }, []);

  const submit = useCallback(async (answers: Record<string, string>, flagged: number[]) => {
    const a = attemptRef.current;
    if (!a) return;
    setSubmitting(true);
    chain.current = chain.current.then(async () => {
      const cur = attemptRef.current;
      if (!cur) return;
      const next = await apiRef.current.submitModule(cur.id, answers, flagged, cur.version_number);
      setAttempt(next);
    });
    try {
      await chain.current;
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { attempt, status, submitting, save, submit };
}
