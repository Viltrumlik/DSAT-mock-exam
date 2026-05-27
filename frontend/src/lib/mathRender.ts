import renderMathInElement from "katex/contrib/auto-render";

type RenderOptions = {
  root?: HTMLElement | null;
};

const KATEX_DELIMITERS = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\(", right: "\\)", display: false },
  { left: "$", right: "$", display: false },
] as const;

/**
 * Deterministic math rendering: KaTeX auto-render only.
 * - SSR-safe (no-op server-side)
 * - Idempotent / safe to call repeatedly
 * - Uses npm KaTeX package (no CDN loading race)
 */
export function renderMath(options?: RenderOptions) {
  if (typeof window === "undefined") return;

  const root = options?.root ?? document.body;
  if (!root) return;

  try {
    renderMathInElement(root, {
      delimiters: KATEX_DELIMITERS,
      throwOnError: false,
      trust: false,
    });
  } catch {
    // Rendering must never crash the runner.
  }
}
