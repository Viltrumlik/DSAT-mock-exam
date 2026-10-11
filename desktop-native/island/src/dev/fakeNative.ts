// A fake of the native side of the content-island protocol (architecture.md §2.7, §2.8), for
// the dev harness (dev.html) and the end-to-end tests. It behaves like ExamEngine + the
// runner would, minus storage and network:
//
//   ready            → init, media.put × n, module.load, question.show
//   answer.choose / answer.input / answer.eliminate / flag.toggle
//                    → accepted and echoed with state.patch (the authoritative echo)
//   eliminator.toggle→ view.set{eliminatorOn}
//   selection        → annot.apply with the active colour (what the website does on release),
//                    and the native toolbar opens (onToolbar)
//   annot.click      → the native toolbar opens on that mark
//   annot.changed    → stored per question and region, replayed by question.show
//   key              → ← / → navigate, a–d choose, m flags, Escape → focus.release
//   split.changed    → kept for the next init
//
// It never touches the DOM, so it runs the same in the browser and in jsdom.
import type {
  ContentToNative,
  IslandAnnotationSet,
  IslandAnnotationStyle,
  IslandQuestion,
  IslandRect,
  IslandReviewInfo,
  NativeToContent,
} from "../protocol";
import { PROTOCOL_VERSION, validateMessage } from "../protocol";

type Outgoing = NativeToContent extends infer M ? (M extends unknown ? Omit<M, "v"> : never) : never;

export interface DevModule {
  /** Where the questions came from, e.g. "pastpaper_open.response.resume.json#modules[0]". */
  source: string;
  label: string;
  kind: "pastpaper" | "midterm";
  subject: "rw" | "math";
  moduleId: number;
  questions: IslandQuestion[];
  /** Saved state, as the bundle's `answers` / `flagged` / `annotations` carry it. */
  answers: Record<number, string>;
  flagged: number[];
  annotations: Record<number, Partial<IslandAnnotationSet>>;
  /** Review info per question (mode:"review"). */
  review: Record<number, IslandReviewInfo>;
}

export interface DevMedia {
  key: string;
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
  b64: string;
}

export interface DevSettings {
  mode: "exam" | "review";
  overlays: "native" | "inline";
  zoom: number;
  split: number;
  highlighterOn: boolean;
  eliminatorOn: boolean;
  calcReservePx: number;
  inputLocked: boolean;
}

export interface ToolbarRequest {
  /** The selectionId or annotId the toolbar acts on. */
  target: { selectionId: string } | { annotId: string };
  rect: IslandRect;
  current: IslandAnnotationStyle;
}

export interface FakeNativeEvents {
  /** Every message in either direction (already validated), for a log. */
  onTraffic?(direction: "to_web" | "to_native", message: Record<string, unknown>, problem: string | null): void;
  onToolbar?(request: ToolbarRequest | null): void;
  onTiming?(kind: "module.loaded" | "question.shown", ms: number): void;
  onState?(): void;
}

const EMPTY: IslandAnnotationSet = { passage: [], question: [], choices: [] };
const CONTAINERS = ["passage", "question", "choices"] as const;

export class FakeNative {
  settings: DevSettings = { mode: "exam", overlays: "native", zoom: 1, split: 0.5, highlighterOn: false, eliminatorOn: false, calcReservePx: 0, inputLocked: false };
  module: DevModule | null = null;
  index = 0;
  readonly answers = new Map<number, string>();
  readonly eliminated = new Map<number, string[]>();
  readonly flagged = new Set<number>();
  readonly annotations = new Map<number, IslandAnnotationSet>();
  activeColor: "yellow" | "blue" | "pink" = "yellow";
  ready = false;
  readonly timings: Array<{ kind: string; ms: number }> = [];
  private toolbarTarget: ToolbarRequest["target"] | null = null;

  constructor(
    private readonly post: (message: Record<string, unknown>) => void,
    private readonly media: DevMedia[],
    private readonly events: FakeNativeEvents = {},
  ) {}

  get current(): IslandQuestion | null {
    return this.module?.questions[this.index] ?? null;
  }

  /** native → island, validated against the schema first. */
  send(message: Outgoing): void {
    const full = { v: PROTOCOL_VERSION, ...message } as Record<string, unknown>;
    const problem = validateMessage(full, { direction: "to_web", island: "content" });
    this.events.onTraffic?.("to_web", full, problem);
    if (problem) return;
    this.post(full);
  }

