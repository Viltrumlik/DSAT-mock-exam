// Port of frontend/src/features/testing-simulation/tools/highlight/useAnnotator.ts
// (the annotator glue), decoupled from React and from the website's localStorage store.
//
// What is the website's, unchanged:
//   * the three regions, each with its own offset space: passage (#ts-passage), question
//     (#ts-question), choices (#ts-choices);
//   * mouse-up with a selection whose anchor AND focus lie in one region → offsets from the
//     website's `rangeToOffsets`; a selection spanning regions is ignored;
//   * a click on an existing mark → the range is `boundingRange(annotationsAt(...))` of the
//     annotations under it (else the mark's own offsets), and the toolbar's "current" style
//     is `stylesOver` that range — with one fix: the mark's offsets come from `markOffsets`
//     below, because the website's `offsetsOfMark` always returns null (see there);
//   * any other mouse-up closes the toolbar; clicks inside `[data-annot-toolbar]` are ignored;
//   * applying runs `addHighlight` / `addUnderline` / `removeRange` (each ends in
//     `mergeAnnotations`), repaints with `applyAnnotations` and clears the DOM selection;
//   * painting skips the region the student is selecting in, so a drag is never disturbed.
//
// What the island changes (architecture.md §2.8 "Highlighting"):
//   * storage: the lists live here, seeded by `question.show` and reported back with
//     `annot.changed` — native persists them (the website wrote localStorage + the server);
//   * the toolbar: with `overlays:"native"` the island does not auto-apply on mouse-up; it
//     caches the range under a `selectionId` and reports `selection` / `annot.click`, and
//     native answers with `annot.apply`. (The website auto-applies the active colour on
//     release; native does that by answering `selection` with an immediate `annot.apply`.)
//     With `overlays:"inline"` (the windowed fallback) the island shows the website's own
//     toolbar and auto-applies like the website — see content/island.ts.
import type { IslandAnnotation, IslandAnnotationSet, IslandAnnotationStyle, IslandRect } from "../protocol";
import {
  addHighlight,
  addUnderline,
  annotationsAt,
  applyAnnotations,
  boundingRange,
  markFromEvent,
  rangeToOffsets,
  removeRange,
  type Annotation,
  type HighlightColor,
  type OffsetRange,
  type UnderlineStyle,
} from "../website";

export type ContainerKey = "passage" | "question" | "choices";
export const CONTAINER_KEYS: readonly ContainerKey[] = ["passage", "question", "choices"];

/** A highlightable region of the card on screen (`el` is null when the card has none). */
export interface AnnotatableContainer {
  key: ContainerKey;
  el: HTMLElement | null;
}

/** What a selectionId / annotId points at. */
export interface AnnotTarget {
  qid: number;
  container: ContainerKey;
  range: OffsetRange;
}

export type AnnotOp = "highlight" | "underline" | "remove";

export interface SelectionReport {
  kind: "selection";
  selectionId: string;
  qid: number;
  container: ContainerKey;
  start: number;
  end: number;
  text: string;
  rect: IslandRect;
  range: Range;
}

export interface MarkClickReport {
  kind: "annot.click";
  annotId: string;
  qid: number;
  container: ContainerKey;
  rect: IslandRect;
  current: IslandAnnotationStyle;
}

export type MouseUpOutcome = SelectionReport | MarkClickReport | { kind: "dismiss" } | null;

export interface AnnotatorHost {
  /** The qid on screen, or null before the first question.show. */
  currentQid(): number | null;
  /** The on-screen card's regions. */
  containers(): AnnotatableContainer[];
  /** A region of any card of the module (detached cards included), for repaints. */
  containerOf(qid: number, key: ContainerKey): HTMLElement | null;
}

export const DEFAULT_COLOR: HighlightColor = "yellow";
export const DEFAULT_UNDERLINE: UnderlineStyle = "solid";
/** Schema limit for `selection.text` / `selection.current.text`. */
export const MAX_SELECTION_TEXT = 500;
/** Targets kept for late annot.apply messages (a toolbar acts on its range repeatedly). */
const MAX_TARGETS = 64;

/** Styles covering the entire range (drives the active toolbar buttons). Website verbatim. */
export function stylesOver(anns: Annotation[], range: OffsetRange): IslandAnnotationStyle {
  const color = anns.find((a) => a.kind === "highlight" && a.start <= range.start && a.end >= range.end)?.color;
  const underline = anns.find((a) => a.kind === "underline" && a.start <= range.start && a.end >= range.end)?.underline;
  const out: { color?: HighlightColor; underline?: UnderlineStyle } = {};
  if (color) out.color = color;
  if (underline) out.underline = underline;
  return out;
}

