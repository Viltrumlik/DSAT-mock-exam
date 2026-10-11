// The highlighter (architecture.md §2.8 "Highlighting"): selections inside #ts-passage,
// #ts-question and #ts-choices become `selection{selectionId, start, end, text, rect}` with the
// website's rangeToOffsets offsets; `annot.apply` runs the website's addHighlight /
// addUnderline / removeRange and answers `annot.changed` in the website's Annotation format;
// lists round-trip through question.show; marks are clickable for editing.
import { afterEach, describe, expect, it } from "vitest";

import { markOffsets, stylesOver, toWire } from "../../src/ported/annotator";
import type { IslandAnnotation, IslandQuestion } from "../../src/protocol";
import { addHighlight, addUnderline, applyAnnotations, offsetsOfMark, rangeToOffsets, removeRange, type Annotation } from "../../src/website";
import { assertAllValid, loadModule, mountIsland, rwModule, show, type Harness } from "../helpers";

let h: Harness;
afterEach(() => {
  if (h) assertAllValid(h);
  h?.stop();
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

/** (node, offset) for a character offset in the website's text-node order. */
function locate(container: HTMLElement, offset: number): { node: Text; offset: number } {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let last: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (offset <= acc + t.length && t.length > 0) return { node: t, offset: offset - acc };
    acc += t.length;
    last = t;
  }
  if (!last) throw new Error("no text");
  return { node: last, offset: last.length };
}

function textOf(container: HTMLElement): string {
  let s = "";
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) s += (n as Text).data;
  return s;
}

/** Select [start, end) of `container`'s text and release the mouse there, like a student. */
function selectAndRelease(container: HTMLElement, start: number, end: number, endContainer: HTMLElement = container): void {
  const a = locate(container, start);
  const b = locate(endContainer, end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  b.node.parentElement!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 10, clientY: 10 }));
}

function clickMark(mark: Element): void {
  window.getSelection()?.removeAllRanges();
  mark.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 120, clientY: 64 }));
}

const passage = () => h.island.main.querySelector<HTMLElement>("#ts-passage")!;
const question = () => h.island.main.querySelector<HTMLElement>("#ts-question")!;
const choices = () => h.island.main.querySelector<HTMLElement>("#ts-choices")!;

function start(highlighterOn = true, overlays: "native" | "inline" = "native"): IslandQuestion[] {
  h = mountIsland();
  const qs = loadModule(h, rwModule(), { highlighterOn, overlays });
  show(h, qs[0], 0, qs.length);
  h.clear();
  return qs;
}

describe("selection → native", () => {
  it("a selection inside the passage reports the website's offsets, the text and a rect", () => {
    const qs = start();
    selectAndRelease(passage(), 3, 21);
    const sel = h.last("selection")!;
    expect(sel).toMatchObject({ t: "selection", qid: qs[0].id, container: "passage", start: 3, end: 21 });
    expect(sel.text).toBe(textOf(passage()).slice(3, 21));
    expect(typeof sel.selectionId).toBe("string");
    expect(sel.rect).toEqual({ x: expect.any(Number), y: expect.any(Number), w: expect.any(Number), h: expect.any(Number) });
    // The same offsets the website computes for the same Range.
    const r = window.getSelection()!.getRangeAt(0);
    expect(rangeToOffsets(passage(), r)).toEqual({ start: 3, end: 21 });
  });

  it("works the same in the question stem and the choices, each in its own offset space", () => {
    start();
    selectAndRelease(question(), 0, 9);
    expect(h.last("selection")).toMatchObject({ container: "question", start: 0, end: 9 });
    selectAndRelease(choices(), 1, 6);
    expect(h.last("selection")).toMatchObject({ container: "choices", start: 1, end: 6 });
  });

  it("a selection spanning two regions is ignored, like the website", () => {
    start();
    selectAndRelease(passage(), 10, 5, question());
    expect(h.sentOf("selection")).toEqual([]);
  });

  it("nothing is reported while the highlighter is off", () => {
    start(false);
    selectAndRelease(passage(), 3, 21);
    expect(h.sent()).toEqual([]);
  });

  it("long selections are clipped to the schema's 500 characters", () => {
    start();
    const total = textOf(passage()).length;
    selectAndRelease(passage(), 0, total);
    const sel = h.last("selection")!;
    expect((sel.text as string).length).toBeLessThanOrEqual(500);
    expect(sel.end).toBe(total);
  });

  it("a click elsewhere after a selection sends selection.clear", () => {
    start();
    selectAndRelease(passage(), 3, 21);
    window.getSelection()!.removeAllRanges();
    passage().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(h.last("selection.clear")).toBeDefined();
  });
});

