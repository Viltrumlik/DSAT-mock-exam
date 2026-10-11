// Port of frontend/src/features/testing-simulation/components/AnswerPane.tsx.
// Right pane (or the only pane on Math): the question header band (black number block, grey
// band with Mark for Review and the ABC eliminator toggle), the colour rule, the Math figure,
// the highlightable stem (#ts-question), then the choices (#ts-choices) or the SPR input.
//
// Built once per question at module.load. `update` only touches classes, a few text nodes and
// the root style — the KaTeX-rendered content is never rebuilt.
//
// Island additions (not in the website's runner):
//   * review mode (`state.review`): read-only, choices marked correct/incorrect; an SPR
//     question shows the review page's "Your Answer" / "Correct Answer(s)" boxes; and the
//     explanation, when the question carries one, in the review page's block
//     (app/review/[attemptId]/page.tsx).
//   * `locked` (native inputLocked): clicks and typing are ignored.
//   * no `title` tooltips.
import type { IslandQuestion } from "../protocol";
import type { MediaStore } from "../content/media";
import { isStudentProducedResponse, type ExamQuestion } from "../website";
import { ChoiceList, type ChoiceListView, type ChoiceReview } from "./ChoiceList";
import { h, setClass, setStyle } from "./dom";
import { icon } from "./icons";
import { examHtml, safeHtml } from "./safeHtml";
import { SatColorRule } from "./SatColorRule";
import { SprInput, type SprInputView } from "./SprInput";

export interface AnswerReview {
  correct: string;
  studentAnswer: string | null;
  isCorrect: boolean;
}

export interface AnswerPaneState {
  displayNumber: number;
  zoom: number;
  flagged: boolean;
  eliminationMode: boolean;
  answer: string | undefined;
  eliminated: readonly string[];
  calcReserve: number;
  locked: boolean;
  review: AnswerReview | null;
  /** The pane's sizing from the runner page (two-pane width, or flex:1 single-pane). */
  style: Record<string, string | number>;
}

export interface AnswerPaneHandlers {
  onToggleFlag(): void;
  onToggleEliminationMode(): void;
  onSelect(key: string): void;
  onInput(value: string): void;
  onEliminate(key: string): void;
}

export interface AnswerPaneView {
  readonly el: HTMLDivElement;
  /** `#ts-question`. */
  readonly questionContainer: HTMLDivElement;
  /** `#ts-choices` (absent on SPR questions). */
  readonly choicesContainer: HTMLDivElement | null;
  readonly isSpr: boolean;
  readonly spr: SprInputView | null;
  update(state: AnswerPaneState): void;
}

const FLAG_ON = "flex items-center gap-2 text-[15px] transition-colors font-bold text-[#b0122a] underline underline-offset-[3px]";
const FLAG_OFF = "flex items-center gap-2 text-[15px] transition-colors text-slate-700 hover:text-slate-900";
const BOOKMARK_ON = "h-[19px] w-[17px] fill-[#b0122a] text-[#b0122a]";
const BOOKMARK_OFF = "h-[19px] w-[17px] fill-none text-slate-500";
const ELIM = "relative flex h-[26px] w-[34px] items-center justify-center rounded-[5px] border-[1.5px] transition-colors";
const ELIM_ON = "border-[#2b47c9] bg-[#2b47c9] text-white";
const ELIM_OFF = "border-slate-500 bg-white text-slate-800 hover:border-slate-700";

