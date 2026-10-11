// The Desmos island (architecture.md §2.4, §2.7): loads Desmos API v1.11 once, Graphing and
// Scientific, restores and reports state, reports changes debounced, and fails fast and
// clearly (offline / script / 6 s timeout) so native can fall back to its own calculator.
import { afterEach, describe, expect, it, vi } from "vitest";

import { PROTOCOL_VERSION, validateMessage } from "../src/protocol";
import {
  CHANGE_DEBOUNCE_MS,
  DESMOS_API_VERSION,
  DesmosIsland,
  desmosScriptUrl,
  GRAPHING_OPTIONS,
  LOAD_TIMEOUT_MS,
  parseSavedState,
  scriptLoader,
  type DesmosFactory,
} from "../src/desmos/island";
import { memoryTransport, type MemoryTransport } from "../src/transport";

interface FakeInstance {
  mode: "graphing" | "scientific";
  el: HTMLElement;
  options: Record<string, unknown> | undefined;
  state: unknown;
  destroy: ReturnType<typeof vi.fn<() => void>>;
  resize: ReturnType<typeof vi.fn<() => void>>;
  setState: ReturnType<typeof vi.fn<(s: unknown, opts?: Record<string, unknown>) => void>>;
  getState(): unknown;
  observeEvent(ev: string, cb: () => void): void;
  change(): void;
}

function fakeDesmos() {
  const created: FakeInstance[] = [];
  const make = (mode: "graphing" | "scientific") => (el: HTMLElement, options?: Record<string, unknown>) => {
    const observers = new Map<string, () => void>();
    const inst: FakeInstance = {
      mode,
      el,
      options,
      state: { version: 11, mode, expressions: { list: [] } },
      destroy: vi.fn<() => void>(),
      resize: vi.fn<() => void>(),
      setState: vi.fn<(s: unknown, opts?: Record<string, unknown>) => void>((s) => {
        inst.state = s;
      }),
      getState: () => inst.state,
      observeEvent: (ev, cb) => observers.set(ev, cb),
      change: () => observers.get("change")?.(),
    };
    created.push(inst);
    return inst;
  };
  const factory: DesmosFactory = { GraphingCalculator: make("graphing"), ScientificCalculator: make("scientific") };
  return { factory, created };
}

let island: DesmosIsland | null = null;
let t: MemoryTransport;
afterEach(() => {
  island?.stop();
  island = null;
  vi.useRealTimers();
  document.body.replaceChildren();
});

function start(opts: ConstructorParameters<typeof DesmosIsland>[1] = {}) {
  t = memoryTransport();
  island = new DesmosIsland(t, opts);
  island.start();
  return island;
}
const deliver = (m: Record<string, unknown>) => t.deliver({ v: PROTOCOL_VERSION, ...m });
const sent = () => t.sent as Array<Record<string, unknown>>;
const last = (type: string) => sent().filter((m) => m.t === type).at(-1);
const flush = () => new Promise((r) => setTimeout(r, 0));

function assertValid() {
  for (const m of sent()) expect(validateMessage(m, { direction: "to_native", island: "desmos" }), String(m.t)).toBeNull();
}

