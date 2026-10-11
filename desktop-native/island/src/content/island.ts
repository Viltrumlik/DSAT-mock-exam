// The content island (architecture.md §2.4): the question card between the header's and the
// footer's colour rules, rendered with the website's own code, driven entirely by native
// messages (protocol/schema.json, island/src/protocol.ts). The card region's behaviour —
// the <main> frame, `.ts-annotating`, the divider drag clamped to 28–72 %, the SPR directions
// column state, the eliminate-deselects rule — is ported from
// frontend/src/features/testing-simulation/pages/ExamRunnerPage.tsx and hooks/useAnswers.ts.
//
//   native → island   init · module.load · media.put · question.show · state.patch ·
//                     view.set · annot.apply · selection.get · focus.release
//   island → native   ready · module.loaded · question.shown · answer.choose · answer.input ·
//                     answer.eliminate · flag.toggle · eliminator.toggle · selection ·
//                     selection.clear · annot.click · annot.changed · selection.current ·
//                     key · focus · split.changed · error
//
// Every question of a module is built once at module.load (sanitise + KaTeX into detached DOM,
// then one off-screen layout pass so fonts and images are warm); question.show only swaps the
// <main> children and repaints marks. A click paints at once (optimistic) and reports to
// native; native's state.patch / view.set is authoritative. Echoes of the island's own recent
// changes are recognised so a fast typist or clicker never sees a value bounce back.
import { IslandChannel, type Outgoing } from "../channel";
import type {
  AnnotApplyMessage,
  ContentToNative,
  InitMessage,
  ModuleLoadMessage,
  NativeToContent,
  QuestionShowMessage,
  StatePatchMessage,
  ViewSetMessage,
} from "../protocol";
import { PROTOCOL_VERSION } from "../protocol";
import { AnnotationToolbar, type AnnotationToolbarView } from "../ported/AnnotationToolbar";
import { Annotator, CONTAINER_KEYS, DEFAULT_COLOR, toWire, type AnnotOp, type ContainerKey } from "../ported/annotator";
import type { AnswerPaneHandlers } from "../ported/AnswerPane";
import { h, setClass } from "../ported/dom";
import { SprGuideColumn, type SprGuideColumnView } from "../ported/StudentProducedResponseGuide";
import type { IslandTransport } from "../transport";
import type { HighlightColor } from "../website";
import { QuestionCard, type CardView } from "./card";
import { installHardening, isTextField } from "./hardening";
import { forwardedKey } from "./keys";
import { MediaStore } from "./media";

export interface Settings {
  mode: InitMessage["mode"];
  kind: InitMessage["kind"];
  subject: InitMessage["subject"];
  overlays: InitMessage["overlays"];
}

export interface IslandView extends CardView {
  highlighterOn: boolean;
}

/** ExamRunnerPage clamps the divider drag to 28–72 %. */
export const SPLIT_MIN = 0.28;
export const SPLIT_MAX = 0.72;

const MAIN = "flex min-h-0 flex-1 overflow-hidden";
const MAIN_ANNOTATING = `${MAIN} ts-annotating [&_#ts-passage]:cursor-text [&_#ts-question]:cursor-text [&_#ts-choices]:cursor-text`;

/** Student-facing text for a question whose content could not be built. */
export const FAILED_QUESTION_TEXT =
  "<p>This question didn’t display correctly. You can still choose an answer, and you can let us know with Report a problem in the More menu.</p>";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const round = (v: number, places = 2) => Math.round(v * 10 ** places) / 10 ** places;

/**
 * The values the island sent and native has not echoed yet, oldest first. An echo of one of
 * them retires it and everything before it; it is applied only when nothing newer is still
 * in flight. An echo the island never sent is native overriding: applied, queue cleared.
 */
export class Pending<T> {
  private queue: string[] = [];
  push(v: T): void {
    this.queue.push(JSON.stringify(v));
    if (this.queue.length > 32) this.queue.shift();
  }
  /** True when the echo `v` should be applied. */
  echo(v: T): boolean {
    const k = JSON.stringify(v);
    const i = this.queue.indexOf(k);
    if (i < 0) {
      this.queue = [];
      return true;
    }
    this.queue.splice(0, i + 1);
    return this.queue.length === 0;
  }
  clear(): void {
    this.queue = [];
  }
  get size(): number {
    return this.queue.length;
  }
}

