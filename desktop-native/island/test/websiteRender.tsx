// Renders the WEBSITE's own runner components (React, from ../../frontend/src) over a bundle
// question, exactly as ExamRunnerPage composes the card region — the reference the island's
// ported DOM is compared against (DOM parity tests, and the visual comparison's HTML).
import { act } from "react";
import { createRoot } from "react-dom/client";

import { AnswerPane } from "@website/features/testing-simulation/components/AnswerPane";
import { PassagePane } from "@website/features/testing-simulation/components/PassagePane";
import { StudentProducedResponseGuide } from "@website/features/testing-simulation/components/StudentProducedResponseGuide";
import type { ExamQuestion } from "@website/features/testing-simulation/types";

import type { IslandQuestion } from "../src/protocol";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A bundle question in the website's shape: image keys become the URLs the island uses. */
export function toWebsiteQuestion(q: IslandQuestion, mediaUrl: (key: string) => string | undefined): ExamQuestion {
  const options = q.options
    ? Object.fromEntries(
        Object.entries(q.options).map(([k, o]) => [k, o.image_key ? { text: o.text, image: mediaUrl(o.image_key) } : { text: o.text }]),
      )
    : null;
  return {
    id: q.id,
    question_type: q.question_type as ExamQuestion["question_type"],
    question_text: q.question_text,
    question_prompt: q.question_prompt,
    question_image: q.question_image_key ? (mediaUrl(q.question_image_key) ?? null) : null,
    is_math_input: q.is_math_input,
    options,
  } as ExamQuestion;
}

export interface WebsiteCardProps {
  question: ExamQuestion;
  twoPane: boolean;
  displayNumber: number;
  zoom: number;
  splitPct: number;
  flagged: boolean;
  eliminationMode: boolean;
  answer: string | undefined;
  eliminated: string[];
  sprGuideExpanded: boolean;
  calcReserve: number;
  highlighterActive: boolean;
}

const noop = () => {};

/** ExamRunnerPage's <main> for one question (the island's card region). */
export function WebsiteCard(p: WebsiteCardProps) {
  const q = p.question;
  const isSpr = Boolean(q.is_math_input);
  return (
    <main
      className={`flex min-h-0 flex-1 overflow-hidden ${p.highlighterActive ? "ts-annotating [&_#ts-passage]:cursor-text [&_#ts-question]:cursor-text [&_#ts-choices]:cursor-text" : ""}`}
    >
      {p.twoPane ? (
        <>
          <PassagePane question={q} zoom={p.zoom} style={{ width: `${p.splitPct}%`, flex: "none" }} />
          <div className="relative w-[2px] shrink-0 cursor-col-resize select-none bg-slate-300" role="separator" aria-orientation="vertical">
            <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-11 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md bg-[#1b1b1b] text-white">
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <path d="M8 7l-5 5 5 5V7z" />
                <path d="M16 7l5 5-5 5V7z" />
              </svg>
            </span>
          </div>
          <AnswerPane
            question={q}
            displayNumber={p.displayNumber}
            zoom={p.zoom}
            isMath={false}
            flagged={p.flagged}
            onToggleFlag={noop}
            eliminationMode={p.eliminationMode}
            onToggleEliminationMode={noop}
            answer={p.answer}
            eliminated={p.eliminated}
            onSelect={noop}
            onEliminate={noop}
            style={{ width: `${100 - p.splitPct}%`, flex: "none" }}
          />
        </>
      ) : (
        <>
          {isSpr && (
            <div className="h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-out" style={{ width: p.sprGuideExpanded ? "50%" : "3rem" }}>
              <StudentProducedResponseGuide expanded={p.sprGuideExpanded} onToggle={noop} />
            </div>
          )}
          <AnswerPane
            question={q}
            displayNumber={p.displayNumber}
            zoom={p.zoom}
            isMath
            flagged={p.flagged}
            onToggleFlag={noop}
            eliminationMode={p.eliminationMode}
            onToggleEliminationMode={noop}
            answer={p.answer}
            eliminated={p.eliminated}
            onSelect={noop}
            onEliminate={noop}
            style={{ flex: "1 1 0%", minWidth: 0 }}
            calcReserve={isSpr ? 0 : p.calcReserve}
          />
        </>
      )}
    </main>
  );
}

/** Render the website's card into a detached host element; returns the <main>. */
export function renderWebsiteCard(props: WebsiteCardProps): { main: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<WebsiteCard {...props} />);
  });
  const main = host.querySelector("main")!;
  return {
    main,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

// ── DOM comparison ──────────────────────────────────────────────────────────────────────────

/** Attributes only one side has by design (island hardening / bookkeeping). */
export const ISLAND_ONLY_ATTRS = new Set([
  "title", // stripped in the island (no tooltips)
  "data-media-key", // MediaStore binding
  "draggable", // images are undraggable in the island
  "autocomplete",
  "autocorrect",
  "autocapitalize",
  "spellcheck", // SPR input: no browser assistance
]);

function styleOf(el: Element): string {
  const s = (el as HTMLElement).style;
  if (!s || s.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const p = s.item(i);
    parts.push(`${p}:${s.getPropertyValue(p)}`);
  }
  return parts.sort().join(";");
}

/** A stable, order-insensitive description of an element tree, for equality checks. */
export function describeDom(node: Node, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  if (node.nodeType === 3) {
    const t = (node as Text).data;
    return t === "" ? [] : [`${pad}#text ${JSON.stringify(t)}`];
  }
  if (node.nodeType !== 1) return [];
  const el = node as Element;
  const attrs = [...el.attributes]
    .filter((a) => !ISLAND_ONLY_ATTRS.has(a.name) && a.name !== "style")
    .map((a) => `${a.name}=${JSON.stringify(a.name === "class" ? a.value.split(/\s+/).filter(Boolean).join(" ") : a.value)}`)
    .sort();
  const style = styleOf(el);
  if (style) attrs.push(`style{${style}}`);
  const lines = [`${pad}<${el.tagName.toLowerCase()} ${attrs.join(" ")}>`];
  for (const c of el.childNodes) lines.push(...describeDom(c, depth + 1));
  return lines;
}