describe("loading", () => {
  it("desmos.init → Graphing calculator with the website's options → desmos.ready{apiVersion:'1.11'}", async () => {
    const d = fakeDesmos();
    const loader = vi.fn(async () => d.factory);
    start({ loader, online: () => true });
    deliver({ t: "desmos.init", mode: "graphing" });
    await flush();
    expect(last("desmos.ready")).toEqual({ v: 1, t: "desmos.ready", apiVersion: DESMOS_API_VERSION });
    expect(DESMOS_API_VERSION).toBe("1.11");
    expect(d.created.map((c) => c.mode)).toEqual(["graphing"]);
    expect(d.created[0].options).toEqual(GRAPHING_OPTIONS);
    expect(d.created[0].el.dataset.desmos).toBe("graphing");
    expect(island!.status).toBe("ready");
    expect(loader).toHaveBeenCalledTimes(1);
    assertValid();
  });

  it("offline → desmos.failed{offline} without touching the network", async () => {
    const loader = vi.fn();
    start({ loader, online: () => false });
    deliver({ t: "desmos.init", mode: "graphing" });
    await flush();
    expect(sent().filter((m) => String(m.t).startsWith("desmos."))).toEqual([{ v: 1, t: "desmos.failed", reason: "offline" }]);
    expect(loader).not.toHaveBeenCalled();
  });

  it("a script that loads without Desmos → desmos.failed{script}; lost connection mid-load → offline", async () => {
    start({ loader: async () => null, online: () => true });
    deliver({ t: "desmos.init", mode: "graphing" });
    await flush();
    expect(last("desmos.failed")).toMatchObject({ reason: "script" });
    island!.stop();

    let online = true;
    start({
      loader: async () => {
        online = false;
        return null;
      },
      online: () => online,
    });
    deliver({ t: "desmos.init", mode: "graphing" });
    await flush();
    expect(last("desmos.failed")).toMatchObject({ reason: "offline" });
  });

  it("no answer within 6 s → desmos.failed{timeout}", async () => {
    vi.useFakeTimers();
    start({ loader: () => new Promise(() => {}), online: () => true });
    deliver({ t: "desmos.init", mode: "graphing" });
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    expect(last("desmos.failed")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(last("desmos.failed")).toMatchObject({ reason: "timeout" });
    expect(LOAD_TIMEOUT_MS).toBe(6000);
  });

  it("a calculator that throws on creation is reported and counts as a script failure", async () => {
    start({
      loader: async () => ({
        GraphingCalculator: () => {
          throw new Error("WebGL unavailable");
        },
      }),
      online: () => true,
    });
    deliver({ t: "desmos.init", mode: "graphing" });
    await flush();
    expect(last("error")).toMatchObject({ where: "desmos.create" });
    expect(last("desmos.failed")).toMatchObject({ reason: "script" });
  });

  it("after a failure, the next desmos.init tries again", async () => {
    const d = fakeDesmos();
    let online = false;
    start({ loader: async () => d.factory, online: () => online });
    deliver({ t: "desmos.init", mode: "graphing" });
    await flush();
    expect(last("desmos.failed")).toMatchObject({ reason: "offline" });
    online = true;
    deliver({ t: "desmos.init", mode: "graphing" });
    await flush();
    expect(last("desmos.ready")).toBeDefined();
  });
});

describe("modes and state", () => {
  it("Scientific is created on first use; both calculators stay alive across switches", async () => {
    const d = fakeDesmos();
    start({ loader: async () => d.factory, online: () => true });
    deliver({ t: "desmos.init", mode: "graphing" });
    await flush();
    deliver({ t: "desmos.mode", mode: "scientific" });
    await flush();
    expect(d.created.map((c) => c.mode)).toEqual(["graphing", "scientific"]);
    const [g, s] = d.created;
    expect(g.el.style.display).toBe("none");
    expect(s.el.style.display).toBe("");
    deliver({ t: "desmos.mode", mode: "graphing" });
    await flush();
    expect(d.created).toHaveLength(2);
    expect(g.destroy).not.toHaveBeenCalled();
    expect(g.el.style.display).toBe("");
    expect(s.el.style.display).toBe("none");
  });

  it("a mode chosen before the script arrives is the one shown when it does", async () => {
    const d = fakeDesmos();
    let release: (f: DesmosFactory) => void = () => {};
    start({ loader: () => new Promise<DesmosFactory>((r) => (release = r)), online: () => true });
    deliver({ t: "desmos.init", mode: "graphing" });
    deliver({ t: "desmos.mode", mode: "scientific" });
    release(d.factory);
    await flush();
    expect(d.created.map((c) => c.mode)).toEqual(["scientific"]);
    expect(island!.mode).toBe("scientific");
  });

  it("restores a saved state into each calculator and reports both through desmos.getState", async () => {
    const d = fakeDesmos();
    start({ loader: async () => d.factory, online: () => true });
    const G = { version: 11, graph: { viewport: { xmin: -5, xmax: 5 } }, expressions: { list: [{ id: "1", latex: "y=x^2" }] } };
    const S = { version: 11, expressions: { list: [{ id: "a", latex: "2+2" }] } };
    deliver({ t: "desmos.init", mode: "graphing", state: { v: 1, mode: "scientific", graphing: G, scientific: S } });
    await flush();
    expect(d.created[0].setState).toHaveBeenCalledWith(G, { allowUndo: false });
    deliver({ t: "desmos.getState", req: 3 });
    expect(last("desmos.state")).toEqual({ v: 1, t: "desmos.state", req: 3, state: { v: 1, mode: "graphing", graphing: G, scientific: S } });
    deliver({ t: "desmos.mode", mode: "scientific" });
    await flush();
    expect(d.created[1].setState).toHaveBeenCalledWith(S, { allowUndo: false });
    assertValid();
  });

  it("takes a bare Desmos state (the website's single-calculator shape) as the graphing one", () => {
    const raw = { version: 11, expressions: { list: [] } };
    expect(parseSavedState(raw)).toEqual({ graphing: raw, scientific: null });
    expect(parseSavedState(null)).toEqual({ graphing: null, scientific: null });
    expect(parseSavedState([1, 2])).toEqual({ graphing: null, scientific: null });
  });

  it("desmos.getState before anything loaded answers with what was restored", () => {
    start({ loader: () => new Promise(() => {}), online: () => true });
    deliver({ t: "desmos.init", mode: "graphing", state: { v: 1, mode: "graphing", graphing: { a: 1 }, scientific: null } });
    deliver({ t: "desmos.getState", req: 9 });
    expect(last("desmos.state")).toEqual({ v: 1, t: "desmos.state", req: 9, state: { v: 1, mode: "graphing", graphing: { a: 1 }, scientific: null } });
  });

  it("reports changes once, 2 s after the last one", async () => {
    vi.useFakeTimers();
    const d = fakeDesmos();
    start({ loader: async () => d.factory, online: () => true });
    deliver({ t: "desmos.init", mode: "graphing" });
    await vi.advanceTimersByTimeAsync(0);
    d.created[0].change();
    await vi.advanceTimersByTimeAsync(1500);
    d.created[0].change();
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS - 1);
    expect(sent().filter((m) => m.t === "desmos.changed")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent().filter((m) => m.t === "desmos.changed")).toEqual([{ v: 1, t: "desmos.changed" }]);
    expect(CHANGE_DEBOUNCE_MS).toBe(2000);
  });
});

