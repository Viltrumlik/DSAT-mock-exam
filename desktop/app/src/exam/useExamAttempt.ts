/**
 * Loads one exam attempt and owns every write to it. Create-or-resume on mount, then hold the
 * server's attempt snapshot; save (autosave), submit, start and the off-screen report return the
 * next snapshot, and the server stays authoritative.
 *
 * The rule this hook keeps: a dropped connection never costs a student their work or their seat.
 *   - writes are serialised (a save and a submit never race on the version token), through a
 *     chain that can never get stuck rejected;
 *   - a save that fails on the network keeps the LATEST answers and retries with backoff, and a
 *     version conflict adopts the server's snapshot and goes again;
 *   - a submit retries with the same idempotency key and module_id until it lands — safe to
 *     repeat, and the server turns a stale one into a no-op;
 *   - only a definite answer from the server (a refusal) ever surfaces; blips show as
 *     "Reconnecting…", never as an error screen.
 *
 * Importers: exam/ExamScreen.tsx (past papers), exam/midterm/MidtermScreen.tsx.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, isTransient } from "@/lib/api";
import { isRunning, isTerminal, makeExamApi, parseAttempt, type ExamApi, type ExamSource } from "./examApi";
import { asDesktopBlocked, desktopBlockReason, type DesktopBlockReason } from "./lockdown/session";
import type { Attempt, OffscreenReport } from "./types";

export type ExamLoad = "loading" | "error" | "ready";
export type Connection = "ok" | "retrying";

export interface UseExamAttemptOptions {
  /** Headers for a request about this attempt (the lockdown session, for a midterm). */
  headers?: (attemptId: number) => Record<string, string>;
  /** Read the server's word on a timer — a midterm's teacher actions, scoring finishing. */
  poll?: boolean;
  /** Start the attempt as soon as it loads if it hasn't begun (past papers). */
  autoStart?: boolean;
  /**
   * The midterm refuses a hand-in until ITS clock says time is up, and the app's clock can be a
   * beat ahead. Keep retrying that refusal briefly instead of giving up on the auto-submit.
   */
  retryEarlySubmit?: boolean;
}

