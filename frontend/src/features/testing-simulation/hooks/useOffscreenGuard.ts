"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import { midtermApi } from "@/lib/midtermApi";
import {
  MIDTERM_OFFSCREEN_GRACE_SECONDS,
  MIDTERM_OFFSCREEN_VIOLATION_LIMIT,
  offscreenChancesLabel,
  offscreenChancesLeft,
} from "@/lib/midtermRules";

import { selfFullscreenSettling } from "../tools/fullscreenIntent";
import { type Attempt, InvalidAttemptPayloadError, parseAttempt } from "../types";

/**
 * Client half of the midterm off-screen rule (server half: midterms/views.offscreen).
 *
 * The browser's ONLY job is to notice the student left and to say so; the server owns the
 * count, the grace and the forfeit, because a tally kept here is wiped by a refresh or a
 * second tab — precisely what a student gaming the rule would do. Everything below is
 * therefore about reporting *accurately*, not about deciding anything:
 *
 *   - one absence must produce ONE offence, however many events the browser fires for it
 *     (a single alt-tab emits visibilitychange AND blur, and often fullscreenchange too);
 *   - a leave the student didn't make must produce NONE (the runner's own fullscreen
 *     request, focus moving into an in-page tool, the mount/transition churn);
 *   - a retried report must not burn two of the three chances (stable key per absence);
 *   - a warning must never outlive the absence it belongs to — the overlay it drives covers
 *     the questions and swallows the keyboard, so a stray countdown locks a student out of
 *     their own paper, which is a worse failure than missing an offence.
 *
 * Grace expiry escalates rather than submitting from here. The server refuses an early
 * submit until the allowance is actually spent (`submit_module` 403s otherwise, by design
 * — a client must not be able to assert its own forfeiture), so the only way a paper is
 * taken in for this rule is the server doing it on the terminating offence. Reporting the
 * continuing absence is what gets us there, and it keeps the count honest: a student who
 * stays away through the whole grace window has not come back.
 */

/** An apparent leave must still look like one after this long to be reported. */
const CONFIRM_MS = 250;

/**
 * How long `enabled` must hold before the guard watches. The runner enters fullscreen
 * itself on Start, and that transition emits the same events as a student leaving.
 */
const ARM_MS = 800;

interface UseOffscreenGuardArgs {
  attemptId: number;
  /** Live snapshot — the server's offence count is read from it (a refresh can't reset it). */
  attempt: Attempt | null;
  /** True only while the student is genuinely sitting an active midterm. */
  enabled: boolean;
  /** Adopt the snapshot the offence endpoint returns, so the runner state stays truthful. */
  applyAttempt: (next: Attempt) => void;
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

type FsDoc = Document & { webkitFullscreenElement?: Element | null };

function fullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  return document.fullscreenElement ?? (document as FsDoc).webkitFullscreenElement ?? null;
}