describe("annot.apply → annot.changed", () => {
  it("highlight, then underline the same range: two layers in the website's format, painted", () => {
    const qs = start();
    selectAndRelease(passage(), 3, 21);
    const id = h.last("selection")!.selectionId as string;
    h.deliver({ t: "annot.apply", selectionId: id, op: "highlight", color: "blue" });
    expect(h.last("annot.changed")).toEqual({
      v: 1,
      t: "annot.changed",
      qid: qs[0].id,
      container: "passage",
      list: [{ start: 3, end: 21, kind: "highlight", color: "blue" }],
    });
    const marks = [...passage().querySelectorAll<HTMLElement>("mark.ts-annot")];
    expect(marks.map((m) => m.textContent).join("")).toBe(textOf(passage()).slice(3, 21));
    expect(marks[0].dataset.color).toBe("blue");
    expect(window.getSelection()!.isCollapsed).toBe(true);

    h.deliver({ t: "annot.apply", selectionId: id, op: "underline", underline: "dashed" });
    expect(h.last("annot.changed")!.list).toEqual([
      { start: 3, end: 21, kind: "highlight", color: "blue" },
      { start: 3, end: 21, kind: "underline", underline: "dashed" },
    ]);
    expect(passage().querySelector<HTMLElement>("mark.ts-annot")!.dataset.underline).toBe("dashed");
  });

  it("follows the website's merge rules (same colour merges, a new colour wins in the overlap)", () => {
    start();
    selectAndRelease(passage(), 0, 10);
    h.deliver({ t: "annot.apply", selectionId: h.last("selection")!.selectionId, op: "highlight", color: "yellow" });
    selectAndRelease(passage(), 8, 20);
    h.deliver({ t: "annot.apply", selectionId: h.last("selection")!.selectionId, op: "highlight", color: "yellow" });
    expect(h.last("annot.changed")!.list).toEqual([{ start: 0, end: 20, kind: "highlight", color: "yellow" }]);
    selectAndRelease(passage(), 5, 12);
    h.deliver({ t: "annot.apply", selectionId: h.last("selection")!.selectionId, op: "highlight", color: "pink" });
    const expected = addHighlight([{ start: 0, end: 20, kind: "highlight", color: "yellow" }], { start: 5, end: 12 }, "pink");
    expect(h.last("annot.changed")!.list).toEqual(toWire(expected));
  });

  it("clicking a mark reports annot.click with its styles; remove deletes both layers", () => {
    const qs = start();
    const before = textOf(passage());
    selectAndRelease(passage(), 3, 21);
    const sid = h.last("selection")!.selectionId;
    h.deliver({ t: "annot.apply", selectionId: sid, op: "highlight", color: "pink" });
    h.deliver({ t: "annot.apply", selectionId: sid, op: "underline", underline: "dotted" });
    clickMark(passage().querySelector("mark.ts-annot")!);
    const click = h.last("annot.click")!;
    expect(click).toMatchObject({ qid: qs[0].id, container: "passage", current: { color: "pink", underline: "dotted" }, rect: { x: 120, y: 64, w: 0, h: 0 } });
    h.deliver({ t: "annot.apply", annotId: click.annotId, op: "remove" });
    expect(h.last("annot.changed")!.list).toEqual([]);
    expect(passage().querySelector("mark.ts-annot")).toBeNull();
    expect(textOf(passage())).toBe(before); // the text itself is untouched
  });

  it("an unknown id, or both ids at once, is an error and changes nothing", () => {
    start();
    h.deliver({ t: "annot.apply", selectionId: "s-404", op: "highlight", color: "yellow" });
    expect(h.last("error")).toMatchObject({ where: "annot.apply" });
    h.deliver({ t: "annot.apply", selectionId: "s-1", annotId: "a-1", op: "remove" });
    expect(h.sentOf("error")).toHaveLength(2);
    expect(h.sentOf("annot.changed")).toEqual([]);
  });

  it("highlights land in the question stem and the choices too", () => {
    const qs = start();
    selectAndRelease(choices(), 1, 6);
    h.deliver({ t: "annot.apply", selectionId: h.last("selection")!.selectionId, op: "highlight", color: "yellow" });
    expect(h.last("annot.changed")).toMatchObject({ qid: qs[0].id, container: "choices", list: [{ start: 1, end: 6, kind: "highlight", color: "yellow" }] });
    expect(choices().querySelector("mark.ts-annot")).not.toBeNull();
  });
});