/** "7/2, 3.5" → ["7/2", "3.5"] (the review page shows the string; the island also splits it). */
export function acceptedAnswers(correct: string): string[] {
  return correct
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function AnswerPane(question: IslandQuestion, isMath: boolean, media: MediaStore, handlers: AnswerPaneHandlers): AnswerPaneView {
  const isSpr = isStudentProducedResponse(question as unknown as ExamQuestion);
  let state: AnswerPaneState | null = null;

  // ── Header band ───────────────────────────────────────────────────────────
  const number = h("span", { className: "flex items-center bg-[#151515] px-3 py-1.5 text-lg font-bold tracking-tight text-white" }, "");
  const numberText = document.createTextNode("");
  number.appendChild(numberText);
  let bookmark = icon("bookmark", BOOKMARK_OFF);
  const flagLabel = document.createTextNode("Mark for Review");
  const flagButton = h(
    "button",
    {
      className: FLAG_OFF,
      attrs: { type: "button" },
      on: {
        click: () => {
          if (state?.locked || state?.review) return;
          handlers.onToggleFlag();
        },
      },
    },
    bookmark,
    flagLabel,
  );
  // Answer-elimination toggle is meaningless for SPR (no choices).
  const elimToggle = isSpr
    ? null
    : h(
        "button",
        {
          className: `${ELIM} ${ELIM_OFF}`,
          attrs: { type: "button", "aria-pressed": "false" },
          on: {
            click: () => {
              if (state?.locked || state?.review) return;
              handlers.onToggleEliminationMode();
            },
          },
        },
        h("span", { className: "text-[11px] font-extrabold italic leading-none tracking-tight" }, "ABC"),
        h("span", { className: "absolute left-[3px] right-[3px] top-1/2 h-[1.6px] -translate-y-1/2 -rotate-[10deg] bg-current" }),
      );
  const band = h("div", { className: "flex flex-1 items-center justify-between bg-[#eceef1] px-3" }, flagButton, elimToggle);
  const header = h("div", { className: "mb-0 flex items-stretch overflow-hidden rounded-[3px]" }, number, band);

  // ── Math figure (single-pane layout has no PassagePane) ──────────────────
  let figure: HTMLDivElement | null = null;
  if (isMath && question.question_image_key) {
    const img = h("img", {
      className: "max-h-[360px] max-w-full rounded-lg border border-slate-100 bg-slate-50 object-contain p-2",
      attrs: { alt: "Question figure", draggable: "false" },
    });
    media.bind(img, question.question_image_key);
    figure = h("div", { className: "mb-6 flex justify-center" }, img);
  }

  // ── Highlightable question content (prompt for RW, stem for math) ────────
  const stemClass = "mathjax-process mb-8 font-[Georgia] font-medium leading-relaxed text-slate-900";
  const prompt = question.question_prompt && !isSpr ? safeHtml(examHtml(question.question_prompt), { className: stemClass }) : null;
  const stem = isMath ? safeHtml(examHtml(question.question_text), { className: stemClass }) : null;
  const questionContainer = h("div", { attrs: { id: "ts-question" } }, prompt, stem);

  // ── Answer area ───────────────────────────────────────────────────────────
  let spr: SprInputView | null = null;
  let choices: ChoiceListView | null = null;
  let choicesContainer: HTMLDivElement | null = null;
  let answerArea: HTMLElement;
  if (isSpr) {
    spr = SprInput("", (v) => handlers.onInput(v));
    answerArea = spr.el;
  } else {
    choices = ChoiceList(question, media, { onSelect: handlers.onSelect, onEliminate: handlers.onEliminate });
    choicesContainer = h("div", { attrs: { id: "ts-choices" } }, choices.el);
    answerArea = choicesContainer;
  }

  // ── Review extras (island addition) ───────────────────────────────────────
  const reviewSlot = h("div", { attrs: { "data-island": "review" } });
  const explanationRaw = typeof question.explanation === "string" ? question.explanation : "";

  const inner = h("div", { className: "w-full max-w-3xl mx-auto" }, header, SatColorRule("mb-8 mt-0"), figure, questionContainer, answerArea);
  const el = h("div", { className: "min-w-0 overflow-y-auto overflow-x-hidden bg-white p-10 pb-8 transition-[padding] duration-300 ease-out" }, inner);

  function renderReview(review: AnswerReview | null): void {
    if (!review) {
      if (reviewSlot.isConnected || reviewSlot.parentNode) reviewSlot.remove();
      if (spr && !spr.el.parentNode) inner.insertBefore(spr.el, reviewSlot.parentNode ? reviewSlot : null);
      return;
    }
    const parts: HTMLElement[] = [];
    if (isSpr) {
      const good = review.isCorrect;
      parts.push(
        h(
          "div",
          { className: "mt-6 space-y-4" },
          h(
            "div",
            { className: `p-5 rounded-xl border-2 ${good ? "border-emerald-500 bg-emerald-50" : "border-red-400 bg-red-50"}` },
            h("p", { className: "text-[10px] uppercase font-bold text-muted-foreground mb-1" }, "Your Answer"),
            h(
              "div",
              { className: "flex items-center justify-between" },
              h("p", { className: `text-xl font-bold ${good ? "text-emerald-700" : "text-red-700"}` }, review.studentAnswer || "Omitted"),
              good ? icon("circle-check", "w-6 h-6 text-emerald-600") : icon("circle-x", "w-6 h-6 text-red-600"),
            ),
          ),
          h(
            "div",
            { className: "p-5 rounded-xl border-2 border-foreground bg-foreground text-background shadow-lg" },
            h("p", { className: "text-[10px] uppercase font-bold opacity-70 mb-1" }, "Correct Answer(s)"),
            h("p", { className: "text-xl font-bold" }, review.correct),
          ),
        ),
      );
    }
    if (explanationRaw) {
      parts.push(
        h(
          "div",
          { className: "mt-8 bg-primary/5 p-6 rounded-2xl border border-primary/15" },
          h("h4", { className: "text-[10px] font-bold text-primary uppercase tracking-widest mb-3" }, "Explanation"),
          safeHtml(examHtml(explanationRaw), { className: "leading-relaxed max-w-full overflow-x-auto text-foreground font-[Georgia] leading-relaxed text-sm" }),
        ),
      );
    }
    reviewSlot.replaceChildren(...parts);
    // The SPR input gives way to the review boxes; choices stay (they carry the marking).
    if (spr && spr.el.parentNode) spr.el.remove();
    if (!reviewSlot.parentNode) inner.appendChild(reviewSlot);
  }

  function update(next: AnswerPaneState): void {
    const prev = state;
    state = next;
    // Root style: fontSize, the calculator reserve, then the runner's sizing.
    setStyle(el, {
      fontSize: `${15 * next.zoom}px`,
      ...(next.calcReserve > 0 ? { paddingLeft: next.calcReserve } : null),
      ...next.style,
    });
    setClass(inner, `w-full max-w-3xl ${next.calcReserve > 0 ? "mr-auto" : "mx-auto"}`);
    if (numberText.data !== String(next.displayNumber)) numberText.data = String(next.displayNumber);

    if (!prev || prev.flagged !== next.flagged) {
      setClass(flagButton, next.flagged ? FLAG_ON : FLAG_OFF);
      const fresh = icon("bookmark", next.flagged ? BOOKMARK_ON : BOOKMARK_OFF);
      bookmark.replaceWith(fresh);
      bookmark = fresh;
      flagLabel.data = next.flagged ? "Marked for Review" : "Mark for Review";
    }
    flagButton.disabled = Boolean(next.review);
    if (elimToggle) {
      setClass(elimToggle, `${ELIM} ${next.eliminationMode ? ELIM_ON : ELIM_OFF}`);
      elimToggle.setAttribute("aria-pressed", String(next.eliminationMode));
      // Review is read-only: the toggle has nothing to act on.
      elimToggle.style.visibility = next.review ? "hidden" : "";
      if (elimToggle.getAttribute("style") === "") elimToggle.removeAttribute("style");
    }

    const fs = `${16 * next.zoom * 1.2}px`;
    if (prompt) setStyle(prompt, { fontSize: fs });
    if (stem) setStyle(stem, { fontSize: fs });

    if (spr) {
      spr.setValue(next.answer ?? "");
      spr.setLocked(next.locked || Boolean(next.review));
    }
    if (choices) {
      const review: ChoiceReview | null = next.review
        ? { correct: acceptedAnswers(next.review.correct), student: next.review.studentAnswer }
        : null;
      choices.update({
        selected: next.answer,
        eliminated: next.eliminated,
        eliminationMode: next.eliminationMode,
        locked: next.locked,
        review,
      });
    }
    if (!prev || prev.review !== next.review) renderReview(next.review);
  }

  return { el, questionContainer, choicesContainer, isSpr, spr, update };
}
