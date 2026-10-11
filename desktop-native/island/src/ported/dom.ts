// A tiny element builder for the ported components (no framework in the island).
//
// It produces the same DOM React produces for the website's JSX: no whitespace text nodes
// between elements, `className` -> class, `style` objects -> inline declarations in key
// order, boolean ARIA values as "true"/"false". That matters beyond looks: the highlighter
// stores character offsets over a container's text nodes, so a stray text node would shift
// every offset (see the website's reviewOffsetParity.test.ts).

export type StyleMap = Record<string, string | number | null | undefined>;

export interface Props {
  className?: string;
  style?: StyleMap;
  /** Plain attributes (aria-*, role, type, ...). `false`/`null`/`undefined` are omitted. */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  /** Event listeners. */
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>;
}

export type Child = Node | string | number | null | undefined | false;

const SVG_NS = "http://www.w3.org/2000/svg";

/** React's unitless CSS properties that the ported components use. */
const UNITLESS = new Set(["flex", "flexGrow", "flexShrink", "opacity", "zIndex", "fontWeight", "lineHeight", "order"]);

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Apply a React-style style object (numbers get `px` like React, except unitless props). */
export function setStyle(el: HTMLElement | SVGElement, style: StyleMap | undefined): void {
  el.removeAttribute("style");
  if (!style) return;
  for (const [prop, raw] of Object.entries(style)) {
    if (raw == null || raw === "") continue;
    const value = typeof raw === "number" && !UNITLESS.has(prop) && raw !== 0 ? `${raw}px` : String(raw);
    el.style.setProperty(kebab(prop), value);
  }
  if (el.getAttribute("style") === "") el.removeAttribute("style");
}

function setAttrs(el: Element, attrs: Props["attrs"]): void {
  if (!attrs) return;
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false && !name.startsWith("aria-")) continue;
    if (value == null) continue;
    el.setAttribute(name, String(value));
  }
}

function append(el: Element, children: Child[]): void {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (typeof child === "string" || typeof child === "number") {
      const text = String(child);
      if (text !== "") el.appendChild(document.createTextNode(text));
    } else {
      el.appendChild(child);
    }
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props?.className) el.className = props.className;
  if (props?.style) setStyle(el, props.style);
  setAttrs(el, props?.attrs);
  if (props?.on) {
    for (const [type, fn] of Object.entries(props.on)) {
      if (fn) el.addEventListener(type, fn as EventListener);
    }
  }
  append(el, children);
  return el;
}

/** SVG element builder (attributes are written verbatim). */
export function svg(tag: string, attrs: Record<string, string | number | undefined>, ...children: Array<SVGElement | null>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null) continue;
    el.setAttribute(name, String(value));
  }
  for (const c of children) if (c) el.appendChild(c);
  return el;
}

/** Replace an element's children in one go. */
export function setChildren(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  append(el, children);
}

/** Set `className` only when it changed (avoids style recalcs on hot paths). */
export function setClass(el: Element, className: string): void {
  if (el.getAttribute("class") !== className) el.setAttribute("class", className);
}
