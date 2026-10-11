// Port of frontend/src/components/SafeHtml.tsx (the parts the question card uses).
//
// The website renders question content as <SafeHtml html={renderExamHtml(raw)} …/>, i.e.
// `DOMPurify.sanitize(html)` with DOMPurify's DEFAULT options, written as the innerHTML of a
// <div> carrying the given className/style. The island does exactly that, once per question
// at module.load (so KaTeX never runs again while the student moves between questions).
// SafeHtml's MathJax typeset is a no-op on the website (MathJax is never loaded on this
// surface) and is not ported.
import DOMPurify from "dompurify";

import { renderExamHtml } from "../website";
import { h, type StyleMap } from "./dom";

/** renderExamHtml + DOMPurify.sanitize, exactly the website's pipeline for a content field. */
export function examHtml(raw: string | null | undefined): string {
  return DOMPurify.sanitize(renderExamHtml(raw));
}

/** `<SafeHtml className style html/>` → a <div> with the sanitised HTML inside. */
export function safeHtml(html: string, props: { className?: string; style?: StyleMap } = {}): HTMLDivElement {
  const el = h("div", { className: props.className, style: props.style });
  el.innerHTML = DOMPurify.sanitize(html);
  hardenContent(el);
  return el;
}

/**
 * Island hardening of rendered content (no browser habits): no tooltips, no <select>, no live
 * links. Elements are neutralised in place rather than removed, so the text — and therefore
 * every stored highlight offset — is unchanged.
 */
export function hardenContent(root: Element): void {
  for (const el of root.querySelectorAll("[title]")) el.removeAttribute("title");
  for (const el of root.querySelectorAll("select")) el.remove();
  for (const a of root.querySelectorAll("a")) {
    a.removeAttribute("href");
    a.removeAttribute("target");
    a.setAttribute("tabindex", "-1");
  }
  for (const img of root.querySelectorAll("img")) img.setAttribute("draggable", "false");
}
