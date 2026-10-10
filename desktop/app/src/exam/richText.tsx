/**
 * Render exam rich text: a tiny markdown (bold/italic — the server also authors <u>/<sup>/<sub>),
 * KaTeX for `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, then DOMPurify. Mirrors the site's renderExamHtml
 * (KaTeX, not MathJax — the CSS ships via `katex/dist/katex.min.css`, imported in main.tsx).
 *
 * Math is stashed out BEFORE sanitising (so `<`/`>` inside a formula survives) and KaTeX's own
 * trusted output is spliced back in AFTER — the sanitiser only ever sees authored prose.
 */
import { type CSSProperties } from "react";
import DOMPurify from "dompurify";
import katex from "katex";

const SANITIZE = {
  ALLOWED_TAGS: [
    "b", "strong", "i", "em", "u", "sup", "sub", "br", "p", "span", "div",
    "ul", "ol", "li", "img", "table", "thead", "tbody", "tr", "td", "th",
    "blockquote", "code", "pre", "h1", "h2", "h3", "h4",
  ],
  ALLOWED_ATTR: ["class", "style", "src", "alt", "width", "height", "colspan", "rowspan", "data-math"],
};

function renderOne(expr: string, display: boolean): string {
  try {
    return katex.renderToString(expr, { displayMode: display, throwOnError: false, output: "html" });
  } catch {
    return display ? `$$${expr}$$` : `$${expr}$`;
  }
}

function markdownLite(s: string): string {
  return s
    .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
}

export function renderExamHtml(raw: string): string {
  if (!raw) return "";
  const math: string[] = [];
  const stash = (expr: string, display: boolean) => {
    const i = math.length;
    math.push(renderOne(expr, display));
    return `<span data-math="${i}"></span>`;
  };

  let s = raw
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, e) => stash(e, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, e) => stash(e, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, e) => stash(e, false))
    .replace(/\$([^$\n]+?)\$/g, (_m, e) => stash(e, false));

  s = markdownLite(s);
  s = String(DOMPurify.sanitize(s, SANITIZE));
  // Splice KaTeX (trusted) back in, matching DOMPurify's normalised empty span.
  return s.replace(/<span[^>]*data-math="(\d+)"[^>]*><\/span>/g, (_m, i) => math[Number(i)] ?? "");
}

export function SafeHtml({
  html,
  className,
  block,
  style,
}: {
  html: string;
  className?: string;
  block?: boolean;
  style?: CSSProperties;
}) {
  const Tag = block ? "div" : "span";
  return <Tag className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}
