// The Desmos island (architecture.md §2.4, §2.7): the real Desmos calculator the website
// uses — API v1.11, Graphing and Scientific from the same calculator.js — inside the frame
// Flutter draws (title bar, tabs, drag, enlarge). Ported from the website's
// tools/calculator/loadDesmos.ts (script URL, key, single-flight load, null on failure) and
// DesmosCalculator.tsx (the instance options and the loading overlay).
//
//   native → island   desmos.init{mode, state?} · desmos.mode{mode} · desmos.getState{req} ·
//                     focus.release
//   island → native   desmos.ready{apiVersion} · desmos.failed{reason} · desmos.changed ·
//                     desmos.state{req, state} · key{Escape} · focus{inIsland} · error
//
// Differences from the website, on purpose:
//   * the Desmos key comes from the build (vite.config.ts → __DESMOS_API_KEY__), the same
//     variable the website reads; the protocol's desmos.init carries no key;
//   * switching tabs keeps both calculators alive (the website re-mounts and loses the graph);
//     the saved state holds both;
//   * failure is reported, not drawn: offline / script error / 6 s timeout → desmos.failed,
//     and native shows its scientific calculator (the website swaps in ScientificCalculator);
//   * changes are reported debounced (2 s) so native can save the state per attempt.
import { IslandChannel, type Outgoing } from "../channel";
import type { DesmosInitMessage, DesmosToNative, NativeToDesmos } from "../protocol";
import { h } from "../ported/dom";
import { installHardening } from "../content/hardening";
import type { IslandTransport } from "../transport";

export type DesmosMode = DesmosInitMessage["mode"];
export type FailReason = "offline" | "script" | "timeout";

export interface DesmosCalculatorInstance {
  destroy(): void;
  resize(): void;
  getState?(): unknown;
  setState?(state: unknown, opts?: Record<string, unknown>): void;
  observeEvent?(event: string, cb: () => void): void;
  unobserveEvent?(event: string): void;
  focusFirstExpression?(): void;
}

export interface DesmosFactory {
  GraphingCalculator(el: HTMLElement, options?: Record<string, unknown>): DesmosCalculatorInstance;
  ScientificCalculator?(el: HTMLElement, options?: Record<string, unknown>): DesmosCalculatorInstance;
}

/** The API version the website loads (loadDesmos.ts). */
export const DESMOS_API_VERSION = "1.11";
/** desmos.failed{timeout} after this long (architecture.md §2.7). */
export const LOAD_TIMEOUT_MS = 6000;
/** desmos.changed debounce (architecture.md §2.7). */
export const CHANGE_DEBOUNCE_MS = 2000;

/** DesmosCalculator.tsx's instance options. */
export const GRAPHING_OPTIONS = { expressions: true, settingsMenu: false, zoomButtons: true, border: false } as const;
export const SCIENTIFIC_OPTIONS = {} as const;

export function desmosScriptUrl(key: string): string {
  return `https://www.desmos.com/api/v${DESMOS_API_VERSION}/calculator.js?apiKey=${encodeURIComponent(key)}`;
}

/** loadDesmos.ts, framework-free: inject the script once; the global factory or null. */
export function scriptLoader(doc: Document, key: string): () => Promise<DesmosFactory | null> {
  let pending: Promise<DesmosFactory | null> | null = null;
  const g = () => (doc.defaultView as unknown as { Desmos?: DesmosFactory } | null)?.Desmos ?? null;
  return () => {
    if (g()) return Promise.resolve(g());
    if (pending) return pending;
    pending = new Promise((resolve) => {
      const script = doc.createElement("script");
      script.src = desmosScriptUrl(key);
      script.async = true;
      script.onload = () => resolve(g());
      script.onerror = () => resolve(null);
      doc.head.appendChild(script);
    });
    return pending;
  };
}

/** The saved state: both calculators (a raw Desmos state is taken as the graphing one). */
export interface SavedState {
  v: 1;
  mode: DesmosMode;
  graphing: unknown;
  scientific: unknown;
}

export function parseSavedState(state: unknown): { graphing: unknown; scientific: unknown } {
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const s = state as Record<string, unknown>;
    if (s.v === 1 && ("graphing" in s || "scientific" in s)) {
      return { graphing: s.graphing ?? null, scientific: s.scientific ?? null };
    }
    return { graphing: state, scientific: null };
  }
  return { graphing: null, scientific: null };
}