/** The wire form of a list: only the fields the website's Annotation type has, no undefineds. */
export function toWire(list: readonly Annotation[]): IslandAnnotation[] {
  return list.map((a) => {
    const out: { start: number; end: number; kind: Annotation["kind"]; color?: HighlightColor; underline?: UnderlineStyle } = {
      start: a.start,
      end: a.end,
      kind: a.kind,
    };
    if (a.kind === "highlight" && a.color) out.color = a.color;
    if (a.kind === "underline" && a.underline) out.underline = a.underline;
    return out;
  });
}

function fromWire(list: readonly IslandAnnotation[] | undefined): Annotation[] {
  return (list ?? [])
    .filter((a) => Number.isInteger(a.start) && Number.isInteger(a.end) && a.end > a.start && a.start >= 0)
    .map((a) => ({ ...a }));
}

function rectOf(r: { left: number; top: number; width: number; height: number } | null | undefined): IslandRect {
  if (!r) return { x: 0, y: 0, w: 0, h: 0 };
  const n = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
  return { x: n(r.left), y: n(r.top), w: n(r.width), h: n(r.height) };
}

/**
 * The character offsets a <mark> covers, counted by the website's `rangeToOffsets`.
 *
 * The website's `offsetsOfMark` builds its Range with `selectNodeContents(mark)`, whose
 * boundaries are the <mark> ELEMENT; `rangeToOffsets` only matches text nodes, so it always
 * returns null and, on the website, clicking an existing highlight never opens the toolbar
 * (useAnnotator.ts:144 — reported in the island's build notes). Here the Range is bounded by
 * the mark's first and last text nodes, so the website's own counting applies unchanged.
 */
export function markOffsets(container: HTMLElement, mark: HTMLElement): OffsetRange | null {
  const doc = mark.ownerDocument;
  const walker = doc.createTreeWalker(mark, NodeFilter.SHOW_TEXT);
  let first: Text | null = null;
  let last: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (t.length === 0) continue;
    if (!first) first = t;
    last = t;
  }
  if (!first || !last) return null;
  const range = doc.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.length);
  return rangeToOffsets(container, range);
}

function rangeRect(range: Range): IslandRect {
  return typeof range.getBoundingClientRect === "function" ? rectOf(range.getBoundingClientRect()) : rectOf(null);
}

export class Annotator {
  private readonly lists = new Map<string, Annotation[]>();
  private readonly targets = new Map<string, AnnotTarget>();
  private seq = 0;
  /** A selection / mark toolbar is open (native or inline). */
  toolbarOpen = false;
  /** The most recent selection report, for selection.get when the DOM selection is gone. */
  private lastSelection: { qid: number; container: ContainerKey; text: string } | null = null;

  constructor(private readonly host: AnnotatorHost) {}

  private static k(qid: number, key: ContainerKey): string {
    return `${qid}:${key}`;
  }

  list(qid: number, key: ContainerKey): Annotation[] {
    return this.lists.get(Annotator.k(qid, key)) ?? [];
  }

  set(qid: number, key: ContainerKey, list: Annotation[]): void {
    this.lists.set(Annotator.k(qid, key), list);
  }

  /** Seed a question's three lists (question.show) and paint them. */
  load(qid: number, set: IslandAnnotationSet): void {
    for (const key of CONTAINER_KEYS) this.set(qid, key, fromWire(set[key]));
    this.paint(qid);
  }

  /** Forget everything (a new module). */
  reset(): void {
    this.lists.clear();
    this.targets.clear();
    this.toolbarOpen = false;
    this.lastSelection = null;
  }

  /** Forget the open toolbar and its targets (question change). Lists stay. */
  dismiss(): void {
    this.toolbarOpen = false;
    this.lastSelection = null;
  }

  /** Paint every region of `qid` from its list, skipping a region the student is selecting in. */
  paint(qid: number): void {
    const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
    const activeNode = sel && !sel.isCollapsed ? sel.anchorNode : null;
    for (const key of CONTAINER_KEYS) {
      const el = this.host.containerOf(qid, key);
      if (!el) continue;
      if (activeNode && el.contains(activeNode)) continue;
      applyAnnotations(el, this.list(qid, key));
    }
  }

