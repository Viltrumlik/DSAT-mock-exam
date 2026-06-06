/**
 * DOM ↔ character-offset highlighting. Highlights are stored as `{start,end}`
 * character ranges over a container's visible text, NOT as serialized HTML — so
 * they survive React re-renders without clobbering the rendered question, and
 * never interact with the exam engine.
 */
export interface HighlightRange {
  start: number;
  end: number;
}

const MARK = "ts-highlight";

function textNodesWithOffsets(container: HTMLElement): Array<{ node: Text; start: number }> {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const list: Array<{ node: Text; start: number }> = [];
  let acc = 0;
  let n = walker.nextNode();
  while (n) {
    const text = n as Text;
    list.push({ node: text, start: acc });
    acc += text.length;
    n = walker.nextNode();
  }
  return list;
}

/** Character offsets of a selection Range relative to the container's text. */
export function rangeToOffsets(container: HTMLElement, range: Range): HighlightRange | null {
  const nodes = textNodesWithOffsets(container);
  let start = -1;
  let end = -1;
  for (const { node, start: base } of nodes) {
    if (node === range.startContainer) start = base + range.startOffset;
    if (node === range.endContainer) end = base + range.endOffset;
  }
  if (start < 0 || end < 0 || end <= start) return null;
  return { start, end };
}

/** Merge overlapping/adjacent ranges so re-applying never double-wraps. */
export function mergeRanges(ranges: HighlightRange[]): HighlightRange[] {
  const sorted = [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: HighlightRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Remove all highlight marks, restoring plain text/structure. */
export function clearHighlights(container: HTMLElement): void {
  container.querySelectorAll(`mark.${MARK}`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
  container.normalize();
}

/** Apply highlight ranges by wrapping the covered text in <mark> elements. */
export function applyHighlights(container: HTMLElement, ranges: HighlightRange[]): void {
  clearHighlights(container);
  const merged = mergeRanges(ranges);
  if (merged.length === 0) return;

  const nodes = textNodesWithOffsets(container);
  // Collect per-text-node spans first, then wrap in reverse document order so
  // splitting earlier nodes never invalidates references we haven't used yet.
  const spans: Array<{ node: Text; localStart: number; localEnd: number }> = [];
  for (const { node, start: base } of nodes) {
    const nodeEnd = base + node.length;
    for (const r of merged) {
      const s = Math.max(r.start, base);
      const e = Math.min(r.end, nodeEnd);
      if (e > s) spans.push({ node, localStart: s - base, localEnd: e - base });
    }
  }
  for (let i = spans.length - 1; i >= 0; i--) {
    const { node, localStart, localEnd } = spans[i];
    try {
      const range = document.createRange();
      range.setStart(node, localStart);
      range.setEnd(node, localEnd);
      const mark = document.createElement("mark");
      mark.className = MARK;
      range.surroundContents(mark);
    } catch {
      /* skip a span that can't be cleanly wrapped */
    }
  }
}

/** If a click landed on a highlight mark, return it (for the remove popover). */
export function markFromEvent(target: EventTarget | null): HTMLElement | null {
  let el = target as HTMLElement | null;
  while (el) {
    if (el.tagName === "MARK" && el.classList.contains(MARK)) return el;
    el = el.parentElement;
  }
  return null;
}

/** Offsets covered by a specific mark element, so it can be removed from storage. */
export function offsetsOfMark(container: HTMLElement, mark: HTMLElement): HighlightRange | null {
  const range = document.createRange();
  range.selectNodeContents(mark);
  return rangeToOffsets(container, range);
}
