// dev.html: the content island (and the Desmos island) in <iframe>s, driven by FakeNative over
// the "parent" transport, with controls standing in for Flutter's header and footer and a log
// of every message in both directions. Dev only — never part of build/island.
//
//   npm run dev   →   http://127.0.0.1:5317/dev.html
import "./harness.css";

import { FRAME_TO_NATIVE, FRAME_TO_WEB } from "../transport";
import { validateMessage } from "../protocol";
import { FakeNative, type DevMedia, type ToolbarRequest } from "./fakeNative";
import { DEV_FIXTURE_FILES, devModulesFrom, mediaKeysOf } from "./fixtures";

// ── fixtures (served by Vite from desktop-native/contracts; fs.allow in vite.config.ts) ────────
const jsonFiles = import.meta.glob<Record<string, unknown>>("../../../contracts/v1/*.json", { import: "default", eager: true });
const mediaFiles = import.meta.glob<string>("../../../contracts/v1/media/**/*", { query: "?inline", import: "default", eager: true });

const files: Record<string, Record<string, unknown>> = {};
for (const name of DEV_FIXTURE_FILES) {
  const entry = Object.entries(jsonFiles).find(([path]) => path.endsWith(`/${name}`));
  if (entry) files[name] = entry[1];
}
const modules = devModulesFrom(files);
const media: DevMedia[] = [];
for (const key of mediaKeysOf(modules)) {
  const entry = Object.entries(mediaFiles).find(([path]) => path.endsWith(`/media/${key}`));
  const m = entry?.[1].match(/^data:([^;]+);base64,(.*)$/);
  if (m) media.push({ key, mime: m[1] as DevMedia["mime"], b64: m[2] });
}

// ── elements ──────────────────────────────────────────────────────────────────────────────
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const contentFrame = $<HTMLIFrameElement>("content");
const desmosFrame = $<HTMLIFrameElement>("desmos");
const desmosPanel = $<HTMLElement>("desmos-panel");
const toolbarEl = $<HTMLDivElement>("toolbar");
const logEl = $<HTMLElement>("log");
const statusEl = $<HTMLElement>("status");
const bar = $<HTMLElement>("bar");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(node, rest);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
}

// ── log ───────────────────────────────────────────────────────────────────────────────────
function short(message: Record<string, unknown>): string {
  return JSON.stringify(message, (k, v) => {
    if (k === "b64" && typeof v === "string") return `<${v.length} chars>`;
    if (k === "questions" && Array.isArray(v)) return `<${v.length} questions>`;
    return v;
  });
}

function log(direction: string, message: Record<string, unknown>, problem: string | null): void {
  const arrow = direction === "to_web" ? "native → island" : direction === "to_native" ? "island → native" : direction;
  const row = el("div", { className: `${direction} ${problem ? "bad" : ""} ${message.t === "error" ? "error" : ""}` }, `${arrow}  ${short(message)}${problem ? `\n  ✗ ${problem}` : ""}`);
  logEl.prepend(row);
  while (logEl.childElementCount > 300) logEl.lastElementChild!.remove();
}

// ── the fake native ───────────────────────────────────────────────────────────────────────
const native = new FakeNative((m) => contentFrame.contentWindow?.postMessage({ type: FRAME_TO_WEB, msg: m }, "*"), media, {
  onTraffic: log,
  onToolbar: showToolbar,
  onTiming: () => renderStatus(),
  onState: () => {
    renderBar();
    renderStatus();
  },
});

window.addEventListener("message", (event) => {
  const data = event.data as { type?: unknown; msg?: unknown } | null;
  if (!data || data.type !== FRAME_TO_NATIVE) return;
  if (event.source === contentFrame.contentWindow) native.receive(data.msg);
  else if (event.source === desmosFrame.contentWindow) desmosReceive(data.msg);
});

// ── the native toolbar (Flutter's popup in the real app) ──────────────────────────────────
const SWATCHES = [
  ["yellow", "#ffd21a"],
  ["blue", "#bcdcf7"],
  ["pink", "#f7bcd6"],
] as const;
const LINES = ["solid", "dashed", "dotted"] as const;

