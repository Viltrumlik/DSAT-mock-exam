"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { sanitizeHighlightHtml } from "@/lib/assessmentText";

/**
 * Imperative-innerHTML renderer for assessment question/passage/choice text.
 *
 * The caller passes HTML that ALREADY has KaTeX rendered into the string
 * (via `processInstructionalText`), so there is NO post-render DOM mutation
 * (no `renderMath` replaceChild). innerHTML is written only when the sanitized
 * string actually changes — never on an unrelated parent re-render (e.g. the
 * 1-second exam timer). `dangerouslySetInnerHTML` would re-apply on every commit,
 * wiping the offset-based <mark> spans the annotator paints on top and collapsing
 * any in-progress selection. Setting innerHTML imperatively, keyed on the string,
 * keeps the DOM text stable so character-offset highlights survive re-renders.
 *
 * Mirrors `@/components/SafeHtml` but stays inside the assessments feature and
 * uses the assessment sanitizer (preserves <mark> + style/class + KaTeX markup).
 */
export default function StableHtml({
  html,
  ...divProps
}: React.HTMLAttributes<HTMLDivElement> & { html: string }) {
  const safe = useMemo(() => sanitizeHighlightHtml(html), [html]);
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== safe) el.innerHTML = safe;
  }, [safe]);

  return <div ref={ref} {...divProps} suppressHydrationWarning />;
}
