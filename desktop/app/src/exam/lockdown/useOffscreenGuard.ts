/**
 * Client half of the off-screen rule (server half: midterms/views.offscreen). Ported verbatim from
 * the site's useOffscreenGuard.ts, minus its browser-fullscreen branch: the app's window is made
 * fullscreen by the shell at the OS level, so `document.fullscreenElement` is never set here and
 * that branch never fires (the site notes the same inside the app).
 *
 * The app's ONLY job is to notice the student left and to say so; the server owns the count, the
 * grace and the forfeit. So everything below is about reporting accurately:
 *   - one absence produces ONE offence, however many events fire for it (alt-tab emits
 *     visibilitychange AND blur, and the shell's own away report on top);
 *   - a retried report never burns two chances (stable idempotency key per absence);
 *   - a warning never outlives the absence it belongs to — the overlay covers the questions, so a
 *     stray countdown would lock a student out of their own paper.
 * Grace expiry escalates (reports again) rather than submitting from here: the server refuses an
 * early submit, so the only way the paper is taken in for this rule is the server doing it.
 *
 * Importer: exam/midterm/MidtermScreen.tsx.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { devLockdown } from "@/lib/devLockdown";
import { DEV_MOCK } from "@/lib/env";
import { native, SHELL_AWAY_EVENT } from "@/lib/native";
import { parseAttempt, randomSegment } from "../examApi";
import {
  MIDTERM_OFFSCREEN_GRACE_SECONDS,
  MIDTERM_OFFSCREEN_VIOLATION_LIMIT,
  offscreenChancesLabel,
  offscreenChancesLeft,
} from "../midterm/midtermRules";
import type { Attempt, OffscreenReport } from "../types";

/** An apparent leave must still look like one after this long to be reported. */
const CONFIRM_MS = 250;
/** How long `enabled` must hold before the guard watches (mount / module-transition churn). */
const ARM_MS = 800;

interface UseOffscreenGuardArgs {
  attemptId: number;
  /** Live snapshot — the server's offence count is read from it (a restart can't reset it). */
  attempt: Attempt | null;
  /** True only while the student is genuinely sitting an active, locked paper. */
  enabled: boolean;
  /** Adopt the snapshot the offence endpoint returns, so the runner state stays truthful. */
  applyAttempt: (next: Attempt) => void;
  report: (attemptId: number, idempotencyKey: string) => Promise<OffscreenReport>;
}

export interface OffscreenGuard {
  violations: number;
  limit: number;
  chancesLeft: number;
  /** Seconds left to return; null when no warning is running. */
  countdown: number | null;
  /** The sitting is over — the SERVER already submitted it. Never submit from the client. */
  terminated: boolean;
  /** Brief note after the student returns in time ("you left; N chances left"). */
  notice: string | null;
  dismissNotice: () => void;
}