  /** island → native. Anything off-schema is logged and dropped, like the real host. */
  receive(raw: unknown): void {
    const message = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    const problem = validateMessage(message, { direction: "to_native", island: "content" });
    this.events.onTraffic?.("to_native", (message ?? {}) as Record<string, unknown>, problem);
    if (problem) return;
    this.handle(message as ContentToNative);
  }

  /** Load a module: seed its saved state, then (if the island is ready) send it. */
  load(module: DevModule, index = 0): void {
    this.module = module;
    this.index = Math.max(0, Math.min(index, module.questions.length - 1));
    this.answers.clear();
    this.eliminated.clear();
    this.flagged.clear();
    this.annotations.clear();
    for (const [qid, a] of Object.entries(module.answers)) this.answers.set(Number(qid), a);
    for (const qid of module.flagged) this.flagged.add(qid);
    for (const [qid, set] of Object.entries(module.annotations)) this.annotations.set(Number(qid), { ...EMPTY, ...set });
    if (this.ready) this.sendModule();
    this.events.onState?.();
  }

  private sendInit(): void {
    const m = this.module;
    if (!m) return;
    const s = this.settings;
    this.send({ t: "init", mode: s.mode, kind: m.kind, subject: m.subject, overlays: s.overlays, zoom: s.zoom, split: s.split, highlighterOn: s.highlighterOn, eliminatorOn: s.eliminatorOn, calcReservePx: s.calcReservePx });
    if (s.inputLocked) this.send({ t: "view.set", inputLocked: true });
  }

  /** init + every image + module.load + question.show — what native sends when a module opens. */
  sendModule(): void {
    const m = this.module;
    if (!m) return;
    this.sendInit();
    for (const media of this.media) this.send({ t: "media.put", key: media.key, mime: media.mime, b64: media.b64 });
    this.send({ t: "module.load", moduleId: m.moduleId, questions: m.questions });
    this.show(this.index);
  }

  show(index: number): void {
    const m = this.module;
    if (!m) return;
    this.index = Math.max(0, Math.min(index, m.questions.length - 1));
    const q = m.questions[this.index];
    this.closeToolbar();
    const review = this.settings.mode === "review" ? (m.review[q.id] ?? standInReview(q, this.answers.get(q.id) ?? null)) : undefined;
    this.send({
      t: "question.show",
      qid: q.id,
      index: this.index,
      total: m.questions.length,
      answer: this.answers.get(q.id) ?? null,
      eliminated: this.eliminated.get(q.id) ?? [],
      flagged: this.flagged.has(q.id),
      annotations: this.annotations.get(q.id) ?? EMPTY,
      ...(review ? { review } : {}),
    });
    this.events.onState?.();
  }

  next(): void {
    if (this.module && this.index < this.module.questions.length - 1) this.show(this.index + 1);
  }

  back(): void {
    if (this.index > 0) this.show(this.index - 1);
  }

  /** A view change from the harness's controls (Flutter's header buttons). */
  setView(patch: Partial<DevSettings>): void {
    const needsInit = (patch.mode !== undefined && patch.mode !== this.settings.mode) || (patch.overlays !== undefined && patch.overlays !== this.settings.overlays);
    this.settings = { ...this.settings, ...patch };
    if (needsInit) {
      this.sendModule();
      return;
    }
    const view: Record<string, unknown> = {};
    for (const k of ["zoom", "split", "highlighterOn", "eliminatorOn", "calcReservePx", "inputLocked"] as const) if (patch[k] !== undefined) view[k] = patch[k];
    if (Object.keys(view).length) this.send({ t: "view.set", ...view } as Outgoing);
    if (patch.highlighterOn === false) this.closeToolbar();
    this.events.onState?.();
  }

  /** The native toolbar's buttons. */
  toolbar(op: "highlight" | "underline" | "remove", style: IslandAnnotationStyle = {}): void {
    const target = this.toolbarTarget;
    if (!target) return;
    if (op === "highlight" && style.color) this.activeColor = style.color;
    this.send({ t: "annot.apply", ...target, op, ...style } as Outgoing);
    if (op === "remove") this.closeToolbar();
  }

  private closeToolbar(): void {
    if (this.toolbarTarget) {
      this.toolbarTarget = null;
      this.events.onToolbar?.(null);
    }
  }

  private accept(qid: number): boolean {
    const q = this.current;
    return !!q && q.id === qid && !this.settings.inputLocked && this.settings.mode === "exam";
  }