export interface ExamAttempt {
  api: ExamApi;
  attemptId: number | null;
  attempt: Attempt | null;
  status: ExamLoad;
  /** The server turned this sitting away for an app-binding reason (midterms only). */
  blocked: DesktopBlockReason | null;
  /** "retrying" after two transient failures in a row; back to "ok" on the next success. */
  connection: Connection;
  submitting: boolean;
  save: (answers: Record<string, string>, flagged: number[]) => void;
  submit: (answers: Record<string, string>, flagged: number[]) => Promise<void>;
  start: () => Promise<void>;
  /** Re-read the snapshot (after a re-bind). Throws on failure. */
  reload: () => Promise<void>;
  /** Retry the first load after an error screen. */
  retryLoad: () => void;
  applyAttempt: (next: Attempt) => void;
  reportOffscreen: (attemptId: number, idempotencyKey: string) => Promise<OffscreenReport>;
  /** The refusal is resolved (re-bound): forget it and flush any answers held back meanwhile. */
  clearBlocked: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (n: number) => Math.min(30_000, 1000 * 2 ** Math.max(0, n - 1));
const moduleIdOf = (a: Attempt) => a.current_module_details?.id ?? a.current_module ?? 0;

export function useExamAttempt(source: ExamSource, opts: UseExamAttemptOptions = {}): ExamAttempt {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const apiRef = useRef<ExamApi | null>(null);
  if (!apiRef.current) {
    // The header provider is read per call through the ref, so a re-bind takes effect at once.
    apiRef.current = makeExamApi(source, { headers: (id) => optsRef.current.headers?.(id) ?? {} });
  }
  const api = apiRef.current;

  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [status, setStatus] = useState<ExamLoad>("loading");
  const [blocked, setBlockedState] = useState<DesktopBlockReason | null>(null);
  const [connection, setConnection] = useState<Connection>("ok");
  const [submitting, setSubmitting] = useState(false);

  const attemptRef = useRef<Attempt | null>(null);
  const idRef = useRef<number | null>(null);
  const blockedRef = useRef<DesktopBlockReason | null>(null);
  const alive = useRef(true);
  const failures = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const setBlocked = useCallback((r: DesktopBlockReason | null) => {
    blockedRef.current = r;
    setBlockedState(r);
  }, []);

  /** Forward-only: a reply that left the server before a newer one must not roll the paper back. */
  const apply = useCallback((next: Attempt) => {
    const cur = attemptRef.current;
    if (cur && next.id === cur.id && next.version_number < cur.version_number && !isTerminal(next)) return;
    attemptRef.current = next;
    if (alive.current) setAttempt(next);
  }, []);

  const noteBlocked = useCallback(
    (e: unknown): boolean => {
      const reason = desktopBlockReason(e);
      if (!reason) return false;
      setBlocked(reason);
      return true;
    },
    [setBlocked],
  );

  const transientFailure = useCallback(async () => {
    failures.current += 1;
    if (failures.current >= 2 && alive.current) setConnection("retrying");
    await sleep(backoff(failures.current));
  }, []);

  const succeeded = useCallback(() => {
    failures.current = 0;
    if (alive.current) setConnection("ok");
  }, []);

  // ── writes: one at a time ──────────────────────────────────────────────────
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const run = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const link = chain.current.then(fn);
    // The chain itself never stays rejected: a failed submit must not make the NEXT write skip
    // its request and re-throw the old error (which a retry after a re-bind depends on).
    chain.current = link.catch(() => {});
    return link;
  }, []);

  // ── load ────────────────────────────────────────────────────────────────────
  const loading = useRef(false);
  const load = useCallback(async () => {
    if (loading.current) return; // StrictMode runs the mount effect twice in dev
    loading.current = true;
    if (alive.current) setStatus("loading");
    try {
      for (let i = 0; i < 4; i++) {
        try {
          const id = idRef.current ?? (await api.createOrResume());
          idRef.current = id;
          if (alive.current) setAttemptId(id);
          try {
            let a = await api.getStatus(id);
            apply(a);
            setBlocked(null);
            if (optsRef.current.autoStart && a.current_state === "NOT_STARTED") {
              a = await api.start(id);
              apply(a);
            }
          } catch (e) {
            // A running midterm with no lockdown token answers 403 desktop_required: that is a
            // resume, not an error — the screen asks to lock again and re-reads.
            if (noteBlocked(e)) {
              if (alive.current) setStatus("ready");
              return;
            }
            throw e;
          }
          if (alive.current) setStatus("ready");
          return;
        } catch (e) {
          if (!isTransient(e) || i === 3) throw e;
          await sleep(800 * (i + 1));
        }
      }
    } catch {
      if (alive.current) setStatus("error");
    } finally {
      loading.current = false;
    }
  }, [api, apply, noteBlocked, setBlocked]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = useCallback(async () => {
    const id = idRef.current;
    if (id == null) {
      await load();
      return;
    }
    const a = await api.getStatus(id);
    apply(a);
    setBlocked(null);
    if (alive.current) setStatus("ready");
  }, [api, apply, load, setBlocked]);

  // ── autosave ────────────────────────────────────────────────────────────────
  // Only the LATEST payload matters: a newer change supersedes an unsent one, and a save that
  // failed is retried with whatever is newest by then.
  const latest = useRef<{ answers: Record<string, string>; flagged: number[] } | null>(null);
  const saveQueued = useRef(false);

  const flushSave = useCallback(async () => {
    let conflicts = 0;
    while (latest.current && alive.current) {
      const p = latest.current;
      const cur = attemptRef.current;
      if (!cur || !isRunning(cur)) {
        latest.current = null; // the module is over: nothing left to save into
        return;
      }
      if (blockedRef.current) return; // held until the sitting is re-bound (clearBlocked flushes)
      try {
        const next = await api.save(cur.id, p.answers, p.flagged, cur.version_number, moduleIdOf(cur));
        apply(next);
        if (latest.current === p) latest.current = null;
        succeeded();
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.body?.attempt && conflicts < 3) {
          conflicts += 1;
          apply(parseAttempt(e.body.attempt)); // adopt the server's version, then go again
          continue;
        }
        if (noteBlocked(e)) return;
        if (isTransient(e)) {
          await transientFailure();
          continue;
        }
        latest.current = null; // a definite no (the module moved on): nothing to retry
        return;
      }
    }
  }, [api, apply, noteBlocked, succeeded, transientFailure]);

  const save = useCallback(
    (answers: Record<string, string>, flagged: number[]) => {
      latest.current = { answers, flagged };
      if (saveQueued.current) return; // the queued save will pick up this newer payload
      saveQueued.current = true;
      void run(async () => {
        saveQueued.current = false;
        await flushSave();
      });
    },
    [run, flushSave],
  );

  // ── submit ──────────────────────────────────────────────────────────────────
  const submit = useCallback(
    async (answers: Record<string, string>, flagged: number[]) => {
      const first = attemptRef.current;
      if (!first || !isRunning(first)) return;
      const moduleId = moduleIdOf(first);
      latest.current = null; // the submit carries the answers
      if (alive.current) setSubmitting(true);
      try {
        await run(async () => {
          let refusals = 0;
          let conflicts = 0;
          while (alive.current) {
            const cur = attemptRef.current;
            if (!cur || !isRunning(cur) || moduleIdOf(cur) !== moduleId) return; // already moved on
            try {
              const next = await api.submitModule(cur.id, answers, flagged, cur.version_number, moduleId);
              apply(next);
              succeeded();
              return;
            } catch (e) {
              if (e instanceof ApiError && e.status === 409 && e.body?.attempt && conflicts < 3) {
                conflicts += 1;
                apply(parseAttempt(e.body.attempt));
                continue;
              }
              if (noteBlocked(e)) throw asDesktopBlocked(e);
              if (isTransient(e)) {
                await transientFailure();
                continue;
              }
              if (optsRef.current.retryEarlySubmit && e instanceof ApiError && e.status === 403 && refusals < 15) {
                refusals += 1;
                await sleep(2000);
                continue;
              }
              throw e;
            }
          }
        });
      } finally {
        if (alive.current) setSubmitting(false);
      }
    },
    [api, apply, noteBlocked, run, succeeded, transientFailure],
  );

  // ── start ───────────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    const id = idRef.current;
    if (id == null) return;
    await run(async () => {
      for (let i = 0; ; i++) {
        try {
          apply(await api.start(id));
          succeeded();
          return;
        } catch (e) {
          if (noteBlocked(e)) throw asDesktopBlocked(e);
          if (isTransient(e) && i < 2) {
            await sleep(800 * (i + 1));
            continue;
          }
          throw e;
        }
      }
    });
  }, [api, apply, noteBlocked, run, succeeded]);

  // ── the off-screen report: immediate, never queued behind a retrying save ──────
  const reportOffscreen = useCallback(
    async (id: number, key: string) => {
      try {
        return await api.offscreen(id, key);
      } catch (e) {
        noteBlocked(e);
        throw e;
      }
    },
    [api, noteBlocked],
  );

  const clearBlocked = useCallback(() => {
    setBlocked(null);
    const pending = latest.current;
    if (pending) save(pending.answers, pending.flagged);
  }, [save, setBlocked]);

  // ── background poll (midterms) ──────────────────────────────────────────────
  useEffect(() => {
    if (!opts.poll || status !== "ready") return;
    let cancelled = false;
    let fails = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const id = idRef.current;
      const cur = attemptRef.current;
      if (cancelled || id == null || cur?.is_completed) return; // a finished paper stops polling
      // A blocked sitting is re-read by reload() after the re-bind, not polled into 403s.
      if (!blockedRef.current) {
        try {
          const next = await api.getStatus(id);
          if (!cancelled) apply(next);
          fails = 0;
        } catch (e) {
          if (!noteBlocked(e) && isTransient(e)) fails += 1;
        }
      }
      if (cancelled) return;
      const now = attemptRef.current;
      const delay = now?.current_state === "SCORING" ? 2000 : Math.min(30_000, 10_000 * 2 ** fails);
      timer = setTimeout(() => void tick(), delay);
    };
    timer = setTimeout(() => void tick(), attemptRef.current?.current_state === "SCORING" ? 2000 : 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [opts.poll, status, api, apply, noteBlocked]);

  return {
    api,
    attemptId,
    attempt,
    status,
    blocked,
    connection,
    submitting,
    save,
    submit,
    start,
    reload,
    retryLoad: () => void load(),
    applyAttempt: apply,
    reportOffscreen,
    clearBlocked,
  };
}
