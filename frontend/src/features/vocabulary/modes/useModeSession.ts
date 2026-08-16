"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeApiError } from "@/lib/apiError";

import { vocabularyApi } from "../api";
import { useFinishSession, useStartSession } from "../hooks";
import { useLaunchAssignmentId } from "../launchContext";
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

/**
 * Unsent-tail bookkeeping. Both the unload flush and the completing finish hit
 * an endpoint that APPENDS what it is given, so every result must reach the
 * server exactly once: `take` hands over only what has not gone out yet, and
 * `restore` re-queues a batch whose request failed.
 *
 * Exported for its unit test; a mode only ever sees the hook.
 */
export function createResultLedger() {
  const all: SessionResult[] = [];
  let sent = 0;
  return {
    append(result: SessionResult) {
      all.push(result);
    },
    /** Everything not yet handed to the server, marked as sent. */
    take(): SessionResult[] {
      const tail = all.slice(sent);
      sent = all.length;
      return tail;
    },
    /** Give a batch back after a send the server never received. */
    restore(tail: SessionResult[]) {
      sent -= tail.length;
    },
    get unsent(): number {
      return all.length - sent;
    },
  };
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
  /**
   * Record one graded answer, the moment it is graded. Reporting as the student
   * plays is what gives an abandoned round something to flush.
   */
  report: (result: SessionResult) => void;
  /** Grade the run. Only the first call counts; later ones are ignored. */
  finish: () => void;
  /** Re-run whichever step failed. */
  retry: () => void;
}

/**
 * Session plumbing shared by all four modes: open a session on mount, report
 * each answer as it happens, grade it once at the end. `duration_ms` is measured
 * from the moment the server acknowledged the session, so a slow POST doesn't
 * inflate the student's time.
 *
 * A student who leaves mid-round used to record nothing. The unsent answers are
 * now flushed on the way out (`partial`, so the set is not marked complete), and
 * the ledger guarantees the server's append can never see the same answer twice.
 *
 * The launch homework is read here rather than taken as an argument so all four
 * modes are bound the same way and none can forget: the mode components are
 * mounted by page files outside this feature that pass nothing but `setId`, so
 * a prop would have to be plumbed through files this feature does not own.
 * Only the START call carries it — a session is bound once, when it is created,
 * and neither the partial flush nor the finish can re-point it.
 */
export function useModeSession(setId: number, mode: StudyMode): ModeSession {
  const startMutation = useStartSession();
  const finishMutation = useFinishSession(setId);
  const assignmentId = useLaunchAssignmentId();

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
  const ledgerRef = useRef(createResultLedger());
  /** The round has ended and `finish` owns the session from here. */
  const completingRef = useRef(false);
  /** The server has stamped `completed_at`; nothing more may be sent. */
  const completedRef = useRef(false);
  const inflightRef = useRef(false);

  const begin = useCallback(async () => {
    setError(null);
    setFatal(false);
    try {
      const session = await startRef.current.mutateAsync({
        set_id: setId,
        mode,
        assignment_id: assignmentId,
      });
      startedAtRef.current = Date.now();
      sessionIdRef.current = session.id;
      setSessionId(session.id);
    } catch (e) {
      setError(readErrorMessage(e));
      setFatal(true);
    }
  }, [setId, mode, assignmentId]);

  const submit = useCallback(() => {
    const id = sessionIdRef.current;
    if (!completingRef.current || id == null || inflightRef.current || completedRef.current) return;
    // Whatever a partial flush already sent stays sent — the server appends.
    const results = ledgerRef.current.take();
    inflightRef.current = true;
    setFinishing(true);
    setError(null);
    finishRef.current
      .mutateAsync({
        sessionId: id,
        duration_ms: Math.max(0, Date.now() - startedAtRef.current),
        results,
      })
      .then((s) => {
        completedRef.current = true;
        setSummary(s);
      })
      .catch((e) => {
        // The server never saw them, so `retry` must send the same tail again
        // rather than grade an empty round.
        ledgerRef.current.restore(results);
        setError(readErrorMessage(e));
      })
      .finally(() => {
        inflightRef.current = false;
        setFinishing(false);
      });
  }, []);

  /**
   * Send the tail this session has not sent yet WITHOUT completing it. Called on
   * the way out, so it must be cheap, synchronous and never throw.
   */
  const flushPartial = useCallback(() => {
    const id = sessionIdRef.current;
    if (id == null || completedRef.current || ledgerRef.current.unsent === 0) return;
    vocabularyApi.flushSessionPartial(id, {
      duration_ms: Math.max(0, Date.now() - startedAtRef.current),
      results: ledgerRef.current.take(),
    });
  }, []);

  useEffect(() => {
    // A ref latch, not a dependency dance: StrictMode's double-invoked effects
    // would otherwise open two sessions and orphan one. It also pins the run to
    // the homework it was launched from — `begin` now changes identity if the
    // query string does, and a mid-round rebind would open a second session and
    // silently split the answers across two rows.
    if (bootedRef.current) return;
    bootedRef.current = true;
    void begin();
  }, [begin]);

  // Covers the student finishing a very short round before the POST lands.
  useEffect(() => {
    if (sessionId != null) submit();
  }, [sessionId, submit]);

  useEffect(() => {
    const onPageHide = () => flushPartial();
    const onVisibility = () => {
      // iOS Safari does not reliably fire pagehide; there, backgrounding the tab
      // is the last event before the page may be discarded outright.
      if (document.visibilityState === "hidden") flushPartial();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      // The mode's own "Back to vocabulary" is a client-side navigation: no
      // pagehide fires, so this unmount is the only notice the round is over.
      flushPartial();
    };
  }, [flushPartial]);

  const report = useCallback((result: SessionResult) => {
    ledgerRef.current.append(result);
  }, []);

  const finish = useCallback(() => {
    if (completingRef.current) return;
    completingRef.current = true;
    submit();
  }, [submit]);

  const retry = useCallback(() => {
    if (sessionIdRef.current == null) {
      void begin();
      return;
    }
    submit();
  }, [begin, submit]);

  return { ready: sessionId != null, finishing, summary, error, fatal, report, finish, retry };
}
