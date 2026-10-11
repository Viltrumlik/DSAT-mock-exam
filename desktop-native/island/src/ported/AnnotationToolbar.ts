// Port of frontend/src/features/testing-simulation/tools/highlight/AnnotationToolbar.tsx.
// The Bluebook annotation popover — swatches · underline styles · delete — used inside the
// island only with `init.overlays:"inline"` (the windowed WebView2 fallback, where Flutter
// cannot draw over the island; architecture.md §2.6). With `overlays:"native"` Flutter draws
// this toolbar itself.
//
// Class strings and placement are the website's. Island changes: no `title` tooltips, no
// `hover:scale-110` on the swatches (no hover-lift), and no note button (the notes pad is
// native; the windowed fallback docks it beside the card instead).
import type { IslandAnnotationStyle } from "../protocol";
import type { HighlightColor, UnderlineStyle } from "../website";
import { h, setStyle } from "./dom";
import { icon } from "./icons";

export const SWATCHES: Array<{ color: HighlightColor; bg: string; label: string }> = [
  { color: "yellow", bg: "#ffd21a", label: "Yellow highlight" },
  { color: "blue", bg: "#bcdcf7", label: "Blue highlight" },
  { color: "pink", bg: "#f7bcd6", label: "Pink highlight" },
];

export const LINES: Array<{ style: UnderlineStyle; css: string; label: string }> = [
  { style: "solid", css: "border-solid", label: "Solid underline" },
  { style: "dashed", css: "border-dashed", label: "Dashed underline" },
  { style: "dotted", css: "border-dotted", label: "Dotted underline" },
];

const ICON_BTN = "flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100";
const DIVIDER = "mx-0.5 h-6 w-px bg-slate-200";

export interface ToolbarAnchor {
  x: number;
  top: number;
  bottom: number;
}

export interface ToolbarHandlers {
  onColor(color: HighlightColor): void;
  onUnderline(style: UnderlineStyle): void;
  onDelete(): void;
}

export interface AnnotationToolbarView {
  readonly el: HTMLDivElement;
  /** Show at `anchor` with `current` styles pressed. */
  open(anchor: ToolbarAnchor, current: IslandAnnotationStyle): void;
  setCurrent(current: IslandAnnotationStyle): void;
  close(): void;
  readonly isOpen: boolean;
}

export function AnnotationToolbar(handlers: ToolbarHandlers): AnnotationToolbarView {
  const swatches = SWATCHES.map((s) => {
    const b = h("button", {
      attrs: { type: "button", "aria-label": s.label, "aria-pressed": "false" },
      style: { backgroundColor: s.bg },
      on: { click: () => handlers.onColor(s.color) },
    });
    return { s, b };
  });
  const lines = LINES.map((l) => {
    const b = h(
      "button",
      { attrs: { type: "button", "aria-label": l.label, "aria-pressed": "false" }, on: { click: () => handlers.onUnderline(l.style) } },
      h("span", { className: `block w-4 border-b-2 ${l.css} border-current` }),
    );
    return { l, b };
  });
  const del = h(
    "button",
    { className: `${ICON_BTN} hover:bg-red-50 hover:text-red-600`, attrs: { type: "button", "aria-label": "Delete annotation" }, on: { click: () => handlers.onDelete() } },
    icon("trash-2", "h-[18px] w-[18px]"),
  );
  const el = h(
    "div",
    {
      className: "fixed z-[70] flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 shadow-xl",
      attrs: { "data-annot-toolbar": "", role: "toolbar", "aria-label": "Annotation options" },
      style: { left: -9999, top: -9999, visibility: "hidden" },
    },
    ...swatches.map((x) => x.b),
    h("span", { className: DIVIDER }),
    ...lines.map((x) => x.b),
    h("span", { className: DIVIDER }),
    del,
  );
  let isOpen = false;

  function setCurrent(current: IslandAnnotationStyle): void {
    for (const { s, b } of swatches) {
      const on = current.color === s.color;
      b.className = `h-[30px] w-[30px] rounded-full ${on ? "ring-2 ring-slate-900 ring-offset-1" : "ring-1 ring-slate-200"}`;
      b.setAttribute("aria-pressed", String(on));
    }
    for (const { l, b } of lines) {
      const on = current.underline === l.style;
      b.className = `${ICON_BTN} ${on ? "bg-blue-50 text-blue-700" : ""}`.trim();
      b.setAttribute("aria-pressed", String(on));
    }
  }

  return {
    el,
    get isOpen() {
      return isOpen;
    },
    setCurrent,
    open(anchor, current) {
      setCurrent(current);
      isOpen = true;
      setStyle(el, { left: -9999, top: -9999, visibility: "hidden" });
      // The website's useLayoutEffect placement: prefer above, flip below, clamp on-screen.
      const w = el.offsetWidth;
      const hgt = el.offsetHeight;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = anchor.x - w / 2;
      left = Math.max(margin, Math.min(left, vw - w - margin));
      let top = anchor.top - hgt - 10;
      if (top < margin) top = anchor.bottom + 10;
      top = Math.max(margin, Math.min(top, vh - hgt - margin));
      setStyle(el, { left, top, visibility: "visible" });
    },
    close() {
      isOpen = false;
      setStyle(el, { left: -9999, top: -9999, visibility: "hidden" });
    },
  };
}
