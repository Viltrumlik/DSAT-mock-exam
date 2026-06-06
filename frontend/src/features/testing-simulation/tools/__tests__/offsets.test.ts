import { beforeEach, describe, expect, it } from "vitest";
import { applyHighlights, clearHighlights, mergeRanges, rangeToOffsets } from "../highlight/offsets";

describe("mergeRanges", () => {
  it("merges overlapping and adjacent ranges, drops empties", () => {
    expect(mergeRanges([{ start: 0, end: 5 }, { start: 4, end: 8 }])).toEqual([{ start: 0, end: 8 }]);
    expect(mergeRanges([{ start: 0, end: 3 }, { start: 3, end: 6 }])).toEqual([{ start: 0, end: 6 }]);
    expect(mergeRanges([{ start: 0, end: 2 }, { start: 5, end: 7 }])).toEqual([{ start: 0, end: 2 }, { start: 5, end: 7 }]);
    expect(mergeRanges([{ start: 2, end: 2 }])).toEqual([]);
  });
});

describe("applyHighlights / clearHighlights (jsdom)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    container.innerHTML = "The quick brown fox";
    document.body.appendChild(container);
  });

  it("wraps the requested character range in a mark", () => {
    applyHighlights(container, [{ start: 4, end: 9 }]); // "quick"
    const marks = container.querySelectorAll("mark.ts-highlight");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("quick");
    expect(container.textContent).toBe("The quick brown fox"); // text preserved
  });

  it("clearHighlights restores the original text", () => {
    applyHighlights(container, [{ start: 4, end: 9 }]);
    clearHighlights(container);
    expect(container.querySelectorAll("mark.ts-highlight")).toHaveLength(0);
    expect(container.textContent).toBe("The quick brown fox");
  });

  it("re-applying is idempotent (no nested marks)", () => {
    applyHighlights(container, [{ start: 4, end: 9 }]);
    applyHighlights(container, [{ start: 4, end: 9 }]);
    expect(container.querySelectorAll("mark.ts-highlight")).toHaveLength(1);
  });

  it("rangeToOffsets round-trips a DOM Range back to offsets", () => {
    const textNode = container.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 4);
    range.setEnd(textNode, 9);
    expect(rangeToOffsets(container, range)).toEqual({ start: 4, end: 9 });
  });
});
