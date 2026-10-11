// Port of frontend/src/features/testing-simulation/components/PassagePane.tsx.
// Left pane (Reading & Writing): the stimulus/passage and any figure. Read-only.
// Built once per question at module.load; zoom/width changes only touch the root style.
import type { IslandQuestion } from "../protocol";
import type { MediaStore } from "../content/media";
import { h, setStyle } from "./dom";
import { examHtml, safeHtml } from "./safeHtml";

export interface PassagePaneView {
  readonly el: HTMLDivElement;
  /** `#ts-passage`, the highlighter's "passage" container. */
  readonly container: HTMLDivElement;
  update(zoom: number, split: number): void;
}

export function PassagePane(question: IslandQuestion, media: MediaStore): PassagePaneView {
  const figureKey = question.question_image_key;
  let figure: HTMLDivElement | null = null;
  if (figureKey) {
    const img = h("img", { className: "max-h-[400px] max-w-full object-contain", attrs: { alt: "Passage figure", draggable: "false" } });
    media.bind(img, figureKey);
    figure = h("div", { className: "mb-6 flex justify-center rounded-lg border border-slate-100 bg-slate-50 p-4" }, img);
  }
  const container = h(
    "div",
    { className: "prose prose-slate max-w-none leading-relaxed text-slate-900", attrs: { id: "ts-passage" } },
    figure,
    safeHtml(examHtml(question.question_text), { className: "mathjax-process font-[Georgia] font-medium leading-relaxed", media }),
  );
  const el = h("div", { className: "min-w-0 overflow-y-auto p-10" }, container);
  return {
    el,
    container,
    update(zoom, split) {
      // ExamRunnerPage: style={{ width: `${splitPct}%`, flex: "none" }} merged after fontSize.
      setStyle(el, { fontSize: `${17 * zoom}px`, width: `${split * 100}%`, flex: "none" });
    },
  };
}