interface CardPending {
  answer: Pending<string>;
  eliminated: Pending<string[]>;
  flagged: Pending<boolean>;
}

export interface ContentIslandOptions {
  doc?: Document;
  /** Element the runner frame is mounted into (default: document.body). */
  mount?: HTMLElement;
  /** Build id sent in `ready` (default: the build-time constant). */
  build?: string;
}

export class ContentIsland {
  readonly channel: IslandChannel<"content">;
  readonly media: MediaStore;
  readonly annotator: Annotator;
  readonly root: HTMLDivElement;
  readonly main: HTMLElement;
  private readonly doc: Document;
  private readonly prerender: HTMLDivElement;
  private readonly toolbar: AnnotationToolbarView;
  private readonly sprColumn: SprGuideColumnView;
  private sprExpanded = true;

  settings: Settings = { mode: "exam", kind: "pastpaper", subject: "rw", overlays: "native" };
  view: IslandView = { zoom: 1, split: 0.5, eliminatorOn: false, inputLocked: false, calcReservePx: 0, highlighterOn: false };
  moduleId: number | null = null;
  private readonly cards = new Map<number, QuestionCard>();
  private readonly pending = new Map<number, CardPending>();
  private readonly eliminatorPending = new Pending<boolean>();
  private current: QuestionCard | null = null;
  private activeColor: HighlightColor = DEFAULT_COLOR;
  /** The inline toolbar's target (overlays:"inline"). */
  private inlineTarget: string | null = null;
  private dragging = false;
  private focusSent: boolean | null = null;
  private uninstall: Array<() => void> = [];