  private remember(prefix: "s" | "a", target: AnnotTarget): string {
    const id = `${prefix}-${++this.seq}`;
    this.targets.set(id, target);
    while (this.targets.size > MAX_TARGETS) {
      const oldest = this.targets.keys().next().value as string;
      this.targets.delete(oldest);
    }
    return id;
  }

  target(id: string): AnnotTarget | undefined {
    return this.targets.get(id);
  }

  /** The website's document mouse-up, minus the auto-apply (see the header). */
  onMouseUp(e: MouseEvent): MouseUpOutcome {
    const qid = this.host.currentQid();
    if (qid == null) return null;
    if ((e.target as Element | null)?.closest?.("[data-annot-toolbar]")) return null;
    const list = this.host.containers().filter((c): c is { key: ContainerKey; el: HTMLElement } => c.el != null);
    const sel = typeof window.getSelection === "function" ? window.getSelection() : null;

    // New selection inside a single region.
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      const c = list.find((c) => c.el.contains(sel.anchorNode) && c.el.contains(sel.focusNode));
      if (c) {
        const range = sel.getRangeAt(0);
        const off = rangeToOffsets(c.el, range);
        if (off) {
          const selectionId = this.remember("s", { qid, container: c.key, range: off });
          const text = range.toString().slice(0, MAX_SELECTION_TEXT);
          this.toolbarOpen = true;
          this.lastSelection = { qid, container: c.key, text };
          return { kind: "selection", selectionId, qid, container: c.key, start: off.start, end: off.end, text, rect: rangeRect(range), range };
        }
      }
      return null;
    }

    // Click on an existing annotation → open the toolbar to edit it.
    const mark = markFromEvent(e.target);
    if (mark) {
      const c = list.find((c) => c.el.contains(mark));
      if (c) {
        const markRange = markOffsets(c.el, mark);
        if (markRange) {
          const anns = this.list(qid, c.key);
          const range = boundingRange(annotationsAt(anns, markRange.start)) ?? markRange;
          const annotId = this.remember("a", { qid, container: c.key, range });
          this.toolbarOpen = true;
          // The website anchors the toolbar at the click point (x: clientX, top = bottom = clientY).
          return {
            kind: "annot.click",
            annotId,
            qid,
            container: c.key,
            rect: rectOf({ left: e.clientX, top: e.clientY, width: 0, height: 0 }),
            current: stylesOver(anns, range),
          };
        }
      }
      return null;
    }

    if (this.toolbarOpen) {
      this.toolbarOpen = false;
      return { kind: "dismiss" };
    }
    return null;
  }

  /**
   * Apply `op` to a cached target. Returns the new list (already painted), or a reason when
   * the target is unknown. `color` / `underline` default like the website's toolbar.
   */
  apply(
    id: string,
    op: AnnotOp,
    style: { color?: HighlightColor; underline?: UnderlineStyle } = {},
  ): { qid: number; container: ContainerKey; list: Annotation[] } | { error: string } {
    const target = this.targets.get(id);
    if (!target) return { error: `unknown target ${id}` };
    const { qid, container, range } = target;
    const before = this.list(qid, container);
    let next: Annotation[];
    if (op === "highlight") next = addHighlight(before, range, style.color ?? DEFAULT_COLOR);
    else if (op === "underline") next = addUnderline(before, range, style.underline ?? DEFAULT_UNDERLINE);
    else next = removeRange(before, range);
    this.set(qid, container, next);
    const el = this.host.containerOf(qid, container);
    if (el) applyAnnotations(el, next);
    if (typeof window.getSelection === "function") window.getSelection()?.removeAllRanges();
    if (op === "remove") this.toolbarOpen = false;
    return { qid, container, list: next };
  }

  /** The text the student has selected now (or last reported), for selection.get. */
  current(): { container: ContainerKey | null; text: string | null } {
    const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      const c = this.host
        .containers()
        .find((c) => c.el && c.el.contains(sel.anchorNode) && c.el.contains(sel.focusNode));
      if (c) {
        const text = sel.toString().slice(0, MAX_SELECTION_TEXT);
        if (text.trim() !== "") return { container: c.key, text };
      }
    }
    const qid = this.host.currentQid();
    if (this.lastSelection && this.lastSelection.qid === qid && this.lastSelection.text.trim() !== "") {
      return { container: this.lastSelection.container, text: this.lastSelection.text };
    }
    return { container: null, text: null };
  }
}
