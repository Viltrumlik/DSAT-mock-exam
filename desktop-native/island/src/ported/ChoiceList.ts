// Port of frontend/src/features/testing-simulation/components/ChoiceList.tsx.
// Multiple-choice answer list with select + cross-out (eliminate) support.
//
// Class strings are the website's, verbatim. The option content (KaTeX + sanitised HTML, or
// the option image) is built once; selection/elimination changes only swap classes and the
// small optional nodes, exactly the nodes React would add or remove.
//
// Island additions: `locked` (inputLocked from native) ignores clicks; `review` paints the
// correct option green and a wrong pick red, with the website review page's colours
// (app/review/[attemptId]/page.tsx), and makes the list read-only.
import type { IslandQuestion } from "../protocol";
import type { MediaStore } from "../content/media";
import { parseOptions, resolveImageUrl, type ExamQuestion } from "../website";
import { h, setClass } from "./dom";
import { icon } from "./icons";
import { examHtml, safeHtml } from "./safeHtml";

export interface ChoiceReview {
  /** Accepted keys (the review page compares trimmed, lower-cased). */
  correct: readonly string[];
  student: string | null;
}

export interface ChoiceState {
  selected: string | undefined;
  eliminated: readonly string[];
  eliminationMode: boolean;
  locked: boolean;
  review: ChoiceReview | null;
}

export interface ChoiceHandlers {
  onSelect(key: string): void;
  onEliminate(key: string): void;
}

export interface ChoiceListView {
  readonly el: HTMLDivElement;
  readonly keys: readonly string[];
  update(state: ChoiceState): void;
}

const BTN = "relative flex min-h-[56px] flex-1 items-center rounded-[11px] transition-colors";
const BTN_SELECTED = "border-2 border-[#2b47c9] bg-[#f2f5fd] px-[17px] py-3";
const BTN_ELIMINATED = "cursor-not-allowed border border-slate-200 bg-white px-[18px] py-[13px]";
const BTN_IDLE = "border border-[#c8ccd4] bg-white px-[18px] py-[13px] hover:border-slate-400";
const LETTER = "flex h-[29px] w-[29px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[15px] font-semibold";
const LETTER_SELECTED = "border-[#2b47c9] bg-[#2b47c9] text-white";
const LETTER_ELIMINATED = "border-slate-300 text-slate-400";
const LETTER_IDLE = "border-[#757b86] text-slate-800";
// Review (island addition, colours from the website review page).
const BTN_REVIEW_CORRECT = "border-2 border-emerald-500 bg-emerald-50 px-[17px] py-3";
const BTN_REVIEW_WRONG = "border-2 border-red-400 bg-red-50 px-[17px] py-3";
const BTN_REVIEW_IDLE = "border border-[#c8ccd4] bg-white px-[18px] py-[13px]";
const LETTER_REVIEW_CORRECT = "border-emerald-500 bg-emerald-500 text-white";
const LETTER_REVIEW_WRONG = "border-red-500 bg-red-500 text-white";

interface Row {
  key: string;
  row: HTMLDivElement;
  button: HTMLButtonElement;
  letter: HTMLSpanElement;
  text: HTMLSpanElement;
  crossOut: HTMLSpanElement | null;
  control: HTMLButtonElement | null;
  controlKind: "undo" | "eliminate" | null;
  reviewIcon: SVGElement | null;
  reviewKind: "correct" | "wrong" | null;
}