  constructor(
    transport: IslandTransport,
    private readonly opts: ContentIslandOptions = {},
  ) {
    this.doc = opts.doc ?? document;
    this.channel = new IslandChannel(transport, "content", (m) => this.handle(m));
    this.media = new MediaStore((this.doc.defaultView ?? window) as Window & typeof globalThis);
    this.annotator = new Annotator({
      currentQid: () => this.current?.qid ?? null,
      containers: () => CONTAINER_KEYS.map((key) => ({ key, el: this.current?.container(key) ?? null })),
      containerOf: (qid, key) => this.cards.get(qid)?.container(key) ?? null,
    });
    this.toolbar = AnnotationToolbar({
      onColor: (color) => this.inlineApply("highlight", { color }),
      onUnderline: (underline) => this.inlineApply("underline", { underline }),
      onDelete: () => this.inlineApply("remove", {}),
    });
    this.sprColumn = SprGuideColumn(() => {
      this.sprExpanded = !this.sprExpanded;
      this.sprColumn.render(this.sprExpanded);
    });
    this.main = h("main", { className: MAIN });
    // ExamRunnerPage's frame: div.ts-runner (the runner's UI face) around the card region.
    this.root = h("div", { className: "ts-runner flex h-screen flex-col bg-white", attrs: { "data-island": "content" } }, this.main);
    this.prerender = h("div", { attrs: { "data-island": "prerender", "aria-hidden": "true" } });
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    const mount = this.opts.mount ?? this.doc.body;
    mount.replaceChildren(this.root, this.prerender, this.toolbar.el);
    this.uninstall.push(installHardening(this.doc, { blockCopy: () => this.settings.kind === "midterm" }));
    const win = this.doc.defaultView ?? window;
    const listen = <K extends keyof DocumentEventMap>(target: Document, type: K, fn: (e: DocumentEventMap[K]) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.uninstall.push(() => target.removeEventListener(type, fn as EventListener));
    };
    const listenWin = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      win.addEventListener(type, fn as EventListener);
      this.uninstall.push(() => win.removeEventListener(type, fn as EventListener));
    };
    listen(this.doc, "mouseup", (e) => this.onMouseUp(e));
    listen(this.doc, "keydown", (e) => this.onKeyDown(e));
    listenWin("mousemove", (e) => this.onDrag(e));
    listenWin("mouseup", () => this.endDrag());
    listenWin("focus", () => this.sendFocus(true));
    listenWin("blur", () => this.sendFocus(false));
    listenWin("error", (e) => this.channel.reportError("window", (e as ErrorEvent).error ?? (e as ErrorEvent).message));
    listenWin("unhandledrejection", (e) => this.channel.reportError("promise", (e as PromiseRejectionEvent).reason));
    this.channel.start();
    this.send({ t: "ready", build: this.opts.build ?? (typeof __ISLAND_BUILD__ === "string" ? __ISLAND_BUILD__ : "island/dev"), protocol: PROTOCOL_VERSION });
  }

  stop(): void {
    this.channel.stop();
    for (const off of this.uninstall.reverse()) off();
    this.uninstall = [];
  }

  private send(m: Outgoing<ContentToNative>): boolean {
    return this.channel.send(m);
  }

  // ── inbound ────────────────────────────────────────────────────────────────

  handle(m: NativeToContent): void {
    switch (m.t) {
      case "init":
        return this.onInit(m);
      case "module.load":
        return this.onModuleLoad(m);
      case "media.put":
        this.media.put(m.key, m.mime, m.b64);
        return;
      case "question.show":
        return this.onQuestionShow(m);
      case "state.patch":
        return this.onStatePatch(m);
      case "view.set":
        return this.onViewSet(m);
      case "annot.apply":
        return this.onAnnotApply(m);
      case "selection.get": {
        const cur = this.annotator.current();
        this.send({ t: "selection.current", req: m.req, qid: this.current?.qid ?? 0, container: cur.container, text: cur.text });
        return;
      }
      case "focus.release": {
        const active = this.doc.activeElement as HTMLElement | null;
        if (active && active !== this.doc.body && typeof active.blur === "function") active.blur();
        return;
      }
    }
  }

  private onInit(m: InitMessage): void {
    const twoPaneBefore = this.settings.subject === "rw";
    this.settings = { mode: m.mode, kind: m.kind, subject: m.subject, overlays: m.overlays };
    this.view = {
      zoom: m.zoom,
      split: clamp(m.split, 0.1, 0.9),
      eliminatorOn: m.eliminatorOn,
      inputLocked: this.view.inputLocked,
      calcReservePx: Math.max(0, m.calcReservePx),
      highlighterOn: m.highlighterOn,
    };
    this.eliminatorPending.clear();
    // A subject change re-lays the card (two panes vs one): the module must be loaded again.
    if ((m.subject === "rw") !== twoPaneBefore && this.cards.size > 0) this.clearModule();
    this.applyMainClass();
    this.renderCurrent();
  }

  private clearModule(): void {
    this.cards.clear();
    this.pending.clear();
    this.current = null;
    this.moduleId = null;
    this.annotator.reset();
    this.closeInlineToolbar();
    this.media.unbindAll();
    this.main.replaceChildren();
  }

  private handlersFor(qid: number): AnswerPaneHandlers {
    return {
      onToggleFlag: () => this.toggleFlag(qid),
      onToggleEliminationMode: () => this.toggleEliminator(),
      onSelect: (key) => this.choose(qid, key),
      onInput: (value) => this.input(qid, value),
      onEliminate: (key) => this.eliminate(qid, key),
    };
  }

  private buildCard(q: ModuleLoadMessage["questions"][number], twoPane: boolean): QuestionCard {
    return new QuestionCard(q, twoPane, this.media, this.handlersFor(q.id), (e) => this.startDrag(e));
  }

  private onModuleLoad(m: ModuleLoadMessage): void {
    const t0 = now();
    this.clearModule();
    this.moduleId = m.moduleId;
    const twoPane = this.settings.subject === "rw";
    const failed: number[] = [];
    for (const q of m.questions) {
      let card: QuestionCard;
      try {
        card = this.buildCard(q, twoPane);
      } catch (err) {
        failed.push(q.id);
        console.error(`[island] question ${q.id} failed to build`, err);
        card = this.buildCard({ ...q, question_text: FAILED_QUESTION_TEXT, question_prompt: "", question_image_key: null }, twoPane);
      }
      this.cards.set(q.id, card);
      this.pending.set(q.id, { answer: new Pending(), eliminated: new Pending(), flagged: new Pending() });
    }
    this.warmUp();
    this.send({ t: "module.loaded", moduleId: m.moduleId, ms: round(now() - t0), failed });
  }

  /** One off-screen layout pass over every card, so first paint of each question is warm. */
  private warmUp(): void {
    if (this.cards.size === 0) return;
    const frame = h("main", { className: MAIN });
    this.prerender.replaceChildren(h("div", { className: "ts-runner flex h-screen flex-col bg-white" }, frame));
    const view = { ...this.view };
    for (const card of this.cards.values()) {
      card.render(view);
      frame.replaceChildren(...card.nodes(null));
      void frame.offsetHeight;
    }
    frame.replaceChildren();
    this.prerender.replaceChildren();
  }

  private onQuestionShow(m: QuestionShowMessage): void {
    const t0 = now();
    const card = this.cards.get(m.qid);
    if (!card) {
      this.channel.sendError("question.show", `unknown question ${m.qid} (module ${this.moduleId ?? "none"})`);
      return;
    }
    const prev = this.current;
    if (prev && prev !== card) prev.saveScroll();
    if (prev !== card) {
      if (this.annotator.toolbarOpen) this.send({ t: "selection.clear" });
      this.annotator.dismiss();
      this.closeInlineToolbar();
      const sel = this.doc.defaultView?.getSelection?.();
      if (sel && !sel.isCollapsed) sel.removeAllRanges();
    }
    const p = this.pending.get(m.qid);
    p?.answer.clear();
    p?.eliminated.clear();
    p?.flagged.clear();
    card.state = {
      index: m.index,
      total: m.total,
      answer: m.answer ? m.answer : undefined,
      eliminated: [...m.eliminated],
      flagged: m.flagged,
      review: this.settings.mode === "review" ? (m.review ?? null) : null,
    };
    this.current = card;
    card.render(this.cardView());
    if (prev !== card || this.main.firstChild == null) {
      this.main.replaceChildren(...card.nodes(this.sprColumn.el));
      if (card.isSpr && !card.twoPane) this.sprColumn.render(this.sprExpanded);
    }
    this.annotator.load(m.qid, m.annotations);
    card.restoreScroll(m.scrollTop);
    void this.main.offsetHeight; // style + layout now, so `ms` covers the real swap
    this.send({ t: "question.shown", qid: m.qid, ms: round(now() - t0) });
  }

  private onStatePatch(m: StatePatchMessage): void {
    const card = this.cards.get(m.qid);
    if (!card) return; // a question of another module: nothing on screen to correct
    const p = this.pending.get(m.qid)!;
    let changed = false;
    if (m.answer !== undefined && p.answer.echo(m.answer)) {
      const next = m.answer === "" ? undefined : m.answer;
      if (card.state.answer !== next) {
        card.state = { ...card.state, answer: next };
        changed = true;
      }
    }
    if (m.eliminated !== undefined && p.eliminated.echo([...m.eliminated])) {
      card.state = { ...card.state, eliminated: [...m.eliminated] };
      changed = true;
    }
    if (m.flagged !== undefined && p.flagged.echo(m.flagged)) {
      if (card.state.flagged !== m.flagged) {
        card.state = { ...card.state, flagged: m.flagged };
        changed = true;
      }
    }
    if (changed && card === this.current) card.render(this.cardView());
  }

  private onViewSet(m: ViewSetMessage): void {
    const v = this.view;
    if (m.zoom !== undefined) v.zoom = m.zoom;
    if (m.split !== undefined) v.split = clamp(m.split, 0.1, 0.9);
    if (m.calcReservePx !== undefined) v.calcReservePx = Math.max(0, m.calcReservePx);
    if (m.eliminatorOn !== undefined && this.eliminatorPending.echo(m.eliminatorOn)) v.eliminatorOn = m.eliminatorOn;
    if (m.inputLocked !== undefined) {
      v.inputLocked = m.inputLocked;
      if (m.inputLocked) {
        const active = this.doc.activeElement;
        if (active && isTextField(active)) (active as HTMLElement).blur();
      }
    }
    if (m.highlighterOn !== undefined && m.highlighterOn !== v.highlighterOn) {
      v.highlighterOn = m.highlighterOn;
      if (!m.highlighterOn) {
        if (this.annotator.toolbarOpen) this.send({ t: "selection.clear" });
        this.annotator.dismiss();
        this.closeInlineToolbar();
      }
      this.applyMainClass();
    }
    this.renderCurrent();
  }

  private onAnnotApply(m: AnnotApplyMessage): void {
    const ids = [m.selectionId, m.annotId].filter((x): x is string => typeof x === "string");
    if (ids.length !== 1) {
      this.channel.sendError("annot.apply", "exactly one of selectionId / annotId is required");
      return;
    }
    this.applyAndReport(ids[0], m.op, { color: m.color, underline: m.underline });
  }

  private applyAndReport(id: string, op: AnnotOp, style: { color?: HighlightColor; underline?: AnnotApplyMessage["underline"] }): boolean {
    const out = this.annotator.apply(id, op, style);
    if ("error" in out) {
      this.channel.sendError("annot.apply", out.error);
      return false;
    }
    this.send({ t: "annot.changed", qid: out.qid, container: out.container, list: toWire(out.list) });
    return true;
  }

  // ── view ───────────────────────────────────────────────────────────────────

  private cardView(): CardView {
    return { ...this.view, inputLocked: this.view.inputLocked || this.settings.mode === "review" };
  }

  private renderCurrent(): void {
    this.current?.render(this.cardView());
  }

  private applyMainClass(): void {
    setClass(this.main, this.view.highlighterOn ? MAIN_ANNOTATING : MAIN);
  }

  /** The question on screen (tests, dev harness). */
  get currentCard(): QuestionCard | null {
    return this.current;
  }

  card(qid: number): QuestionCard | undefined {
    return this.cards.get(qid);
  }

  // ── student actions (optimistic, then reported) ───────────────────────────

  private canAct(): boolean {
    return !this.view.inputLocked && this.settings.mode !== "review";
  }

  private toggleFlag(qid: number): void {
    const card = this.cards.get(qid);
    if (!card || !this.canAct()) return;
    const flagged = !card.state.flagged;
    card.state = { ...card.state, flagged };
    this.pending.get(qid)?.flagged.push(flagged);
    if (card === this.current) card.render(this.cardView());
    this.send({ t: "flag.toggle", qid });
  }

  private toggleEliminator(): void {
    if (!this.canAct()) return;
    this.view.eliminatorOn = !this.view.eliminatorOn;
    this.eliminatorPending.push(this.view.eliminatorOn);
    this.renderCurrent();
    this.send({ t: "eliminator.toggle" });
  }

  private choose(qid: number, key: string): void {
    const card = this.cards.get(qid);
    if (!card || !this.canAct()) return;
    if (card.state.eliminated.includes(key)) return;
    if (card.state.answer === key) return;
    card.state = { ...card.state, answer: key };
    this.pending.get(qid)?.answer.push(key);
    if (card === this.current) card.render(this.cardView());
    this.send({ t: "answer.choose", qid, key });
  }

  private input(qid: number, value: string): void {
    const card = this.cards.get(qid);
    if (!card || !this.canAct()) return;
    card.state = { ...card.state, answer: value === "" ? undefined : value };
    this.pending.get(qid)?.answer.push(value);
    this.send({ t: "answer.input", qid, value });
  }

  private eliminate(qid: number, key: string): void {
    const card = this.cards.get(qid);
    if (!card || !this.canAct()) return;
    const on = !card.state.eliminated.includes(key);
    const eliminated = on ? [...card.state.eliminated, key] : card.state.eliminated.filter((k) => k !== key);
    // Eliminating the chosen option also deselects it (the website's toggleEliminate).
    const answer = on && card.state.answer === key ? undefined : card.state.answer;
    const p = this.pending.get(qid);
    p?.eliminated.push(eliminated);
    if (answer !== card.state.answer) p?.answer.push("");
    card.state = { ...card.state, eliminated, answer };
    if (card === this.current) card.render(this.cardView());
    this.send({ t: "answer.eliminate", qid, key, on });
  }

  // ── highlighter ────────────────────────────────────────────────────────────

  private onMouseUp(e: MouseEvent): void {
    if (this.dragging) return;
    if (!this.view.highlighterOn || this.view.inputLocked || !this.current) return;
    const out = this.annotator.onMouseUp(e);
    if (!out) return;
    const inline = this.settings.overlays === "inline";
    if (out.kind === "selection") {
      if (inline) {
        // The website's behaviour: the active colour lands on release, the toolbar opens.
        this.inlineTarget = out.selectionId;
        this.applyAndReport(out.selectionId, "highlight", { color: this.activeColor });
        this.toolbar.open({ x: out.rect.x + out.rect.w / 2, top: out.rect.y, bottom: out.rect.y + out.rect.h }, { color: this.activeColor });
        return;
      }
      this.send({ t: "selection", selectionId: out.selectionId, qid: out.qid, container: out.container, start: out.start, end: out.end, text: out.text, rect: out.rect });
      return;
    }
    if (out.kind === "annot.click") {
      if (inline) {
        this.inlineTarget = out.annotId;
        this.toolbar.open({ x: out.rect.x, top: out.rect.y, bottom: out.rect.y }, out.current);
        return;
      }
      this.send({ t: "annot.click", annotId: out.annotId, qid: out.qid, container: out.container, rect: out.rect, current: out.current });
      return;
    }
    // dismiss
    if (inline) this.closeInlineToolbar();
    else this.send({ t: "selection.clear" });
  }

  private inlineApply(op: AnnotOp, style: { color?: HighlightColor; underline?: AnnotApplyMessage["underline"] }): void {
    const id = this.inlineTarget;
    if (!id) return;
    if (op === "highlight" && style.color) this.activeColor = style.color;
    const ok = this.applyAndReport(id, op, style);
    if (!ok || op === "remove") {
      this.closeInlineToolbar();
      return;
    }
    const target = this.annotator.target(id);
    if (target) {
      const list = this.annotator.list(target.qid, target.container);
      const color = list.find((a) => a.kind === "highlight" && a.start <= target.range.start && a.end >= target.range.end)?.color;
      const underline = list.find((a) => a.kind === "underline" && a.start <= target.range.start && a.end >= target.range.end)?.underline;
      this.toolbar.setCurrent({ ...(color ? { color } : {}), ...(underline ? { underline } : {}) });
    }
  }

  private closeInlineToolbar(): void {
    this.inlineTarget = null;
    if (this.toolbar.isOpen) this.toolbar.close();
  }

  // ── keyboard, focus, split ────────────────────────────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    const key = forwardedKey(e);
    if (!key) return;
    e.preventDefault();
    if (key === "Escape") {
      this.doc.defaultView?.getSelection?.()?.removeAllRanges();
      if (this.settings.overlays === "inline") this.closeInlineToolbar();
      this.annotator.dismiss();
    }
    this.send({ t: "key", key });
  }

  private sendFocus(inIsland: boolean): void {
    if (this.focusSent === inIsland) return;
    this.focusSent = inIsland;
    this.send({ t: "focus", inIsland });
  }

  private startDrag(e: MouseEvent): void {
    e.preventDefault();
    if (!this.current?.twoPane) return;
    this.dragging = true;
    this.doc.body.style.cursor = "col-resize";
    this.doc.body.style.userSelect = "none";
  }

  private onDrag(e: MouseEvent): void {
    if (!this.dragging) return;
    const rect = this.main.getBoundingClientRect();
    if (rect.width <= 0) return;
    this.view.split = clamp((e.clientX - rect.left) / rect.width, SPLIT_MIN, SPLIT_MAX);
    this.renderCurrent();
  }

  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.doc.body.style.cursor = "";
    this.doc.body.style.userSelect = "";
    if (this.doc.body.getAttribute("style") === "") this.doc.body.removeAttribute("style");
    this.send({ t: "split.changed", split: round(this.view.split, 4) });
  }
}

export type { ContainerKey };
