"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeApiError } from "@/lib/apiError";

import { useFinishSession, useStartSession } from "../hooks";
import type { SessionResult, SessionSummary, StudyMode } from "../types";

/**
 * `useStartSession` / `useFinishSession` re-throw an *already normalized*
 * `ApiError` from their `onError`, which `normalizeApiError` cannot re-parse
 * (it only understands axios errors), so unwrap that shape first.
 */
function readErrorMessage(e: unknown): string {
  const normalized = normalizeApiError(e);
  if (normalized.status !== 0) return normalized.message;
  const already = e as { status?: unknown; message?: unknown } | null;
  if (already && typeof already.status === "number" && typeof already.message === "string") {
    return already.message;
  }
  return normalized.message;
}

export interface ModeSession {
  /** True once the server has a session row to grade against. */
  ready: boolean;
  /** The grade request is in flight. */
  finishing: boolean;
  /** Server summary — null until `finish` succeeds. */
  summary: SessionSummary | null;
  /** Message for whichever step failed (start or finish); null when healthy. */
  error: string | null;
  /** True when the failure was the *start* call, i.e. the round can't begin. */
  fatal: boolean;
  /** Grade the run. Only the first call counts; later ones are ignored. */
  finish: (results: SessionResult[]) => void;
  /** Re-run whichever step failed. */
  retry: () => void;
}

/**
 * Session plumbing shared by all four modes: open a session on mount, grade it
 * once at the end. `duration_ms` is measured from the moment the server
 * acknowledged the session, so a slow POST doesn't inflate the student's time.
 */
export function useModeSession(setId: number, mode: StudyMode): ModeSession {
  const startMutation = useStartSession();
  const finishMutation = useFinishSession(setId);

  const [sessionId, setSessionId] = useState<number | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // react-query re-creates the mutation result object each render; the refs keep
  // the callbacks below stable so the "start exactly once" effect stays honest.
  const startRef = useRef(startMutation);
  const finishRef = useRef(finishMutation);

  // Declared before the boot effect so the refs are current by the time it runs.
  useEffect(() => {
    startRef.current = startMutation;
    finishRef.current = finishMutation;
  });

  const startedAtRef = useRef(Date.now());
  const sessionIdRef = useRef<number | null>(null);
  const bootedRef = useRef(false);
  const pendingRef = useRef<SessionResult[] | null>(null);
  const inflightRef = useRef(false);

  const begin = useCallback(async () => {
    setError(null);
    setFatal(false);
    try {
      const session = await startRef.current.mutateAsync({ set_id: setId, mode });
      startedAtRef.current = Date.now();
      sessionIdRef.current = session.id;
      setSessionId(session.id);
    } catch (e) {
      setError(readErrorMessage(e));
      setFatal(true);
    }
  }, [setId, mode]);

  const submit = useCallback(() => {
    const results = pendingRef.current;
    const id = sessionIdRef.current;
    if (results == null || id == null || inflightRef.current) return;
    inflightRef.current = true;
    setFinishing(true);
    setError(null);
    finishRef.current
      .mutateAsync({
        sessionId: id,
        duration_ms: Math.max(0, Date.now() - startedAtRef.current),
        results,
      })
      .then((s) => setSummary(s))
      .catch((e) => setError(readErrorMessage(e)))
      .finally(() => {
        inflightRef.current = false;
        setFinishing(false);
      });
  }, []);

  useEffect(() => {
    // A ref latch, not a dependency dance: StrictMode's double-invoked effects
    // would otherwise open two sessions and orphan one.
    if (bootedRef.current) return;
    bootedRef.current = true;
    void begin();
  }, [begin]);

  // Covers the student finishing a very short round before the POST lands.
  useEffect(() => {
    if (sessionId != null) submit();
  }, [sessionId, submit]);

  const finish = useCallback(
    (results: SessionResult[]) => {
      if (pendingRef.current != null) return;
      pendingRef.current = results;
      submit();
    },
    [submit],
  );

  const retry = useCallback(() => {
    if (sessionIdRef.current == null) {
      void begin();
      return;
    }
    submit();
  }, [begin, submit]);

  return { ready: sessionId != null, finishing, summary, error, fatal, finish, retry };
}
