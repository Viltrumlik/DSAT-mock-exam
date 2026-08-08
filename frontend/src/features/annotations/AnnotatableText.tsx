"use client";
import { memo } from "react";

/**
 * Plain text rendered so the annotator can paint on it.
 *
 * The highlighter inserts `<mark>` elements directly into the DOM. React must therefore not
 * own the children of an annotated region: when React next updates a text node it manages, it
 * replaces children it does not know about, and mutating React-owned DOM is how you earn a
 * `NotFoundError: Failed to execute 'removeChild'`. Every annotated region in the exam runner
 * goes through `dangerouslySetInnerHTML` for exactly this reason (`SafeHtml`, `StableHtml`);
 * this is the same trick for text that has no markup to render at all.
 *
 * "dangerously" is a misnomer here — the text is HTML-escaped on the way in, so nothing it
 * contains can become an element. That is also why this is not `SafeHtml`: there is no markup
 * to sanitise and allow through, only text to show verbatim.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const AnnotatableText = memo(function AnnotatableText({
  text,
  className,
  id,
  as: Tag = "p",
}: {
  text: string;
  className?: string;
  /** How the annotator finds this region. Must be unique on the page. */
  id?: string;
  /** The element to render. Keep it a text container — the marks live inside it. */
  as?: "p" | "span" | "div";
}) {
  return <Tag id={id} className={className} dangerouslySetInnerHTML={{ __html: escapeHtml(text) }} />;
});