function randomSegment(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** The proctoring block the midterm serializer adds to every attempt snapshot. */
interface OffscreenSnapshot {
  offscreen_violations?: number;
  offscreen_limit?: number;
  offscreen_grace_seconds?: number;
  terminated_reason?: string;
}

export function useOffscreenGuard({
  attemptId,
  attempt,
  enabled,
  applyAttempt,
}: UseOffscreenGuardArgs): OffscreenGuard {
  const [violations, setViolations] = useState(0);
  const [limit, setLimit] = useState(MIDTERM_OFFSCREEN_VIOLATION_LIMIT);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [terminated, setTerminated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  // Mirrors of the state the event handlers read at call time (they are registered once
  // per arm and must not close over a render-time value).
  const graceRef = useRef(MIDTERM_OFFSCREEN_GRACE_SECONDS);
  const limitRef = useRef(MIDTERM_OFFSCREEN_VIOLATION_LIMIT);
  const violationsRef = useRef(0);
  const terminatedRef = useRef(false);
  const applyRef = useRef(applyAttempt);
  useEffect(() => {
    applyRef.current = applyAttempt;
  }, [applyAttempt]);

  // Absence bookkeeping: `awayRef` collapses every event of one absence into a single
  // offence, `eventKeyRef` keeps that offence idempotent, and `sawFullscreenRef` means
  // "fullscreen was established", so a runner that never got fullscreen (unsupported
  // browser, denied request) doesn't read as permanently off-screen.
  const awayRef = useRef(false);
  const eventKeyRef = useRef<string | null>(null);
  const sawFullscreenRef = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Bumped whenever an absence begins or ends, so a report that resolves late can tell
  // whether the absence it was sent for is still the one on screen.
  const absenceRef = useRef(0);
  // The last report failed: we cannot tell a lost request from a lost reply, so its key
  // stays valid for the retry instead of being spent as a second offence.
  const reportFailedRef = useRef(false);

  const stopCountdown = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    setCountdown(null);
  }, []);

  // ── the server's count is the count ─────────────────────────────────────────
  // Read on mount and on every poll, so a refresh (or a second device) picks up the true
  // tally. Forward-only: an in-flight snapshot taken before the last offence must never
  // hand the student a chance back.
  useEffect(() => {
    const snap = attempt as (Attempt & OffscreenSnapshot) | null;
    if (!snap) return;
    if (typeof snap.offscreen_limit === "number" && snap.offscreen_limit > 0) {
      limitRef.current = snap.offscreen_limit;
      setLimit(snap.offscreen_limit);
    }
    // Floor at 1s. A zero grace turns startCountdown -> escalate -> report -> startCountdown
    // into unbounded async recursion: it locks the tab and floods the server with reports.
    // The server never sends 0 today, but a single bad snapshot must not be able to do that
    // to a student sitting an exam.
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
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    if (fullscreenElement()) sawFullscreenRef.current = true;

    // Fullscreen was established and is now gone. Ignored while a transition the runner
    // asked for itself settles — entering fullscreen on Start emits exactly the event a
    // student pressing Esc does, and we must not charge them for our own request.
    const fullscreenLost = () => sawFullscreenRef.current && !fullscreenElement();

    // `hasFocus()` rather than a raw blur flag: focus moving into an in-page tool (the
    // calculator, a dialog) blurs the window in some browsers but keeps focus in the
    // document, and that is not the student leaving.
    const isAway = () =>
      document.hidden ||
      !document.hasFocus() ||
      (fullscreenLost() && selfFullscreenSettling() === 0);

    const startCountdown = (seconds: number) => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      // A warning belongs to an absence. Starting one at a student who is already back
      // (a report that resolved after their return) would leave the overlay on their
      // paper with nothing left to dismiss it — the lockout this guard must never cause.
      if (!awayRef.current) {
        setCountdown(null);
        return;
      }
      let remaining = Math.max(0, Math.round(seconds));
      setCountdown(remaining);
      if (remaining <= 0) {
        tickRef.current = null;
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
        const res = await midtermApi.reportOffscreen(attemptId, key);
        reportFailedRef.current = false;
        if (typeof res.limit === "number" && res.limit > 0) {
          limitRef.current = res.limit;
          setLimit(res.limit);
        }
        if (typeof res.violations === "number" && res.violations > violationsRef.current) {
          violationsRef.current = res.violations;
          setViolations(res.violations);
        }
        if (res.attempt) {
          try {
            applyRef.current(parseAttempt(res.attempt, "POST offscreen"));
          } catch (e) {
            if (e instanceof InvalidAttemptPayloadError) console.error(e);
          }
        }
        // The count, the limit and the forfeit are the server's word and are taken however
        // late they land. The countdown is not: it drives an overlay over the paper, so it
        // is only started if the absence it was reported for is still running.
        if (res.terminated) {
          terminatedRef.current = true;
          stopCountdown();
          setTerminated(true);
          return;
        }
        if (cancelled || absence !== absenceRef.current) return;
        startCountdown(Math.max(1, res.grace_seconds || graceRef.current));
      } catch {
        // The offence may or may not have reached the server — a lost reply looks exactly
        // like a lost request from here. Keep the key (see escalate) so the retry can't be
        // charged twice, and run the mirrored grace locally so the student is warned rather
        // than silently let off. The server still owns the forfeit; we never submit.
        reportFailedRef.current = true;
        if (cancelled || absence !== absenceRef.current) return;
        startCountdown(graceRef.current);
      }
    };

    // Grace ran out and they are still away: that is the next offence, so it needs its own
    // key. The server decides whether this one is the terminating one.
    const escalate = async () => {
      // stopCountdown FIRST, before every early return. A countdown that reached zero has
      // already painted "0" over the paper, and OffscreenWarning is mounted purely on
      // `countdown !== null` — so any path that returns without clearing it leaves the
      // student staring at a frozen overlay with no way past it.
      if (cancelled) {
        stopCountdown();
        return;
      }
      if (terminatedRef.current || !awayRef.current) {
        // Nothing to escalate — but the warning that just ran down to zero must not be left
        // frozen on screen, because it is the only thing standing over the student's paper.
        stopCountdown();
        return;
      }
      // Rotate the key only if the server confirmed the last one. An unconfirmed report may
      // still have landed, and charging two chances for one absence is the wrong way to be
      // wrong about it.
      if (!reportFailedRef.current) eventKeyRef.current = null;
      await report();
    };

    const evaluate = () => {
      if (cancelled || terminatedRef.current) return;
      if (fullscreenElement()) sawFullscreenRef.current = true;

      // The pardon for a self-requested transition lasts only as long as the transition
      // does. Nothing else will fire an event for a student who simply stays outside
      // fullscreen, so book the re-check that charges them ourselves.
      const settling = fullscreenLost() ? selfFullscreenSettling() : 0;
      if (settling > 0 && !settleTimer) {
        settleTimer = setTimeout(() => {
          settleTimer = null;
          evaluate();
        }, settling + 50);
      }

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
      // Back in time — the offence still stands (the server counted it), but the paper is
      // not taken in. Say what it cost so the warning isn't a mystery once it's gone.
      awayRef.current = false;
      absenceRef.current += 1; // any report still in flight now belongs to a finished absence
      eventKeyRef.current = null;
      stopCountdown();
      setNotice(
        `You left the exam window. That counted as a warning — ${offscreenChancesLabel(
          violationsRef.current,
          limitRef.current,
        )}.`,
      );
    };

    document.addEventListener("visibilitychange", evaluate);
    document.addEventListener("fullscreenchange", evaluate);
    document.addEventListener("webkitfullscreenchange", evaluate as EventListener);
    window.addEventListener("blur", evaluate);
    window.addEventListener("focus", evaluate);
    return () => {
      cancelled = true;
      if (confirmTimer) clearTimeout(confirmTimer);
      if (settleTimer) clearTimeout(settleTimer);
      // The tick interval outlives this effect otherwise: it keeps counting after the
      // listeners are gone, reaches zero, and leaves the overlay frozen at 0 with nothing
      // left able to dismiss it. `armed` drops on every module transition, so this is a
      // routine path, not an edge case.
      stopCountdown();
      document.removeEventListener("visibilitychange", evaluate);
      document.removeEventListener("fullscreenchange", evaluate);
      document.removeEventListener("webkitfullscreenchange", evaluate as EventListener);
      window.removeEventListener("blur", evaluate);
      window.removeEventListener("focus", evaluate);
    };
  }, [armed, terminated, attemptId, stopCountdown]);

  // Stop the clock the moment the sitting ends, however it ended.
  useEffect(() => {
    if (terminated) stopCountdown();
  }, [terminated, stopCountdown]);

  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
  }, []);

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