function showToolbar(request: ToolbarRequest | null): void {
  if (!request) {
    toolbarEl.hidden = true;
    return;
  }
  toolbarEl.replaceChildren(
    ...SWATCHES.map(([color, bg]) => {
      const b = el("button", { className: `swatch ${request.current.color === color ? "on" : ""}`, ariaLabel: `${color} highlight` });
      b.style.background = bg;
      b.onclick = () => {
        native.toolbar("highlight", { color });
        request.current = { ...request.current, color };
        showToolbar(request);
      };
      return b;
    }),
    ...LINES.map((underline) => {
      const b = el("button", { className: request.current.underline === underline ? "on" : "", textContent: `${underline} u̲` });
      b.onclick = () => {
        native.toolbar("underline", { underline });
        request.current = { ...request.current, underline };
        showToolbar(request);
      };
      return b;
    }),
    (() => {
      const b = el("button", { textContent: "Delete" });
      b.onclick = () => native.toolbar("remove");
      return b;
    })(),
  );
  toolbarEl.hidden = false;
  // The island's rect is in its own CSS px; the frame sits at the stage's origin.
  const x = request.rect.x + request.rect.w / 2 - toolbarEl.offsetWidth / 2;
  const y = request.rect.y - toolbarEl.offsetHeight - 10;
  toolbarEl.style.left = `${Math.max(8, x)}px`;
  toolbarEl.style.top = `${y < 8 ? request.rect.y + request.rect.h + 10 : y}px`;
}

// ── the Desmos island ─────────────────────────────────────────────────────────────────────
let desmosMode: "graphing" | "scientific" = "graphing";
let desmosState: unknown = undefined;
let desmosReq = 0;
let desmosStatus = "closed";

function desmosSend(message: Record<string, unknown>): void {
  const full = { v: 1, ...message };
  const problem = validateMessage(full, { direction: "to_web", island: "desmos" });
  log("to_web", { ...full, island: "desmos" }, problem);
  if (!problem) desmosFrame.contentWindow?.postMessage({ type: FRAME_TO_WEB, msg: full }, "*");
}

function desmosReceive(raw: unknown): void {
  const problem = validateMessage(raw, { direction: "to_native", island: "desmos" });
  const m = (raw ?? {}) as Record<string, unknown>;
  log("to_native", { ...m, island: "desmos" }, problem);
  if (problem) return;
  if (m.t === "desmos.ready") desmosStatus = `ready (API ${String(m.apiVersion)})`;
  if (m.t === "desmos.failed") desmosStatus = `failed: ${String(m.reason)} — native would show its scientific calculator`;
  if (m.t === "desmos.changed") desmosSend({ t: "desmos.getState", req: ++desmosReq });
  if (m.t === "desmos.state") desmosState = m.state;
  renderDesmosHead();
}

function openDesmos(): void {
  desmosPanel.hidden = !desmosPanel.hidden;
  renderBar();
  if (desmosPanel.hidden) return;
  if (!desmosFrame.src) {
    desmosStatus = "loading";
    desmosFrame.addEventListener("load", () => setTimeout(() => desmosSend({ t: "desmos.init", mode: desmosMode, ...(desmosState !== undefined ? { state: desmosState } : {}) }), 0), { once: true });
    desmosFrame.src = "./desmos.html";
  }
  renderDesmosHead();
}

function renderDesmosHead(): void {
  const head = $<HTMLElement>("desmos-head");
  const tab = (mode: "graphing" | "scientific", label: string) => {
    const b = el("button", { textContent: label });
    b.setAttribute("aria-pressed", String(desmosMode === mode));
    b.onclick = () => {
      desmosMode = mode;
      desmosSend({ t: "desmos.mode", mode });
      renderDesmosHead();
    };
    return b;
  };
  const save = el("button", { textContent: "Get state" });
  save.onclick = () => desmosSend({ t: "desmos.getState", req: ++desmosReq });
  const close = el("button", { textContent: "Close" });
  close.onclick = () => openDesmos();
  head.replaceChildren(tab("graphing", "Graphing"), tab("scientific", "Scientific"), el("span", { className: "grow", textContent: desmosStatus }), save, close);
}