  private handle(m: ContentToNative): void {
    switch (m.t) {
      case "ready":
        this.ready = true;
        this.sendModule();
        return;
      case "module.loaded":
      case "question.shown":
        this.timings.push({ kind: m.t, ms: m.ms });
        this.events.onTiming?.(m.t, m.ms);
        return;
      case "answer.choose":
        if (!this.accept(m.qid)) return;
        if ((this.eliminated.get(m.qid) ?? []).includes(m.key)) return;
        this.answers.set(m.qid, m.key);
        this.send({ t: "state.patch", qid: m.qid, answer: m.key });
        break;
      case "answer.input":
        if (!this.accept(m.qid)) return;
        if (m.value === "") this.answers.delete(m.qid);
        else this.answers.set(m.qid, m.value);
        this.send({ t: "state.patch", qid: m.qid, answer: m.value });
        break;
      case "answer.eliminate": {
        if (!this.accept(m.qid)) return;
        const cur = this.eliminated.get(m.qid) ?? [];
        const next = m.on ? [...new Set([...cur, m.key])] : cur.filter((k) => k !== m.key);
        this.eliminated.set(m.qid, next);
        if (m.on && this.answers.get(m.qid) === m.key) {
          this.answers.delete(m.qid);
          this.send({ t: "state.patch", qid: m.qid, eliminated: next, answer: "" });
        } else {
          this.send({ t: "state.patch", qid: m.qid, eliminated: next });
        }
        break;
      }
      case "flag.toggle":
        if (!this.accept(m.qid)) return;
        if (this.flagged.has(m.qid)) this.flagged.delete(m.qid);
        else this.flagged.add(m.qid);
        this.send({ t: "state.patch", qid: m.qid, flagged: this.flagged.has(m.qid) });
        break;
      case "eliminator.toggle":
        this.settings.eliminatorOn = !this.settings.eliminatorOn;
        this.send({ t: "view.set", eliminatorOn: this.settings.eliminatorOn });
        break;
      case "selection":
        // The website lands the active colour on release; native does it by answering at once.
        this.toolbarTarget = { selectionId: m.selectionId };
        this.send({ t: "annot.apply", selectionId: m.selectionId, op: "highlight", color: this.activeColor });
        this.events.onToolbar?.({ target: this.toolbarTarget, rect: m.rect, current: { color: this.activeColor } });
        return;
      case "annot.click":
        this.toolbarTarget = { annotId: m.annotId };
        this.events.onToolbar?.({ target: this.toolbarTarget, rect: m.rect, current: m.current });
        return;
      case "selection.clear":
        this.closeToolbar();
        return;
      case "annot.changed":
        this.annotations.set(m.qid, { ...(this.annotations.get(m.qid) ?? EMPTY), [m.container]: m.list });
        break;
      case "key":
        this.onKey(m.key);
        return;
      case "split.changed":
        this.settings.split = m.split;
        break;
      case "selection.current":
      case "focus":
      case "error":
        return;
    }
    this.events.onState?.();
  }

  /** The runner's shortcut table (useKeyboardShortcuts.ts) as Flutter would apply it. */
  onKey(key: string): void {
    const q = this.current;
    if (key === "ArrowRight") return this.next();
    if (key === "ArrowLeft") return this.back();
    if (key === "Escape") {
      this.closeToolbar();
      this.send({ t: "focus.release" });
      return;
    }
    if (!q || this.settings.inputLocked || this.settings.mode !== "exam") return;
    if (key === "m") {
      this.handle({ v: 1, t: "flag.toggle", qid: q.id });
      return;
    }
    if (["a", "b", "c", "d"].includes(key) && !q.is_math_input) {
      const letter = key.toUpperCase();
      if (q.options && !(letter in q.options)) return;
      this.handle({ v: 1, t: "answer.choose", qid: q.id, key: letter });
    }
  }

  /** Every region's stored list for a question (for display). */
  annotationCount(qid: number): number {
    const set = this.annotations.get(qid);
    return set ? CONTAINERS.reduce((n, c) => n + set[c].length, 0) : 0;
  }
}

/** Review info when the fixtures carry none for a question: the student's answer, marked as given. */
function standInReview(q: IslandQuestion, answer: string | null): IslandReviewInfo {
  const keys = Object.keys(q.options ?? {});
  const correct = q.is_math_input ? (answer ?? "1") : (keys[0] ?? "A");
  return { correct, studentAnswer: answer, isCorrect: answer != null && answer === correct };
}