describe("round trip through native", () => {
  it("annot.changed lists fed back as question.show annotations paint the same marks over the same text", () => {
    const qs = start();
    const saved: Record<string, IslandAnnotation[]> = { passage: [], question: [], choices: [] };
    selectAndRelease(passage(), 3, 21);
    h.deliver({ t: "annot.apply", selectionId: h.last("selection")!.selectionId, op: "highlight", color: "blue" });
    saved.passage = h.last("annot.changed")!.list as IslandAnnotation[];
    selectAndRelease(question(), 0, 9);
    h.deliver({ t: "annot.apply", selectionId: h.last("selection")!.selectionId, op: "underline", underline: "solid" });
    saved.question = h.last("annot.changed")!.list as IslandAnnotation[];
    const marked = { passage: passage().innerHTML, question: question().innerHTML };
    h.stop();
    document.body.replaceChildren();

    // A fresh island (a restart, another session): native replays what it stored.
    h = mountIsland();
    loadModule(h, rwModule(), { highlighterOn: true });
    show(h, qs[0], 0, qs.length, { annotations: saved });
    expect(passage().innerHTML).toBe(marked.passage);
    expect(question().innerHTML).toBe(marked.question);
    // Offsets do not depend on the marks: selecting the same characters gives the same numbers.
    selectAndRelease(passage(), 3, 21);
    expect(h.last("selection")).toMatchObject({ start: 3, end: 21 });
  });

  it("leaving and coming back to a question keeps its marks", () => {
    const qs = start();
    selectAndRelease(passage(), 3, 21);
    h.deliver({ t: "annot.apply", selectionId: h.last("selection")!.selectionId, op: "highlight", color: "yellow" });
    const list = h.last("annot.changed")!.list;
    show(h, qs[1], 1, qs.length);
    show(h, qs[0], 0, qs.length, { annotations: { passage: list, question: [], choices: [] } });
    expect(passage().querySelector("mark.ts-annot")!.textContent).toBe(textOf(passage()).slice(3, 21));
  });

  it("invalid stored ranges are ignored rather than painted", () => {
    const qs = start();
    show(h, qs[1], 1, qs.length);
    show(h, qs[0], 0, qs.length, {
      annotations: { passage: [{ start: 10, end: 5, kind: "highlight", color: "yellow" }, { start: -3, end: 2, kind: "highlight", color: "blue" }], question: [], choices: [] },
    });
    expect(passage().querySelector("mark.ts-annot")).toBeNull();
  });

  it("switching questions closes an open toolbar with selection.clear", () => {
    const qs = start();
    selectAndRelease(passage(), 3, 21);
    h.clear();
    show(h, qs[1], 1, qs.length);
    expect(h.sentOf("selection.clear")).toHaveLength(1);
  });

  it("turning the highlighter off closes the toolbar", () => {
    start();
    selectAndRelease(passage(), 3, 21);
    h.clear();
    h.deliver({ t: "view.set", highlighterOn: false });
    expect(h.sentOf("selection.clear")).toHaveLength(1);
  });
});

describe("selection.get (Report a problem / Notes pre-fill)", () => {
  it("answers with the live selection", () => {
    const qs = start();
    selectAndRelease(question(), 0, 9);
    h.deliver({ t: "selection.get", req: 7 });
    expect(h.last("selection.current")).toEqual({ v: 1, t: "selection.current", req: 7, qid: qs[0].id, container: "question", text: textOf(question()).slice(0, 9) });
  });

  it("falls back to the last reported selection, then to nulls", () => {
    const qs = start();
    selectAndRelease(passage(), 3, 21);
    window.getSelection()!.removeAllRanges();
    h.deliver({ t: "selection.get", req: 8 });
    expect(h.last("selection.current")).toMatchObject({ req: 8, qid: qs[0].id, container: "passage", text: textOf(passage()).slice(3, 21) });
    show(h, qs[1], 1, qs.length);
    h.deliver({ t: "selection.get", req: 9 });
    expect(h.last("selection.current")).toEqual({ v: 1, t: "selection.current", req: 9, qid: qs[1].id, container: null, text: null });
  });
});

