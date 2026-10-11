// No browser habits inside an island (owner decision; architecture.md §2.5, report_webisms.md).
// WebView2 settings already turn off the context menu, accelerator keys, zoom and swipe
// navigation natively; this is the page-side half, so the macOS dev runner and a misconfigured
// host behave the same:
//
//   * no right-click menu, no dragging anything out, no file drop (a drop would navigate);
//   * no selection outside the highlightable regions (CSS does the work; selectstart backs it);
//   * links are inert, forms never submit, no new windows, middle-click autoscroll is off;
//   * browser keys are swallowed: reload, find, print, save, open, view-source, zoom, caret
//     browsing (F7), history (Alt+←/→, Backspace), select-all outside a text field;
//   * midterms: copy and cut are blocked too (as 0.1.0, ExamRunner.tsx:166-178);
//   * `title` tooltips and <select> controls are removed wherever they appear (KaTeX error
//     spans carry a title, for one).

/** The regions where text selection is allowed (and the SPR input, a text field). */
export const SELECTABLE = "#ts-passage, #ts-question, #ts-choices";

export function isTextField(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.tagName !== "string") return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable === true;
}

/** Ctrl/Meta + key combinations the browser would act on. */
const CTRL_KEYS = new Set(["a", "f", "g", "h", "j", "l", "n", "o", "p", "r", "s", "t", "u", "w", "+", "-", "=", "0", "[", "]"]);
const FUNCTION_KEYS = new Set(["F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12", "BrowserBack", "BrowserForward", "BrowserRefresh", "BrowserSearch", "BrowserHome", "BrowserFavorites"]);

/** True when `e` is a browser shortcut the island must swallow. */
export function isBrowserKey(e: KeyboardEvent): boolean {
  if (FUNCTION_KEYS.has(e.key)) return true;
  if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home")) return true;
  if (e.key === "Backspace" && !isTextField(e.target)) return true;
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    // Select-all, cut/copy/paste and undo stay available inside the SPR input.
    if (isTextField(e.target) && (k === "a" || k === "c" || k === "v" || k === "x" || k === "z" || k === "y")) return false;
    if (CTRL_KEYS.has(k)) return true;
  }
  return false;
}

export interface HardeningOptions {
  /** Copy/cut blocked (midterms). Read on every event, so `init` can change it. */
  blockCopy(): boolean;
  /** Text selection only inside SELECTABLE and text fields (content island; default true). */
  restrictSelection?: boolean;
  /** Strip `title` / <select> now and on every DOM change (content island; default true). */
  scrub?: boolean;
}

/** Strip tooltips and <select> from `root` (and itself). */
export function scrub(root: Element): void {
  if (root.hasAttribute("title")) root.removeAttribute("title");
  for (const el of root.querySelectorAll("[title]")) el.removeAttribute("title");
  if (root.tagName === "SELECT") root.remove();
  for (const el of root.querySelectorAll("select")) el.remove();
}

/** Install the document-level guards. Returns an uninstaller (tests). */
export function installHardening(doc: Document, opts: HardeningOptions): () => void {
  const win = doc.defaultView ?? window;
  const offs: Array<() => void> = [];
  const on = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void, options?: AddEventListenerOptions) => {
    doc.addEventListener(type, fn as EventListener, options);
    offs.push(() => doc.removeEventListener(type, fn as EventListener, options));
  };
  const prevent = (e: Event) => e.preventDefault();

  on("contextmenu", prevent, { capture: true });
  on("dragstart", prevent, { capture: true });
  on("dragover", prevent, { capture: true });
  on("drop", prevent, { capture: true });
  on("submit", prevent, { capture: true });
  if (opts.restrictSelection !== false) on("selectstart", (e) => {
    const t = e.target as Node | null;
    const el = (t && t.nodeType === 1 ? (t as Element) : t?.parentElement) ?? null;
    if (!el) return;
    if (isTextField(el) || el.closest(SELECTABLE)) return;
    e.preventDefault();
  }, { capture: true });
  on("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a");
    if (a) e.preventDefault();
  }, { capture: true });
  on("auxclick", prevent, { capture: true });
  on("mousedown", (e) => {
    // Middle button: autoscroll / open-in-new-tab.
    if (e.button === 1) e.preventDefault();
  }, { capture: true });
  on("keydown", (e) => {
    if (isBrowserKey(e)) e.preventDefault();
  }, { capture: true });
  on("copy", (e) => {
    if (opts.blockCopy()) e.preventDefault();
  }, { capture: true });
  on("cut", (e) => {
    if (opts.blockCopy()) e.preventDefault();
  }, { capture: true });

  const wheel = (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault();
  };
  win.addEventListener("wheel", wheel, { passive: false, capture: true });
  offs.push(() => win.removeEventListener("wheel", wheel, { capture: true }));

  // No new windows, ever.
  try {
    win.open = () => null;
  } catch {
    /* read-only in some hosts */
  }

  // Tooltips and <select> anywhere, now and later.
  if (opts.scrub !== false) scrub(doc.documentElement);
  const MO = win.MutationObserver;
  if (opts.scrub !== false && typeof MO === "function") {
    const mo = new MO((records) => {
      for (const r of records) {
        if (r.type === "attributes" && r.attributeName === "title") {
          (r.target as Element).removeAttribute("title");
          continue;
        }
        for (const n of r.addedNodes) if (n.nodeType === 1) scrub(n as Element);
      }
    });
    mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
    offs.push(() => mo.disconnect());
  }

  return () => {
    for (const off of offs.reverse()) off();
  };
}
