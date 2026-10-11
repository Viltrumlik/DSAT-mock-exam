// One question's card: the children of the runner's <main> for that question, built ONCE at
// module.load (sanitise + KaTeX run here and never again) and swapped in by question.show.
//
// Layout = pages/ExamRunnerPage.tsx's <main> branches:
//   R&W  (twoPane):  PassagePane (width split%) · the drag divider · AnswerPane (100-split%)
//   Math (single):   [SPR directions column, grid-ins only] · AnswerPane (flex 1)
// The SPR directions column is ONE element shared by every grid-in card (its collapsed state
// persists across SPR questions, like the website's sessionStorage flag).
import type { IslandQuestion, IslandReviewInfo } from "../protocol";
import { AnswerPane, type AnswerPaneHandlers, type AnswerPaneView } from "../ported/AnswerPane";
import type { ContainerKey } from "../ported/annotator";
import { h, svg } from "../ported/dom";
import { PassagePane, type PassagePaneView } from "../ported/PassagePane";
import type { MediaStore } from "./media";

export interface CardView {
  zoom: number;
  split: number;
  eliminatorOn: boolean;
  inputLocked: boolean;
  calcReservePx: number;
}

export interface CardState {
  index: number;
  total: number;
  answer: string | undefined;
  eliminated: string[];
  flagged: boolean;
  review: IslandReviewInfo | null;
}

/** The divider between the R&W panes, as ExamRunnerPage renders it (Bluebook drag handle). */
export function SplitDivider(onDown: (e: MouseEvent) => void): HTMLDivElement {
  return h(
    "div",
    {
      className: "relative w-[2px] shrink-0 cursor-col-resize select-none bg-slate-300",
      attrs: { role: "separator", "aria-orientation": "vertical" },
      on: { mousedown: onDown },
    },
    h(
      "span",
      {
        className:
          "pointer-events-none absolute left-1/2 top-1/2 flex h-11 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md bg-[#1b1b1b] text-white",
      },
      svg("svg", { viewBox: "0 0 24 24", fill: "currentColor", class: "h-4 w-4" }, svg("path", { d: "M8 7l-5 5 5 5V7z" }), svg("path", { d: "M16 7l5 5-5 5V7z" })),
    ),
  );
}

export class QuestionCard {
  readonly qid: number;
  readonly passage: PassagePaneView | null;
  readonly answer: AnswerPaneView;
  readonly divider: HTMLDivElement | null;
  state: CardState = { index: 0, total: 0, answer: undefined, eliminated: [], flagged: false, review: null };
  /** Scroll positions remembered while the card is detached (detaching resets scrollTop). */
  scroll = { passage: 0, answer: 0 };

  constructor(
    readonly question: IslandQuestion,
    readonly twoPane: boolean,
    media: MediaStore,
    handlers: AnswerPaneHandlers,
    onDividerDown: (e: MouseEvent) => void,
  ) {
    this.qid = question.id;
    this.passage = twoPane ? PassagePane(question, media) : null;
    this.divider = twoPane ? SplitDivider(onDividerDown) : null;
    this.answer = AnswerPane(question, !twoPane, media, handlers);
  }

  get isSpr(): boolean {
    return this.answer.isSpr;
  }

  /** The highlighter's region for `key` (null when this card has none). */
  container(key: ContainerKey): HTMLElement | null {
    if (key === "passage") return this.passage?.container ?? null;
    if (key === "question") return this.answer.questionContainer;
    return this.answer.choicesContainer;
  }

  /** The <main> children for this card. `sprColumn` is the shared directions column. */
  nodes(sprColumn: HTMLElement | null): HTMLElement[] {
    if (this.twoPane && this.passage && this.divider) return [this.passage.el, this.divider, this.answer.el];
    if (this.isSpr && sprColumn) return [sprColumn, this.answer.el];
    return [this.answer.el];
  }

  /** The pane `question.show.scrollTop` applies to: the passage on R&W, the answer pane on Math. */
  get primaryScroller(): HTMLElement {
    return this.passage?.el ?? this.answer.el;
  }

  saveScroll(): void {
    this.scroll = { passage: this.passage?.el.scrollTop ?? 0, answer: this.answer.el.scrollTop };
  }

  restoreScroll(scrollTop: number | undefined): void {
    if (this.passage) this.passage.el.scrollTop = scrollTop ?? this.scroll.passage;
    this.answer.el.scrollTop = this.passage ? this.scroll.answer : (scrollTop ?? this.scroll.answer);
  }

  /** Re-render the card's live parts for the current view + state. Cheap: classes and styles. */
  render(view: CardView): void {
    const splitPct = view.split * 100;
    this.passage?.update(view.zoom, view.split);
    const style: Record<string, string | number> = this.twoPane
      ? { width: `${100 - splitPct}%`, flex: "none" }
      : { flex: "1 1 0%", minWidth: 0 };
    this.answer.update({
      displayNumber: this.state.index + 1,
      zoom: view.zoom,
      flagged: this.state.flagged,
      eliminationMode: view.eliminatorOn,
      answer: this.state.answer,
      eliminated: this.state.eliminated,
      // Single-pane only, and never on a grid-in (the directions column already takes the
      // left side; Desmos floats over it) — ExamRunnerPage's calcReserve rule. The rest of that
      // rule (`calculatorAllowed(attempt) && tools.calculatorOpen`, 2026-10-11: a Foundation
      // Math midterm has no calculator) is native's: calcReservePx is 0 unless the paper allows
      // a calculator AND it is open (exam_runner_screen.dart calcReserveFor).
      calcReserve: !this.twoPane && !this.isSpr ? view.calcReservePx : 0,
      locked: view.inputLocked,
      review: this.state.review,
      style,
    });
  }
}