export function useOffscreenGuard({
  attemptId,
  attempt,
  enabled,
  applyAttempt,
  report: reportOffscreen,
}: UseOffscreenGuardArgs): OffscreenGuard {
  const [violations, setViolations] = useState(0);
  const [limit, setLimit] = useState(MIDTERM_OFFSCREEN_VIOLATION_LIMIT);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [terminated, setTerminated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  // Mirrors of the state the event handlers read at call time.
  const graceRef = useRef(MIDTERM_OFFSCREEN_GRACE_SECONDS);
  const limitRef = useRef(MIDTERM_OFFSCREEN_VIOLATION_LIMIT);
  const violationsRef = useRef(0);
  const terminatedRef = useRef(false);
  const applyRef = useRef(applyAttempt);
  useEffect(() => {
    applyRef.current = applyAttempt;
  }, [applyAttempt]);
  // In a ref so an inline arrow does not re-arm the whole guard on every render — re-arming
  // mid-absence would drop the countdown the student is watching.
  const reportRef = useRef(reportOffscreen);
  useEffect(() => {
    reportRef.current = reportOffscreen;
  }, [reportOffscreen]);

  const awayRef = useRef(false);
  const eventKeyRef = useRef<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Bumped whenever an absence begins or ends, so a late report can tell whether its absence is
  // still the one on screen.
  const absenceRef = useRef(0);
  // The last report failed: a lost request looks like a lost reply, so its key stays valid.
  const reportFailedRef = useRef(false);

  const stopCountdown = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    setCountdown(null);
  }, []);

  // ── the server's count is the count (forward-only) ──────────────────────────
  useEffect(() => {
    const snap = attempt;
    if (!snap) return;
    if (typeof snap.offscreen_limit === "number" && snap.offscreen_limit > 0) {
      limitRef.current = snap.offscreen_limit;
      setLimit(snap.offscreen_limit);
    }
    // Floor at 1 s: a zero grace would turn countdown → escalate → report into a tight loop.
    if (typeof snap.offscreen_grace_seconds === "number" && snap.offscreen_grace_seconds > 0) {
      graceRef.current = Math.max(1, snap.offscreen_grace_seconds);
    }
    if (typeof snap.offscreen_violations === "number" && snap.offscreen_violations > violationsRef.current) {
      violationsRef.current = snap.offscreen_violations;
      setViolations(snap.offscreen_violations);
    }
    if (snap.terminated_reason === "OFFSCREEN" && !terminatedRef.current) {
      terminatedRef.current = true;
      setTerminated(true);
    }
  }, [attempt]);

  // ── arming ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      setArmed(false);
      return;
    }
    const t = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(t);
  }, [enabled]);

  // ── detection + reporting ───────────────────────────────────────────────────
  useEffect(() => {
    if (!armed || terminated) return;

    let confirmTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    // `hasFocus()` rather than a raw blur flag: focus moving into an in-page control keeps focus
    // in the document. `shellReportsAway()`: the shell's word for an absence the page never hears
    // about — focus stolen by another program, a second monitor plugged in.
    const isAway = () => {
      // Dev: "shell events only" — a backgrounded dev tab or devtools focus would otherwise read
      // as a permanent absence; the panel's away buttons still drive the rule end to end.
      if (DEV_MOCK && devLockdown.get().guardPaused) return native.shellReportsAway();
      return document.hidden || !document.hasFocus() || native.shellReportsAway();
    };

    const startCountdown = (seconds: number) => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      // A warning belongs to an absence: never start one at a student who is already back.
      if (!awayRef.current) {
        setCountdown(null);
        return;
      }
      let remaining = Math.max(0, Math.round(seconds));
      setCountdown(remaining);
      if (remaining <= 0) {
        void escalate();
        return;
      }
      tickRef.current = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          if (tickRef.current) clearInterval(tickRef.current);
          tickRef.current = null;
          void escalate();
        }
      }, 1000);
    };

    const report = async () => {
      if (cancelled || terminatedRef.current) return;
      const key = eventKeyRef.current ?? `offscreen.${attemptId}.${randomSegment()}`;
      eventKeyRef.current = key;
      const absence = absenceRef.current;
      try {
        const res = await reportRef.current(attemptId, key);
        reportFailedRef.current = false;
        if (typeof res.limit === "number" && res.limit > 0) {
          limitRef.current = res.limit;
          setLimit(res.limit);
        }
        if (typeof res.violations === "number" && res.violations > violationsRef.current) {
          violationsRef.current = res.violations;
          setViolations(res.violations);
        }
        if (res.attempt) applyRef.current(parseAttempt(res.attempt));
        // The count, the limit and the forfeit are the server's word, taken however late they
        // land. The countdown only starts if the absence it was reported for is still running.
        if (res.terminated) {
          terminatedRef.current = true;
          stopCountdown();
          setTerminated(true);
          return;
        }
        if (cancelled || absence !== absenceRef.current) return;
        startCountdown(Math.max(1, res.grace_seconds || graceRef.current));
      } catch {
        // Lost request or lost reply — can't tell. Keep the key so the retry can't be charged
        // twice, and run the mirrored grace locally so the student is still warned. Never submit.
        reportFailedRef.current = true;
        if (cancelled || absence !== absenceRef.current) return;
        startCountdown(graceRef.current);
      }
    };

    // Grace ran out and they are still away: the next offence, with its own key.
    const escalate = async () => {
      // stopCountdown FIRST on every early return: a countdown that reached zero has painted "0"
      // over the paper, and the warning is mounted purely on `countdown !== null`.
      if (cancelled || terminatedRef.current || !awayRef.current) {
        stopCountdown();
        return;
      }
      // Rotate the key only if the server confirmed the last one.
      if (!reportFailedRef.current) eventKeyRef.current = null;
      await report();
    };

    const evaluate = () => {
      if (cancelled || terminatedRef.current) return;
      if (isAway()) {
        if (awayRef.current || confirmTimer) return; // this absence is already accounted for
        confirmTimer = setTimeout(() => {
          confirmTimer = null;
          if (cancelled || !isAway()) return;
          awayRef.current = true;
          absenceRef.current += 1;
          void report();
        }, CONFIRM_MS);
        return;
      }
      if (confirmTimer) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
      }
      if (!awayRef.current) return;
      // Back in time — the offence still stands (the server counted it), the paper isn't taken.
      awayRef.current = false;
      absenceRef.current += 1;
      eventKeyRef.current = null;
      stopCountdown();
      setNotice(
        `You left the exam window. That counted as a warning — ${offscreenChancesLabel(violationsRef.current, limitRef.current)}.`,
      );
    };

    document.addEventListener("visibilitychange", evaluate);
    window.addEventListener("blur", evaluate);
    window.addEventListener("focus", evaluate);
    window.addEventListener(SHELL_AWAY_EVENT, evaluate);
    return () => {
      cancelled = true;
      if (confirmTimer) clearTimeout(confirmTimer);
      // The tick interval would otherwise outlive this effect and freeze the overlay at 0.
      stopCountdown();
      document.removeEventListener("visibilitychange", evaluate);
      window.removeEventListener("blur", evaluate);
      window.removeEventListener("focus", evaluate);
      window.removeEventListener(SHELL_AWAY_EVENT, evaluate);
    };
  }, [armed, terminated, attemptId, stopCountdown]);

  useEffect(() => {
    if (terminated) stopCountdown();
  }, [terminated, stopCountdown]);

  useEffect(
    () => () => {
      if (tickRef.current) clearInterval(tickRef.current);
    },
    [],
  );

  return {
    violations,
    limit,
    chancesLeft: offscreenChancesLeft(violations, limit),
    countdown,
    terminated,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
  };
}
