/**
 * The caveats are what make the numbers honest, so none may be deleted — but six identical
 * grey rows pushed the work list ~340px down the page and made "3 sittings were excluded as
 * corrupt" look exactly like "here is how the denominator works", because only the icon
 * carried the tone.
 *
 * These tests hold both halves: every note still reaches the DOM, the real warnings are
 * visible without opening anything and carry an amber surface, and the unconditional method
 * notes are folded away.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COUNTING_NOTES_SUMMARY, Caveats, type Caveat } from "../components/Caveats";

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const ITEMS: Caveat[] = [
  { id: "denominator", tone: "info", text: "The headline rate is wrong answers over answerers." },
  { id: "selection", tone: "info", text: "Only the first completed sitting counts." },
  { id: "copied", tone: "warning", text: "3 sittings were excluded as corrupt." },
  { id: "repeat", tone: "info", text: "2 repeat sittings were set aside." },
  { id: "suspect", tone: "warning", text: "1 question is at 90% or above." },
  { id: "untagged", tone: "info", text: "2 questions carry no SAT skill." },
];

function render(items: Caveat[]) {
  act(() => root.render(<Caveats items={items} />));
}

/** The rows a teacher sees before opening anything. */
function visibleRows(): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>("[data-caveat-tone]")).filter(
    (el) => !el.closest("details"),
  );
}

function fold(): HTMLDetailsElement | null {
  return host.querySelector<HTMLDetailsElement>("details[data-caveat-notes]");
}

describe("Caveats", () => {
  it("shows the genuine warnings, and only those, above the fold", () => {
    render(ITEMS);
    const shown = visibleRows().map((el) => el.textContent);
    expect(shown).toHaveLength(2);
    expect(shown.join(" ")).toContain("excluded as corrupt");
    expect(shown.join(" ")).toContain("at 90% or above");
    expect(shown.join(" ")).not.toContain("first completed sitting");
  });

  it("gives a warning an amber surface, not just an amber icon", () => {
    render(ITEMS);
    // The defect was a tone that tinted the icon and nothing else, so a warning was
    // indistinguishable from boilerplate at a glance. The row itself has to carry it.
    for (const row of visibleRows()) {
      expect(row.className).toContain("bg-amber-500/10");
      expect(row.className).toContain("border-amber-500/40");
    }
  });

  it("keeps every unconditional note — folded, never dropped", () => {
    render(ITEMS);
    const details = fold();
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);

    const folded = Array.from(details!.querySelectorAll("[data-caveat-tone]")).map(
      (el) => el.textContent,
    );
    expect(folded).toHaveLength(4);

    // Nothing left the page: all six texts are still in the DOM, so find-in-page and a
    // teacher questioning a number can both still reach them.
    for (const item of ITEMS) {
      expect(host.textContent).toContain(item.text);
    }
  });

  it("names the fold and says how much is behind it", () => {
    render(ITEMS);
    const summary = host.querySelector("summary");
    expect(summary?.textContent).toContain(COUNTING_NOTES_SUMMARY);
    expect(summary?.textContent).toContain("4 notes");
  });

  it("renders no fold when every caveat is a warning", () => {
    render(ITEMS.filter((c) => c.tone === "warning"));
    expect(fold()).toBeNull();
    expect(visibleRows()).toHaveLength(2);
  });

  it("renders nothing at all when there is nothing to disclose", () => {
    render([]);
    expect(host.textContent).toBe("");
  });
});
