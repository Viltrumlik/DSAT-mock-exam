"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The SMS panel's motion (plan 2026-11-01-sms-v2): figures count up to their value. Nothing moves
 * for a viewer who asked for less motion, or where the browser cannot say (server render, tests).
 */

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

function reduced(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(REDUCED).matches;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, reduced, () => true);
}

/** `target`, reached over `ms` with an ease-out (from 0 on mount, from the last value after); at once when still. */
export function useCountUp(target: number, ms = 700): number {
  const still = usePrefersReducedMotion();
  const [shown, setShown] = useState(still ? target : 0);
  const last = useRef(shown);

  useEffect(() => {
    if (still) {
      last.current = target;
      return;
    }
    const from = last.current;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const value = Math.round(from + (target - from) * (1 - (1 - t) ** 3));
      last.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms, still]);

  return still ? target : shown;
}
