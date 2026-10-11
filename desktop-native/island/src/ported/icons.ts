// Lucide icons, as lucide-react 0.577.0 (the website's version) renders them.
// Source: node_modules/lucide-react/dist/esm/icons/<name>.js (__iconNode) and Icon.js
// (defaultAttributes, the `lucide lucide-<name> <className>` class rule, aria-hidden).
// The visual reference test renders the real lucide-react components and compares the DOM.
import { svg } from "./dom";

type IconNode = Array<[string, Record<string, string>]>;

const NODES: Record<string, IconNode> = {
  bookmark: [
    [
      "path",
      {
        d: "M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z",
      },
    ],
  ],
  "panel-left-close": [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M9 3v18" }],
    ["path", { d: "m16 15-3-3 3-3" }],
  ],
  "panel-left-open": [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M9 3v18" }],
    ["path", { d: "m14 9 3 3-3 3" }],
  ],
  "circle-check": [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "m9 12 2 2 4-4" }],
  ],
  "circle-x": [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "m15 9-6 6" }],
    ["path", { d: "m9 9 6 6" }],
  ],
  "trash-2": [
    ["path", { d: "M10 11v6" }],
    ["path", { d: "M14 11v6" }],
    ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
    ["path", { d: "M3 6h18" }],
    ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
  ],
  "sticky-note": [
    ["path", { d: "M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z" }],
    ["path", { d: "M15 3v5a1 1 0 0 0 1 1h5" }],
  ],
};

export type IconName = keyof typeof NODES;

/** <svg> exactly as `<LucideIcon className=…/>` renders it. */
export function icon(name: IconName, className = ""): SVGElement {
  const node = NODES[name];
  const cls = ["lucide", `lucide-${name}`, className].filter((c) => c && c.trim() !== "").join(" ").trim();
  return svg(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: "24",
      height: "24",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: cls,
      "aria-hidden": "true",
    },
    ...node.map(([tag, attrs]) => svg(tag, attrs)),
  );
}