function normal(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

/** The option's image: the bundle's `image_key` (via media.put), else the website's `image` URL. */
function optionImage(question: IslandQuestion, key: string, parsedImage: string | undefined, media: MediaStore, alt: string): HTMLImageElement | null {
  const raw = question.options?.[key] as { image_key?: unknown } | undefined;
  const imageKey = typeof raw?.image_key === "string" && raw.image_key ? raw.image_key : null;
  const legacy = resolveImageUrl(parsedImage);
  if (!imageKey && !legacy) return null;
  const img = h("img", {
    className: "max-h-[200px] max-w-full rounded-lg border border-slate-100 object-contain shadow-sm",
    attrs: { alt, draggable: "false" },
  });
  if (imageKey) media.bind(img, imageKey);
  else if (legacy) img.src = legacy;
  return img;
}

export function ChoiceList(question: IslandQuestion, media: MediaStore, handlers: ChoiceHandlers): ChoiceListView {
  const options = parseOptions(question as unknown as ExamQuestion);
  let state: ChoiceState = { selected: undefined, eliminated: [], eliminationMode: false, locked: false, review: null };

  const rows: Row[] = options.map(({ key, text, image }) => {
    const letter = h("span", { className: `${LETTER} ${LETTER_IDLE}` }, key);
    const img = optionImage(question, key, image, media, `Option ${key}`);
    const content = img ?? safeHtml(examHtml(text), { className: "mathjax-process w-full", media });
    const textSpan = h("span", { className: "ml-4 w-full text-left font-[Georgia] text-[16px] leading-snug text-slate-900" }, content);
    const button = h(
      "button",
      {
        className: `${BTN} ${BTN_IDLE}`,
        attrs: { type: "button", "aria-pressed": "false" },
        on: {
          click: () => {
            if (state.locked || state.review) return;
            if (!state.eliminated.includes(key)) handlers.onSelect(key);
          },
        },
      },
      letter,
      textSpan,
    );
    const row = h("div", { className: "group relative flex items-center gap-3" }, button);
    return { key, row, button, letter, text: textSpan, crossOut: null, control: null, controlKind: null, reviewIcon: null, reviewKind: null };
  });

  const el = h("div", { className: "w-full space-y-4" }, ...rows.map((r) => r.row));

  function makeControl(r: Row, kind: "undo" | "eliminate"): HTMLButtonElement {
    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      if (state.locked || state.review) return;
      handlers.onEliminate(r.key);
    };
    if (kind === "undo") {
      // Eliminated → an "Undo" pill (Bluebook restores via a text link).
      return h(
        "button",
        { className: "shrink-0 text-sm font-bold text-slate-900 underline underline-offset-2 hover:text-slate-700", attrs: { type: "button" }, on: { click: onClick } },
        "Undo",
      );
    }
    // Crossed-out circular letter (Bluebook eliminate control).
    return h(
      "button",
      {
        className:
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-400 text-slate-600 transition-colors hover:border-slate-600 hover:text-slate-900",
        attrs: { type: "button", "aria-label": `Eliminate ${r.key}` },
        on: { click: onClick },
      },
      h(
        "span",
        { className: "relative text-xs font-bold leading-none" },
        r.key,
        h("span", { className: "absolute left-1/2 top-1/2 h-px w-5 -translate-x-1/2 -translate-y-1/2 bg-current" }),
      ),
    );
  }

  function update(next: ChoiceState): void {
    state = next;
    const review = next.review;
    const correct = review ? review.correct.map(normal).filter((k) => k !== "") : [];
    const student = review ? normal(review.student) : "";
    for (const r of rows) {
      const k = normal(r.key);
      let btn: string;
      let letter: string;
      let reviewKind: Row["reviewKind"] = null;
      const isEliminated = !review && next.eliminated.includes(r.key);
      if (review) {
        const isCorrect = correct.includes(k);
        const isStudent = student !== "" && student === k;
        if (isCorrect) {
          btn = BTN_REVIEW_CORRECT;
          letter = LETTER_REVIEW_CORRECT;
          reviewKind = "correct";
        } else if (isStudent) {
          btn = BTN_REVIEW_WRONG;
          letter = LETTER_REVIEW_WRONG;
          reviewKind = "wrong";
        } else {
          btn = BTN_REVIEW_IDLE;
          letter = LETTER_IDLE;
        }
        r.button.setAttribute("aria-pressed", String(isStudent));
      } else {
        const isSelected = next.selected === r.key;
        btn = isSelected ? BTN_SELECTED : isEliminated ? BTN_ELIMINATED : BTN_IDLE;
        letter = isSelected ? LETTER_SELECTED : isEliminated ? LETTER_ELIMINATED : LETTER_IDLE;
        r.button.setAttribute("aria-pressed", String(isSelected));
      }
      setClass(r.button, `${BTN} ${btn}`);
      setClass(r.letter, `${LETTER} ${letter}`);
      setClass(r.text, `ml-4 w-full text-left font-[Georgia] text-[16px] leading-snug ${isEliminated ? "text-slate-400" : "text-slate-900"}`);

      // Bluebook cross-out: a single line through the whole option (letter + text).
      if (isEliminated && !r.crossOut) {
        r.crossOut = h("span", {
          className: "pointer-events-none absolute inset-x-1 top-1/2 h-[2px] -translate-y-1/2 bg-[#333]",
          attrs: { "aria-hidden": "true" },
        });
        r.button.insertBefore(r.crossOut, r.reviewIcon);
      } else if (!isEliminated && r.crossOut) {
        r.crossOut.remove();
        r.crossOut = null;
      }

      // Review icon (island addition): ✓ on the correct option, ✗ on a wrong pick.
      if (reviewKind !== r.reviewKind) {
        r.reviewIcon?.remove();
        r.reviewIcon =
          reviewKind === "correct"
            ? icon("circle-check", "w-4 h-4 text-emerald-600 ml-auto shrink-0")
            : reviewKind === "wrong"
              ? icon("circle-x", "w-4 h-4 text-red-600 ml-auto shrink-0")
              : null;
        if (r.reviewIcon) r.button.appendChild(r.reviewIcon);
        r.reviewKind = reviewKind;
      }

      const controlKind = !review && next.eliminationMode ? (isEliminated ? "undo" : "eliminate") : null;
      if (controlKind !== r.controlKind) {
        r.control?.remove();
        r.control = controlKind ? makeControl(r, controlKind) : null;
        if (r.control) r.row.appendChild(r.control);
        r.controlKind = controlKind;
      }
    }
  }

  update(state);
  return { el, keys: rows.map((r) => r.key), update };
}