describe('overlays:"inline" (windowed fallback): the website\'s own toolbar inside the island', () => {
  it("auto-applies the active colour on release and opens the toolbar; its buttons recolour, underline and delete", () => {
    const qs = start(true, "inline");
    selectAndRelease(passage(), 3, 21);
    expect(h.sentOf("selection")).toEqual([]);
    expect(h.last("annot.changed")).toMatchObject({ qid: qs[0].id, container: "passage", list: [{ start: 3, end: 21, kind: "highlight", color: "yellow" }] });
    const toolbar = document.querySelector<HTMLElement>("[data-annot-toolbar]")!;
    expect(toolbar.style.visibility).toBe("visible");
    expect(toolbar.querySelector('[aria-label="Yellow highlight"]')!.getAttribute("aria-pressed")).toBe("true");

    toolbar.querySelector<HTMLButtonElement>('[aria-label="Blue highlight"]')!.click();
    expect(h.last("annot.changed")!.list).toEqual([{ start: 3, end: 21, kind: "highlight", color: "blue" }]);
    toolbar.querySelector<HTMLButtonElement>('[aria-label="Dashed underline"]')!.click();
    expect(h.last("annot.changed")!.list).toEqual([
      { start: 3, end: 21, kind: "highlight", color: "blue" },
      { start: 3, end: 21, kind: "underline", underline: "dashed" },
    ]);
    expect(toolbar.querySelector('[aria-label="Dashed underline"]')!.getAttribute("aria-pressed")).toBe("true");
    toolbar.querySelector<HTMLButtonElement>('[aria-label="Delete annotation"]')!.click();
    expect(h.last("annot.changed")!.list).toEqual([]);
    expect(toolbar.style.visibility).toBe("hidden");
  });

  it("the next highlight uses the colour picked last, like the website", () => {
    start(true, "inline");
    selectAndRelease(passage(), 0, 5);
    document.querySelector<HTMLButtonElement>('[data-annot-toolbar] [aria-label="Pink highlight"]')!.click();
    selectAndRelease(passage(), 30, 40);
    expect(h.last("annot.changed")!.list).toContainEqual({ start: 30, end: 40, kind: "highlight", color: "pink" });
  });

  it("the toolbar carries no title tooltips", () => {
    start(true, "inline");
    expect(document.querySelector("[data-annot-toolbar] [title]")).toBeNull();
  });
});

describe("helpers", () => {
  it("markOffsets finds a mark's range; the website's offsetsOfMark cannot (known website defect)", () => {
    const div = document.createElement("div");
    div.innerHTML = "<p>Hello <i>brave</i> new world</p>";
    document.body.appendChild(div);
    applyAnnotations(div, [{ start: 6, end: 15, kind: "highlight", color: "yellow" }]);
    const marks = [...div.querySelectorAll<HTMLElement>("mark.ts-annot")];
    expect(marks.map((m) => m.textContent)).toEqual(["brave", " new"]);
    expect(markOffsets(div, marks[0])).toEqual({ start: 6, end: 11 });
    expect(markOffsets(div, marks[1])).toEqual({ start: 11, end: 15 });
    // When this starts failing, the website fixed offsetsOfMark: switch the annotator back to it.
    expect(offsetsOfMark(div, marks[0])).toBeNull();
  });

  it("toWire keeps only the website's Annotation fields", () => {
    const list: Annotation[] = [
      { start: 0, end: 4, kind: "highlight", color: "yellow", underline: undefined } as Annotation,
      { start: 2, end: 9, kind: "underline", underline: "dotted", color: undefined } as Annotation,
    ];
    expect(toWire(list)).toEqual([
      { start: 0, end: 4, kind: "highlight", color: "yellow" },
      { start: 2, end: 9, kind: "underline", underline: "dotted" },
    ]);
    expect(JSON.stringify(toWire(list))).not.toContain("undefined");
  });

  it("stylesOver reports only the styles covering the whole range", () => {
    let anns: Annotation[] = addHighlight([], { start: 0, end: 10 }, "blue");
    anns = addUnderline(anns, { start: 5, end: 10 }, "solid");
    expect(stylesOver(anns, { start: 0, end: 10 })).toEqual({ color: "blue" });
    expect(stylesOver(anns, { start: 6, end: 9 })).toEqual({ color: "blue", underline: "solid" });
    expect(stylesOver(removeRange(anns, { start: 0, end: 10 }), { start: 0, end: 10 })).toEqual({});
  });
});
