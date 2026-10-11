// Port of frontend/src/features/testing-simulation/components/StudentProducedResponseGuide.tsx
// (and its column wrapper from pages/ExamRunnerPage.tsx, the `isStudentProducedResponse`
// branch of the single-pane layout).
//
// The official SAT "Student-Produced Response Directions" panel: bullets + an
// Acceptable/Unacceptable examples table. Collapsed, it is a thin rail with a toggle. The
// collapse state is the island's (the website keeps it in sessionStorage for the tab) and
// persists across SPR questions. `title` tooltips are dropped (no browser habits).
import { h, setStyle } from "./dom";
import { icon } from "./icons";

export const BULLETS: string[] = [
  "If you find more than one correct answer, enter only one answer.",
  "You can enter up to 5 characters for a positive answer and up to 6 characters (including the negative sign) for a negative answer.",
  "If your answer is a fraction that doesn’t fit in the provided space, enter the decimal equivalent.",
  "If your answer is a decimal that doesn’t fit in the provided space, enter it by truncating or rounding at the fourth digit.",
  "If your answer is a mixed number (such as 3½), enter it as an improper fraction (7/2) or its decimal equivalent (3.5).",
  "Don’t enter symbols such as a percent sign, comma, or dollar sign.",
];

export const EXAMPLES: Array<{ answer: string; acceptable: string[]; unacceptable: string[] }> = [
  { answer: "3.5", acceptable: ["3.5", "3.50", "7/2"], unacceptable: ["31/2", "3 1/2"] },
  { answer: "2/3", acceptable: ["2/3", ".6666", ".6667", "0.666", "0.667"], unacceptable: ["0.66", ".66", "0.67", ".67"] },
  { answer: "-1/3", acceptable: ["-1/3", "-.3333", "-0.333"], unacceptable: ["-.33", "-0.33"] },
];

/** The guide's contents for one state (a fresh subtree, as React would mount it). */
export function StudentProducedResponseGuide(expanded: boolean, onToggle: () => void): HTMLDivElement {
  if (!expanded) {
    return h(
      "div",
      { className: "flex h-full w-full flex-col items-center border-r border-slate-200 bg-slate-50 py-3" },
      h(
        "button",
        {
          className: "rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:border-slate-400 hover:text-slate-900",
          attrs: { type: "button", "aria-label": "Show directions", "aria-expanded": "false" },
          on: { click: onToggle },
        },
        icon("panel-left-open", "h-4 w-4"),
      ),
      h(
        "span",
        { className: "mt-3 rotate-180 text-[11px] font-bold uppercase tracking-widest text-slate-500 [writing-mode:vertical-rl]" },
        "Directions",
      ),
    );
  }

  const cellList = (items: string[]) => h("div", { className: "space-y-1" }, ...items.map((a) => h("div", null, a)));
  return h(
    "div",
    { className: "flex h-full w-full flex-col border-r border-slate-200 bg-white" },
    h(
      "div",
      { className: "flex shrink-0 items-start justify-between gap-3 px-6 pt-6" },
      h("h2", { className: "text-lg font-bold tracking-tight text-slate-900" }, "Student-Produced Response Directions"),
      h(
        "button",
        {
          className: "mt-0.5 shrink-0 rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:border-slate-400 hover:text-slate-900",
          attrs: { type: "button", "aria-label": "Collapse directions", "aria-expanded": "true" },
          on: { click: onToggle },
        },
        icon("panel-left-close", "h-4 w-4"),
      ),
    ),
    h(
      "div",
      { className: "min-h-0 flex-1 overflow-y-auto px-6 pb-6" },
      h(
        "ul",
        { className: "mt-4 space-y-2.5 text-[15px] leading-snug text-slate-800" },
        ...BULLETS.map((b) =>
          h(
            "li",
            { className: "flex gap-2" },
            h("span", { className: "mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400", attrs: { "aria-hidden": "true" } }),
            h("span", null, b),
          ),
        ),
      ),
      h("h3", { className: "mb-2 mt-6 text-base font-bold text-slate-900" }, "Examples"),
      h(
        "table",
        { className: "w-full border-collapse overflow-hidden rounded-lg border border-slate-200 text-[13px]" },
        h(
          "thead",
          null,
          h(
            "tr",
            { className: "bg-slate-50 text-left align-top font-bold text-slate-700" },
            h("th", { className: "border-b border-slate-200 px-3 py-2" }, "Answer"),
            h("th", { className: "border-b border-slate-200 px-3 py-2" }, "Acceptable ways to enter answer"),
            h("th", { className: "border-b border-slate-200 px-3 py-2" }, "Unacceptable: will NOT receive credit"),
          ),
        ),
        h(
          "tbody",
          { className: "align-top text-slate-800" },
          ...EXAMPLES.map((row) =>
            h(
              "tr",
              { className: "border-b border-slate-100 last:border-0" },
              h("td", { className: "px-3 py-3 font-semibold" }, row.answer),
              h("td", { className: "px-3 py-3" }, cellList(row.acceptable)),
              h("td", { className: "px-3 py-3" }, cellList(row.unacceptable)),
            ),
          ),
        ),
      ),
    ),
  );
}

export interface SprGuideColumnView {
  readonly el: HTMLDivElement;
  render(expanded: boolean): void;
}

/** ExamRunnerPage's column: exactly half the screen expanded, a 3rem rail collapsed. */
export function SprGuideColumn(onToggle: () => void): SprGuideColumnView {
  const el = h("div", { className: "h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-out" });
  let shown: boolean | null = null;
  return {
    el,
    render(expanded: boolean) {
      setStyle(el, { width: expanded ? "50%" : "3rem" });
      if (shown === expanded) return;
      shown = expanded;
      el.replaceChildren(StudentProducedResponseGuide(expanded, onToggle));
    },
  };
}