export interface DesmosIslandOptions {
  doc?: Document;
  mount?: HTMLElement;
  loader?: () => Promise<DesmosFactory | null>;
  online?: () => boolean;
  timeoutMs?: number;
  debounceMs?: number;
  apiKey?: string;
}

type Status = "idle" | "loading" | "ready" | "failed";

export class DesmosIsland {
  readonly channel: IslandChannel<"desmos">;
  readonly root: HTMLDivElement;
  private readonly doc: Document;
  private readonly mounts: Record<DesmosMode, HTMLDivElement>;
  private readonly overlay: HTMLDivElement;
  private readonly instances: Partial<Record<DesmosMode, DesmosCalculatorInstance>> = {};
  private saved: { graphing: unknown; scientific: unknown } = { graphing: null, scientific: null };
  private factory: DesmosFactory | null = null;
  private loading: Promise<void> | null = null;
  status: Status = "idle";
  mode: DesmosMode = "graphing";
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private focusSent: boolean | null = null;
  private uninstall: Array<() => void> = [];

  constructor(
    transport: IslandTransport,
    private readonly opts: DesmosIslandOptions = {},
  ) {
    this.doc = opts.doc ?? document;
    this.channel = new IslandChannel(transport, "desmos", (m) => this.handle(m));
    this.mounts = {
      graphing: h("div", { className: "h-full w-full", attrs: { "data-desmos": "graphing" } }),
      scientific: h("div", { className: "h-full w-full", attrs: { "data-desmos": "scientific" }, style: { display: "none" } }),
    };
    // DesmosCalculator.tsx's loading overlay.
    this.overlay = h(
      "div",
      { className: "absolute inset-0 flex items-center justify-center bg-white/70" },
      h("div", { className: "h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" }),
    );
    this.overlay.hidden = true;
    this.root = h("div", { className: "relative h-full w-full", attrs: { "data-island": "desmos" } }, this.mounts.graphing, this.mounts.scientific, this.overlay);
  }

