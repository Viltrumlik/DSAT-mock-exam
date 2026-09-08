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

/**
 * A suspect answer key is held out of the rate on this row — the fix for a paper whose real
 * Math error rate was 0% and which reported "Math — 50%". The hold-out is right; a hold-out
 * nobody can see is not, because the row then prints a rate over fewer questions than its own
 * count implies and says nothing about it.
 */
describe("BreakdownList hold-outs", () => {
  it("puts the held-out count next to the count it was held out of", () => {
    render([row({ questions: 2, heldOut: 1, analysedQuestions: 1, wrong: 0, denominator: 12, errorRate: 0 })]);
    const counts = host.querySelector("[data-breakdown-counts]");
    expect(counts?.textContent).toContain("2 questions (1 held out)");
    // The counts beside the rate describe the same population the rate does.
    expect(counts?.textContent).toContain("0 wrong of 12 answers");
  });

  it("explains what the rate covers instead of leaving the shortfall to arithmetic", () => {
    render([row({ questions: 2, heldOut: 1, analysedQuestions: 1, errorRate: 0 })]);
    const note = host.querySelector("[data-held-out-note]");
    expect(note?.textContent).toContain("1 question here is at 90% or above");
    expect(note?.textContent).toContain("the rate above is over the other 1 question");
    expect(note?.textContent).toContain("still on the list to go over");
  });

  it("makes an all-suspect row explain its dash rather than read as missing data", () => {
    render([
      row({ questions: 1, heldOut: 1, analysedQuestions: 0, wrong: 0, denominator: 0, errorRate: null }),
    ]);
    expect(host.textContent).toContain("—");
    // "0 wrong of 0 answers" would say the class answered nothing. It answered everything.
    const counts = host.querySelector("[data-breakdown-counts]");
    expect(counts?.textContent).toContain("1 question (1 held out) · nothing left to average");
    expect(counts?.textContent).not.toContain("0 wrong of 0 answers");

    const note = host.querySelector("[data-held-out-note]");
    expect(note?.textContent).toContain("The one question here is at 90% or above");
    expect(note?.textContent).toContain("that dash is not a zero, and nothing is missing");
  });

  it("gives that dash the right reason, not the empty-denominator one", () => {
    // Both reasons arrive as `null` and ask for opposite actions: wait for answers, versus go
    // and read the answer key. The tooltip is the only place the row can tell them apart.
    render([row({ questions: 1, heldOut: 1, analysedQuestions: 0, errorRate: null })]);
    const dash = [...host.querySelectorAll("span")].find((el) => el.textContent === "—");
    expect(dash?.getAttribute("title")).toContain("held out as a likely broken answer key");
    expect(dash?.getAttribute("title")).not.toContain("No answers to divide by yet");
  });

  it("leaves a row with nothing held out exactly as it was", () => {
    // The assessments endpoint has no hold-out concept and passes neither field.
    render([row()]);
    expect(host.querySelector("[data-held-out-note]")).toBeNull();
    expect(host.querySelector("[data-breakdown-counts]")?.textContent).toBe(
      "1 question · 6 wrong of 16 answers · 1 to go over",
    );
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