// ── controls (Flutter's header and footer in the real app) ────────────────────────────────
let currentModule = 0;

function toggle(label: string, on: boolean, click: () => void): HTMLButtonElement {
  const b = el("button", { textContent: label });
  b.setAttribute("aria-pressed", String(on));
  b.onclick = click;
  return b;
}

function renderBar(): void {
  const s = native.settings;
  const moduleButtons = modules.map((m, i) => {
    const what = m.source.startsWith("pastpaper_result") ? "Result" : m.kind === "midterm" ? `Midterm ${m.subject === "rw" ? "R&W" : "Math"}` : m.subject === "rw" ? "R&W" : "Math";
    const b = toggle(`${what} ${m.moduleId}`, i === currentModule, () => {
      currentModule = i;
      native.load(modules[i]);
    });
    b.title = m.source;
    return b;
  });
  bar.replaceChildren(
    el("span", { className: "group" }, el("span", { className: "label", textContent: "Module" }), ...moduleButtons),
    el(
      "span",
      { className: "group" },
      toggle("Review", s.mode === "review", () => native.setView({ mode: s.mode === "review" ? "exam" : "review" })),
      toggle("Inline toolbar", s.overlays === "inline", () => native.setView({ overlays: s.overlays === "inline" ? "native" : "inline" })),
      toggle("Highlights", s.highlighterOn, () => native.setView({ highlighterOn: !s.highlighterOn })),
      toggle("ABC", s.eliminatorOn, () => native.setView({ eliminatorOn: !s.eliminatorOn })),
      toggle("Calc reserve", s.calcReservePx > 0, () => native.setView({ calcReservePx: s.calcReservePx > 0 ? 0 : 500 })),
      toggle("Lock input", s.inputLocked, () => native.setView({ inputLocked: !s.inputLocked })),
    ),
    el(
      "span",
      { className: "group" },
      el("span", { className: "label", textContent: `Zoom ${s.zoom.toFixed(1)}` }),
      toggle("−", false, () => native.setView({ zoom: Math.max(0.8, Math.round((s.zoom - 0.1) * 10) / 10) })),
      toggle("+", false, () => native.setView({ zoom: Math.min(1.6, Math.round((s.zoom + 0.1) * 10) / 10) })),
    ),
    el("span", { className: "group" }, toggle("Back", false, () => native.back()), toggle("Next", false, () => native.next()), toggle("Calculator", !desmosPanel.hidden, () => openDesmos())),
  );
}

function renderStatus(): void {
  const m = native.module;
  const q = native.current;
  const loaded = native.timings.filter((t) => t.kind === "module.loaded").at(-1);
  const shown = native.timings.filter((t) => t.kind === "question.shown").at(-1);
  const answered = m ? m.questions.filter((x) => native.answers.has(x.id)).length : 0;
  statusEl.replaceChildren(
    el("span", {}, el("strong", { textContent: q ? `Question ${native.index + 1} of ${m!.questions.length}` : "No module" })),
    el("span", { textContent: q ? `qid ${q.id} · answer ${native.answers.get(q.id) ?? "—"} · ${native.flagged.has(q.id) ? "flagged" : "not flagged"} · ${native.annotationCount(q.id)} marks` : "" }),
    el("span", { textContent: `${answered} answered` }),
    el("span", { textContent: `module.load ${loaded ? `${loaded.ms} ms` : "—"} · question.show ${shown ? `${shown.ms} ms` : "—"}` }),
  );
}

// Keys pressed while the harness (not an island) has focus: Flutter's shortcuts.
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "ArrowRight") native.next();
  if (e.key === "ArrowLeft") native.back();
});

native.load(modules[0]);
renderBar();
renderStatus();
// Load the island only now that the listener above is attached, so its `ready` is never missed.
contentFrame.src = "./content.html";
(window as Window & { __harness?: unknown }).__harness = { native, modules, media };
