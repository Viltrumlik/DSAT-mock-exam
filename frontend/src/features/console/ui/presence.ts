"use client";

import { useEffect, useState } from "react";

/** The longest exit on the Motion board (sheets, 160 ms); the others are 120 ms and end inside it. */
export const EXIT_MS = 160;

/** Reduced motion asked for — or no way to ask (a test DOM without matchMedia): then nothing waits for an exit. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Keeps an overlay on screen while it leaves (design handoff v0.3, Motion board, "Things come from
 * where they belong" — and go back there). `mounted`: draw it at all; `closing`: play its -out
 * animation. Opening again mid-exit simply cancels the exit. Under reduced motion it leaves at once.
 */
export function usePresence(open: boolean, ms: number = EXIT_MS): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  // No exit to wait for (reduced motion, or a DOM that cannot say): it leaves in the same render.
  const instant = !open && mounted && prefersReducedMotion();
  if (open && !mounted) setMounted(true);
  if (instant) setMounted(false);
  useEffect(() => {
    if (open || !mounted) return;
    const t = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(t);
  }, [open, mounted, ms]);
  return { mounted: open || (mounted && !instant), closing: !open && mounted && !instant };
}
