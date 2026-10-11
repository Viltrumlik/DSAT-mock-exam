// Port of frontend/src/components/SafeHtml.tsx (the parts the question card uses).
//
// The website renders question content as <SafeHtml html={renderExamHtml(raw)} …/>, i.e.
// `DOMPurify.sanitize(html)` with DOMPurify's DEFAULT options, written as the innerHTML of a
// <div> carrying the given className/style. The island does exactly that, once per question
// at module.load (so KaTeX never runs again while the student moves between questions).
// SafeHtml's MathJax typeset is a no-op on the website (MathJax is never loaded on this
// surface) and is not ported.
//
// Island additions, none of which touch a text node (so highlight offsets are unchanged):
//   * inline images named `media:<key>` (the bundle builder's rewrite of storage-host srcs,
//     design_data_server.md §2) become `data-ms-media="<key>"` before sanitising — DOMPurify
//     would drop the unknown `media:` scheme — and are bound to the media.put blob: URL;
//   * hardenContent(): no tooltips, no <select>, inert links, undraggable images.
import DOMPurify from "dompurify";

import type { MediaStore } from "../content/media";
import { renderExamHtml } from "../website";
import { h, type StyleMap } from "./dom";

/** The website's content pipeline for one field: renderExamHtml (prepareRichText + KaTeX). */
export function examHtml(raw: string | null | undefined): string {
  return renderExamHtml(raw);
}

const MEDIA_SRC = /(<img\b[^>]*?\s)src\s*=\s*(["'])media:([^"']+)\2/gi;

/** `<img src="media:KEY">` → `<img data-ms-media="KEY">` (survives DOMPurify's URI filter). */
export function rewriteMediaSources(html: string): string {
  return html.replace(MEDIA_SRC, (_m, head: string, q: string, key: string) => `${head}data-ms-media=${q}${key}${q}`);
}

/** `<SafeHtml className style html/>` → a <div> with the sanitised HTML inside. */
export function safeHtml(html: string, props: { className?: string; style?: StyleMap; media?: MediaStore } = {}): HTMLDivElement {
  const el = h("div", { className: props.className, style: props.style });
  el.innerHTML = DOMPurify.sanitize(rewriteMediaSources(html));
  hardenContent(el);
  if (props.media) {
    for (const img of el.querySelectorAll<HTMLImageElement>("img[data-ms-media]")) {
      props.media.bind(img, img.dataset.msMedia ?? "");
    }
  }
  return el;
}

/**
 * Island hardening of rendered content (no browser habits): no tooltips, no <select>, no live
 * links. Elements are neutralised in place rather than removed, so the text — and therefore
 * every stored highlight offset — is unchanged. (A <select>'s option text never takes part in
 * the website's offsets either: the website would render it as a live control; the island
 * drops the control, so its text nodes go too. Question content never contains one.)
 */
export function hardenContent(root: Element): void {
  if (root.hasAttribute("title")) root.removeAttribute("title");
  for (const el of root.querySelectorAll("[title]")) el.removeAttribute("title");
  for (const el of root.querySelectorAll("select")) el.remove();
  for (const a of root.querySelectorAll("a")) {
    a.removeAttribute("href");
    a.removeAttribute("target");
    a.setAttribute("tabindex", "-1");
  }
  for (const img of root.querySelectorAll("img")) img.setAttribute("draggable", "false");
  for (const el of root.querySelectorAll("input:not([data-island-spr]), textarea, button:not([type])")) {
    // Content never carries form controls; a stray one must not take focus or submit.
    el.setAttribute("tabindex", "-1");
    if (el instanceof HTMLButtonElement) el.type = "button";
  }
}