  start(): void {
    const mount = this.opts.mount ?? this.doc.body;
    mount.replaceChildren(this.root);
    this.uninstall.push(installHardening(this.doc, { blockCopy: () => false, restrictSelection: false, scrub: false }));
    const win = this.doc.defaultView ?? window;
    const onKey = (e: KeyboardEvent) => {
      // Shortcuts are off while Desmos has focus; only Escape goes back to native.
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey) this.send({ t: "key", key: "Escape" });
    };
    this.doc.addEventListener("keydown", onKey);
    this.uninstall.push(() => this.doc.removeEventListener("keydown", onKey));
    const onFocus = () => this.sendFocus(true);
    const onBlur = () => this.sendFocus(false);
    const onResize = () => this.instances[this.mode]?.resize();
    win.addEventListener("focus", onFocus);
    win.addEventListener("blur", onBlur);
    win.addEventListener("resize", onResize);
    this.uninstall.push(() => {
      win.removeEventListener("focus", onFocus);
      win.removeEventListener("blur", onBlur);
      win.removeEventListener("resize", onResize);
    });
    this.channel.start();
  }

  stop(): void {
    this.channel.stop();
    if (this.changeTimer) clearTimeout(this.changeTimer);
    for (const off of this.uninstall.reverse()) off();
    this.uninstall = [];
    for (const inst of Object.values(this.instances)) inst?.destroy();
  }

  private send(m: Outgoing<DesmosToNative>): boolean {
    return this.channel.send(m);
  }

  private sendFocus(inIsland: boolean): void {
    if (this.focusSent === inIsland) return;
    this.focusSent = inIsland;
    this.send({ t: "focus", inIsland });
  }

  handle(m: NativeToDesmos): void {
    switch (m.t) {
      case "desmos.init":
        if (m.state !== undefined) this.saved = parseSavedState(m.state);
        void this.init(m.mode);
        return;
      case "desmos.mode":
        void this.setMode(m.mode);
        return;
      case "desmos.getState":
        this.send({ t: "desmos.state", req: m.req, state: this.getState() });
        return;
      case "focus.release": {
        const active = this.doc.activeElement as HTMLElement | null;
        if (active && active !== this.doc.body && typeof active.blur === "function") active.blur();
        return;
      }
    }
  }

  /** Load the API (once) and show `mode`. Re-init re-applies the saved state. */
  async init(mode: DesmosMode): Promise<void> {
    this.mode = mode;
    if (this.status === "ready") {
      for (const m of ["graphing", "scientific"] as const) this.applySaved(m);
      await this.setMode(mode);
      return;
    }
    if (this.status === "failed") this.status = "idle";
    if (!this.loading) this.loading = this.load();
    await this.loading;
  }

  private async load(): Promise<void> {
    const online = this.opts.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
    if (!online()) {
      this.fail("offline");
      return;
    }
    this.status = "loading";
    this.overlay.hidden = false;
    const loader = this.opts.loader ?? scriptLoader(this.doc, this.opts.apiKey ?? (typeof __DESMOS_API_KEY__ === "string" ? __DESMOS_API_KEY__ : ""));
    const timeoutMs = this.opts.timeoutMs ?? LOAD_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    let result: DesmosFactory | null | "timeout";
    try {
      result = await Promise.race([loader(), timeout]);
    } catch {
      result = null;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (result === "timeout") {
      this.fail("timeout");
      return;
    }
    if (!result || typeof result.GraphingCalculator !== "function") {
      this.fail(online() ? "script" : "offline");
      return;
    }
    this.factory = result;
    try {
      this.ensure(this.mode);
    } catch (err) {
      this.channel.reportError("desmos.create", err);
      this.fail("script");
      return;
    }
    this.status = "ready";
    this.overlay.hidden = true;
    this.show(this.mode);
    this.send({ t: "desmos.ready", apiVersion: DESMOS_API_VERSION });
  }

  private fail(reason: FailReason): void {
    this.status = "failed";
    this.loading = null;
    this.overlay.hidden = true;
    this.send({ t: "desmos.failed", reason });
  }

  /** Create `mode`'s calculator if it does not exist yet. */
  private ensure(mode: DesmosMode): DesmosCalculatorInstance {
    const existing = this.instances[mode];
    if (existing) return existing;
    const f = this.factory;
    if (!f) throw new Error("Desmos is not loaded");
    const create = mode === "scientific" ? f.ScientificCalculator : f.GraphingCalculator;
    if (typeof create !== "function") throw new Error(`Desmos ${mode} calculator is unavailable`);
    const inst = mode === "scientific" ? create.call(f, this.mounts.scientific, { ...SCIENTIFIC_OPTIONS }) : create.call(f, this.mounts.graphing, { ...GRAPHING_OPTIONS });
    this.instances[mode] = inst;
    this.applySaved(mode);
    if (typeof inst.observeEvent === "function") inst.observeEvent("change", () => this.changed());
    return inst;
  }

  private applySaved(mode: DesmosMode): void {
    const inst = this.instances[mode];
    const state = this.saved[mode];
    if (!inst || state == null || typeof inst.setState !== "function") return;
    try {
      inst.setState(state, { allowUndo: false });
    } catch (err) {
      this.channel.reportError(`desmos.setState.${mode}`, err);
    }
  }

  private show(mode: DesmosMode): void {
    this.mounts.graphing.style.display = mode === "graphing" ? "" : "none";
    this.mounts.scientific.style.display = mode === "scientific" ? "" : "none";
    for (const el of Object.values(this.mounts)) if (el.getAttribute("style") === "") el.removeAttribute("style");
    this.instances[mode]?.resize();
  }

  async setMode(mode: DesmosMode): Promise<void> {
    this.mode = mode;
    if (this.status !== "ready") return; // applied when the load finishes
    try {
      this.ensure(mode);
    } catch (err) {
      this.channel.reportError("desmos.mode", err);
      return;
    }
    this.show(mode);
  }

  private changed(): void {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.send({ t: "desmos.changed" });
    }, this.opts.debounceMs ?? CHANGE_DEBOUNCE_MS);
  }

  /** Both calculators' states (live where created, else what was restored). */
  getState(): SavedState {
    const read = (mode: DesmosMode) => {
      const inst = this.instances[mode];
      if (inst && typeof inst.getState === "function") {
        try {
          return inst.getState() ?? null;
        } catch (err) {
          this.channel.reportError(`desmos.getState.${mode}`, err);
        }
      }
      return this.saved[mode] ?? null;
    };
    return { v: 1, mode: this.mode, graphing: read("graphing"), scientific: read("scientific") };
  }
}
