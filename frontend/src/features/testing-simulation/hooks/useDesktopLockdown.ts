"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import { desktop, isDesktopShell, type PrecheckReport } from "@/lib/desktop/bridge";
import { bindAttemptToApp, clearLockdownSession } from "@/lib/desktop/lockdownSession";

/** The shell releases the lockdown on its own after 10s without one (a hung page). */
const HEARTBEAT_MS = 3000;

/** The machine failed the pre-check, so nothing was locked. */
export class PrecheckFailedError extends Error {
  constructor(readonly report: PrecheckReport) {
    super("precheck_failed");
    this.name = "PrecheckFailedError";
  }
}

interface UseDesktopLockdownArgs {
  attemptId: number;
  /** A midterm: the only paper the app locks the machine for. */
  enabled: boolean;
  /** The paper is in (scoring or completed) — release the machine. */
  finished: boolean;
}

export interface DesktopLockdown {
  /** Running inside the MasterSAT app for Windows. */
  inShell: boolean;
  /** This paper is sat locked down: a midterm, in the app. */
  active: boolean;
  /** The machine is locked down now. */
  locked: boolean;
  /** Locked AND the server has given this window the sitting's token. */
  bound: boolean;
  /** Lock the machine (refused unless the pre-check passes) and bind the sitting to it. */
  lockAndBind: () => Promise<void>;
}

/**
 * The midterm's lockdown, for as long as the runner shows the paper and no longer.
 *
 * The one rule this hook exists to keep: a lockdown never outlives the exam. It is released
 * when the paper is in, when the runner unmounts for any reason, and — if this page hangs —
 * by the shell itself once the heartbeat stops. A student is never left in a locked machine.
 */
export function useDesktopLockdown({ attemptId, enabled, finished }: UseDesktopLockdownArgs): DesktopLockdown {
  const [inShell] = useState(isDesktopShell);
  const active = inShell && enabled;
  const [locked, setLocked] = useState(false);
  const [bound, setBound] = useState(false);
  const lockedRef = useRef(false);

  const release = useCallback(() => {
    clearLockdownSession(attemptId);
    setBound(false);
    if (!lockedRef.current) return;
    lockedRef.current = false;
    setLocked(false);
    void desktop.exit().catch(() => {});
  }, [attemptId]);

  const lockAndBind = useCallback(async () => {
    if (!active) return;
    if (!lockedRef.current) {
      const report = await desktop.enter();
      if (!report.ok) throw new PrecheckFailedError(report);
      lockedRef.current = true;
      setLocked(true);
    }
    // Locked first, then bound: the shell only signs the server's challenge while locked.
    await bindAttemptToApp(attemptId);
    setBound(true);
  }, [active, attemptId]);

  useEffect(() => {
    if (!locked) return;
    const beat = () => void desktop.heartbeat().catch(() => {});
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [locked]);

  useEffect(() => {
    if (finished) release();
  }, [finished, release]);

  // Leaving the runner — a result page, a crash boundary, anything — releases the machine.
  useEffect(
    () => () => {
      clearLockdownSession(attemptId);
      if (lockedRef.current) {
        lockedRef.current = false;
        void desktop.exit().catch(() => {});
      }
    },
    [attemptId],
  );

  return { inShell, active, locked, bound, lockAndBind };
}
