"use client";
import { useEffect } from "react";
import { renderMath } from "@/lib/mathRender";

/**
 * Renders KaTeX math once whenever the *content* actually changes — i.e. when
 * `resetKey` changes (question/module switch) — NOT on every DOM mutation.
 *
 * The previous implementation used a `document.body` MutationObserver, which
 * re-rendered math on every mutation, including the once-per-second clock tick.
 * That made formulas re-render "live" and flicker throughout the test. Because
 * `renderMath` is idempotent (it skips already-rendered `.katex` nodes), keying
 * the render to `resetKey` means a question's math is rendered once and then
 * stays frozen until the student moves to different content — exactly like the
 * read-only review page.
 */
export function useMathRendering(enabled: boolean, resetKey: unknown): void {
  useEffect(() => {
    if (!enabled) return;

    const run = () => renderMath({ root: document.body });
    // Render after paint, plus one short follow-up for React's two-pass commit
    // so freshly-swapped question HTML is fully present in the DOM.
    const raf = requestAnimationFrame(run);
    const initial = setTimeout(run, 80);

    // Re-render once KaTeX finishes loading (cold-start race condition).
    const onReady = () => run();
    window.addEventListener("katex:ready", onReady);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(initial);
      window.removeEventListener("katex:ready", onReady);
    };
  }, [enabled, resetKey]);
}
