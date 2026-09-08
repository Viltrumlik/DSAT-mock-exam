/**
 * The breakdowns exist to be compared with each other, so the bar that carries a percentage
 * has to mean the same thing in every card.
 *
 * It did not: the track was the card's width, and one card spanned two grid columns, so a
 * 63% bar rendered ~410px beside a 65% bar at ~185px — the longer bar was the smaller
 * number, side by side, in the one section whose job is comparison.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BAR_TRACK_CLASS,
  BREAKDOWN_GRID_STYLE,
  BreakdownList,
  type BreakdownRow,
} from "../components/BreakdownList";

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

const row = (over: Partial<BreakdownRow> = {}): BreakdownRow => ({
  id: "cross-text",
  label: "Cross-Text Connections",
  questions: 1,
  wrong: 6,
  denominator: 16,
  errorRate: 38,
  flagged: 1,
  isUntagged: false,
  ...over,
});

function render(rows: BreakdownRow[], note?: string | null) {
  act(() =>
    root.render(
      <BreakdownList
        title="SAT skill"
        rows={rows}
        denominatorNoun="answers"
        note={note}
        emptyMessage="No skill breakdown for this paper."
      />,
    ),
  );
}

function tracks(): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>("[data-bar-track]"));
}

describe("BreakdownList bars", () => {
  it("draws every bar in one fixed track, whatever the card is doing", () => {
    // A fixed track is the whole fix: a card that is twice as wide can no longer draw a
    // smaller percentage as a longer bar.
    expect(BAR_TRACK_CLASS).toContain("w-40");
    // `max-w-full` is fine and `w-full` is the bug, so match whole classes, not substrings.
    expect(BAR_TRACK_CLASS.split(/\s+/)).not.toContain("w-full");

    render([row({ id: "a", errorRate: 63 }), row({ id: "b", errorRate: 65 })]);
    const found = tracks();
    expect(found).toHaveLength(2);
    for (const track of found) expect(track.className).toBe(BAR_TRACK_CLASS);
  });

  it("still refuses to draw a bar for a rate it does not know", () => {
    render([row({ errorRate: null })]);
    const [track] = tracks();
    expect(track.children).toHaveLength(0);
    expect(host.textContent).toContain("—");
  });

  it("lets a long skill name wrap instead of cutting it off", () => {
    // "Cross-Text Connections" needs ~197px and got an 111px box at the old breakpoint.
    // The name is the answer this row exists to give; half of it is not an answer.
    render([row()]);
    const label = host.querySelector<HTMLElement>("[data-breakdown-label]");
    expect(label?.textContent).toBe("Cross-Text Connections");
    expect(label!.className).not.toContain("truncate");
  });

  it("marks an untagged bucket rather than passing it off as a topic", () => {
    render([row({ id: "untagged", label: "Untagged", isUntagged: true })]);
    expect(host.textContent).toContain("Untagged");
    expect(host.textContent).toContain("No tag");
  });

  it("renders the coverage note rather than an unexplained short list", () => {
    render([], "2 of 12 questions carry no skill.");
    expect(host.textContent).toContain("2 of 12 questions carry no skill.");
    expect(host.textContent).toContain("No skill breakdown for this paper.");
  });
});

describe("BREAKDOWN_GRID_STYLE", () => {
  it("tracks the container, not the viewport", () => {
    // `lg:grid-cols-3` fired at a 1024px VIEWPORT while the teacher shell left the page
    // ~752px, so three columns arrived ~110px wide. `auto-fit` measures the box the cards
    // are actually in.
    expect(BREAKDOWN_GRID_STYLE.gridTemplateColumns).toContain("auto-fit");
    expect(BREAKDOWN_GRID_STYLE.gridTemplateColumns).toContain("18rem");
  });

  it("starts the cards at the top so a short one leaves no void", () => {
    // Stretched rows gave "Question type" and "Format" 250–350px of dead space each: a grid
    // row is as tall as its tallest card.
    expect(BREAKDOWN_GRID_STYLE.alignItems).toBe("start");
  });
});
