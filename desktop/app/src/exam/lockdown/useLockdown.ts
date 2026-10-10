/**
 * The midterm's machine lockdown, for as long as the paper is on screen and no longer. Ported
 * from the site's useDesktopLockdown.ts, with the gaps it had closed:
 *   - a failed bind that the server REQUIRES releases the machine (the site left it locked);
 *   - the shell's watchdog letting go (this page stalled > 10 s) is noticed through the heartbeat
 *     and the machine is locked again at once — no network needed, the server token stays good —
 *     and only if that fails is the paper covered (`lost`);
 *   - a bind the server does NOT require (MIDTERM_DESKTOP_REQUIRED off, or no proof keys yet) is
 *     best-effort: the lock, the heartbeat and the off-screen rule still apply locally.
 *
 * The one rule: a lockdown never outlives the exam. Released when the paper is in, on every exit
 * path, on unmount, and — if the page hangs — by the shell's own watchdog.
 *
 * Importer: exam/midterm/MidtermScreen.tsx.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { native, type PrecheckReport } from "@/lib/native";
import type { ExamApi } from "../examApi";
import { bindAttemptToApp, clearLockdownSession, hasLockdownSession } from "./session";

/** The shell releases the lockdown on its own after 10 s without one. */
const HEARTBEAT_MS = 3000;

/** The machine failed the pre-check, so nothing was locked. */
export class PrecheckFailedError extends Error {
  constructor(readonly report: PrecheckReport) {
    super("precheck_failed");
    this.name = "PrecheckFailedError";
  }
}

export interface Lockdown {
  /** The machine is locked down now. */
  locked: boolean;
  /** Locked AND the server gave this window the sitting's token. */
  bound: boolean;
  /** The shell let go by itself and locking again failed — the paper must be covered. */
  lost: boolean;
  /** Lock (refused unless the pre-check passes), then bind. `requireBind`: the server polices this sitting. */
  lockAndBind: (attemptId: number, api: ExamApi, opts: { requireBind: boolean }) => Promise<void>;
  /** Fetch a fresh token while staying locked (the server asked for one mid-paper). */
  rebind: (attemptId: number, api: ExamApi) => Promise<void>;
  /** Release everything. Safe to call twice. */
  release: () => void;
}

export function useLockdown(attemptId: number | null): Lockdown {
  const [locked, setLocked] = useState(false);
  const [bound, setBound] = useState(false);
  const [lost, setLost] = useState(false);
  const lockedRef = useRef(false);
  const idRef = useRef(attemptId);
  idRef.current = attemptId;

  const release = useCallback(() => {
    if (idRef.current != null) clearLockdownSession(idRef.current);
    setBound(false);
    setLost(false);
    if (!lockedRef.current) return;
    lockedRef.current = false;
    setLocked(false);
    void native.lockdownExit().catch(() => {});
  }, []);

  const lockAndBind = useCallback(
    async (id: number, api: ExamApi, { requireBind }: { requireBind: boolean }) => {
      if (!lockedRef.current) {
        const report = await native.lockdownEnter();
        if (!report.ok) throw new PrecheckFailedError(report);
        lockedRef.current = true;
        setLocked(true);
        setLost(false);
      }
      // Already bound (re-locking after the watchdog let go): the server's token is still good.
      if (hasLockdownSession(id)) {
        setBound(true);
        return;
      }
      try {
        // Locked first, then bound: the shell only signs the server's challenge while locked.
        await bindAttemptToApp(api, id);
        setBound(true);
      } catch (e) {
        if (requireBind) {
          // The sitting cannot start unbound — never leave the machine locked behind an error.
          release();
          throw e;
        }
        setBound(false);
      }
    },
    [release],
  );

  const rebind = useCallback(async (id: number, api: ExamApi) => {
    clearLockdownSession(id);
    setBound(false);
    await bindAttemptToApp(api, id);
    setBound(true);
  }, []);

  // ── heartbeat + lost-lock recovery ─────────────────────────────────────────
  useEffect(() => {
    if (!locked) return;
    let cancelled = false;
    let recovering = false;
    const beat = async () => {
      let still: boolean | null;
      try {
        still = await native.lockdownHeartbeat();
      } catch {
        return;
      }
      if (cancelled || still !== false || recovering) return;
      // The watchdog let go. Lock again at once; this needs no network.
      recovering = true;
      try {
        const report = await native.lockdownEnter();
        if (cancelled) return;
        if (!report.ok) {
          lockedRef.current = false;
          setLocked(false);
          setLost(true);
        }
      } catch {
        if (!cancelled) {
          lockedRef.current = false;
          setLocked(false);
          setLost(true);
        }
      } finally {
        recovering = false;
      }
    };
    void beat();
    const t = setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [locked]);

  // Leaving the midterm — any way at all — releases the machine.
  useEffect(
    () => () => {
      if (idRef.current != null) clearLockdownSession(idRef.current);
      if (lockedRef.current) {
        lockedRef.current = false;
        void native.lockdownExit().catch(() => {});
      }
    },
    [],
  );

  return { locked, bound, lost, lockAndBind, rebind, release };
}