describe("keys, focus, validation", () => {
  it("only Escape goes back to native", async () => {
    start({ loader: async () => fakeDesmos().factory, online: () => true });
    t.clear();
    for (const key of ["a", "ArrowLeft", "Enter", "Escape"]) document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", ctrlKey: true, bubbles: true }));
    expect(sent()).toEqual([{ v: 1, t: "key", key: "Escape" }]);
  });

  it("reports focus and gives it back on focus.release", () => {
    start({ loader: async () => fakeDesmos().factory, online: () => true });
    t.clear();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("blur"));
    expect(sent()).toEqual([
      { v: 1, t: "focus", inIsland: true },
      { v: 1, t: "focus", inIsland: false },
    ]);
    const input = document.createElement("input");
    island!.root.appendChild(input);
    input.focus();
    deliver({ t: "focus.release" });
    expect(document.activeElement).toBe(document.body);
  });

  it("refuses content-island messages and blocks the context menu", () => {
    start({ loader: async () => fakeDesmos().factory, online: () => true });
    t.clear();
    deliver({ t: "question.show", qid: 1, index: 0, total: 1, answer: null, eliminated: [], flagged: false, annotations: { passage: [], question: [], choices: [] } });
    expect(sent()).toEqual([expect.objectContaining({ t: "error", where: "protocol.in" })]);
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    island!.root.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

describe("scriptLoader (loadDesmos.ts, framework-free)", () => {
  it("injects one <script> for API v1.11 with the key, and resolves to window.Desmos", async () => {
    const load = scriptLoader(document, "key with spaces&more");
    const p1 = load();
    const p2 = load();
    expect(p1).toBe(p2);
    const scripts = [...document.head.querySelectorAll("script")].filter((s) => s.src.includes("desmos.com"));
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe("https://www.desmos.com/api/v1.11/calculator.js?apiKey=key%20with%20spaces%26more");
    expect(desmosScriptUrl("k")).toBe("https://www.desmos.com/api/v1.11/calculator.js?apiKey=k");
    const factory = fakeDesmos().factory;
    (window as unknown as { Desmos?: DesmosFactory }).Desmos = factory;
    scripts[0].dispatchEvent(new Event("load"));
    await expect(p1).resolves.toBe(factory);
    // Already loaded: no second script.
    await expect(load()).resolves.toBe(factory);
    delete (window as unknown as { Desmos?: DesmosFactory }).Desmos;
    scripts[0].remove();
  });

  it("resolves null when the script fails, and the next call really retries", async () => {
    const load = scriptLoader(document, "k");
    const desmosScripts = () => [...document.head.querySelectorAll("script")].filter((s) => s.src.includes("desmos.com"));
    const p = load();
    desmosScripts()[0].dispatchEvent(new Event("error"));
    await expect(p).resolves.toBeNull();
    expect(desmosScripts()).toHaveLength(0);
    const again = load();
    expect(again).not.toBe(p);
    expect(desmosScripts()).toHaveLength(1);
    desmosScripts()[0].remove();
  });
});
