"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Clocks for the study modes.
 *
 * Modelled on the exam runner's `useModuleTimer` (features/testing-simulation):
 * a single requestAnimationFrame loop that commits state only when the whole
 * second changes — a 60fps setState would re-render a 12-card matching grid 60
 * times a second — plus a ref latch so the expiry callback fires exactly once.
 * The runner's hook itself is bound to the Attempt/ServerClock types and cannot
 * take a plain duration, hence the copy rather than the import.
 */

/** Elapsed whole seconds while `running`. Freezes (does not reset) when it stops. */
export function useElapsedSeconds(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  const bankedMsRef = useRef(0); // completed spans
  const anchorRef = useRef<number | null>(null); // start of the live span

  useEffect(() => {
    if (!running) {
      setSeconds(Math.floor(bankedMsRef.current / 1000));
      return;
    }

    anchorRef.current = Date.now();
    let raf = 0;
    let lastRendered = -1;

    const loop = () => {
      const anchor = anchorRef.current ?? Date.now();
      const s = Math.floor((bankedMsRef.current + (Date.now() - anchor)) / 1000);
      if (s !== lastRendered) {
        lastRendered = s;
        setSeconds(s);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      if (anchorRef.current != null) {
        bankedMsRef.current += Date.now() - anchorRef.current;
        anchorRef.current = null;
      }
    };
  }, [running]);

  return seconds;
}

interface CountdownArgs {
  durationSeconds: number;
  /** The clock only anchors once this flips true. */
  running: boolean;
  /** Fired exactly once per run when the clock reaches zero. */
  onExpire: () => void;
}

/** Seconds remaining in a fixed-length round. */
export function useCountdownSeconds({ durationSeconds, running, onExpire }: CountdownArgs): number {
  const [secondsLeft, setSecondsLeft] = useState(durationSeconds);
  const firedRef = useRef(false);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    if (!running) return;

    const deadline = Date.now() + durationSeconds * 1000;
    firedRef.current = false;
    setSecondsLeft(durationSeconds);

    let raf = 0;
    let lastRendered = -1;

    const loop = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (left !== lastRendered) {
        lastRendered = left;
        setSecondsLeft(left);
      }
      if (left <= 0) {
        if (!firedRef.current) {
          firedRef.current = true;
          onExpireRef.current();
        }
        return; // the round is over — stop the loop
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
  }, [running, durationSeconds]);

  return secondsLeft;
}

/**
 * Counts `from` down to 1 on a fixed step, then calls `onDone` once — the big
 * 3-2-1 lead-in. Coarse steps, so an interval is honest here; rAF would only add
 * noise.
 */
export function useLeadInTicks(from: number, stepMs: number, active: boolean, onDone: () => void): number {
  const [tick, setTick] = useState(from);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (!active) return;
    setTick(from);

    // The countdown lives in a local, not in state, so `onDone` fires from the
    // interval callback rather than from inside a setState updater.
    let remaining = from;
    const id = window.setInterval(() => {
      remaining -= 1;
      setTick(Math.max(0, remaining));
      if (remaining <= 0) {
        window.clearInterval(id);
        onDoneRef.current();
      }
    }, stepMs);

    return () => window.clearInterval(id);
  }, [active, from, stepMs]);

  return tick;
}
