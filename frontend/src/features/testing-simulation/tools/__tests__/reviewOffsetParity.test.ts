/**
 * The claim the whole review feature rests on: **a mark lands on the words the student put it
 * on.**
 *
 * Annotations are character offsets into a region's *rendered* text. The runner recorded them
 * against its own renderer; the review page has to reproduce the same text or every offset
 * shifts and the highlight covers the wrong words — a failure that looks like a rendering
 * quirk rather than a data bug, and that no type or lint can catch.
 *
 * So this walks the real pipelines over the real fields and asserts, character for character,
 * that the offsets recorded on one surface select the same substring on the other.
 */
import { describe, expect, it } from "vitest";

import { applyAnnotations, type Annotation } from "../highlight/annotations";
import { renderExamHtml } from "../../utils/richContent";
import { processInstructionalText } from "@/lib/assessmentText";

/** What the annotator sees: the rendered text of a region, as one string. */
function renderedText(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el.textContent ?? "";
}

/** Paint a range and read back what ended up inside the <mark>. */
function markedText(html: string, range: Annotation): string {
  const el = document.createElement("div");
  el.innerHTML = html;
  applyAnnotations(el, [range]);
  return Array.from(el.querySelectorAll("mark")).map((m) => m.textContent).join("");
}

function offsetsOf(text: string, needle: string): Annotation {
  const start = text.indexOf(needle);
  expect(start, `"${needle}" should appear in the rendered text`).toBeGreaterThanOrEqual(0);
  return { start, end: start + needle.length, kind: "highlight", color: "yellow" };
}

const SAMPLES = [
  "The author argues that the practice was widespread.",
  "Solve for x when \\( x^2 + 3x - 4 = 0 \\) and check the result.",
  "The term **stimulus** is used loosely here; *note* the distinction.",
  "Water freezes at 0<sup>o</sup>C under standard pressure.",
  "Compare A &amp; B, then decide whether 3 < 5 holds.",
  "Line one\nLine two follows immediately.",
];

describe("exam / pastpaper — runner and review render the same text", () => {
  // Both call renderExamHtml over the same field: the runner on `question.question_text`
  // (PassagePane), review on `review.questions[].text`, which IS `Question.question_text`.
  // Comparing that function to itself would prove nothing, so what is asserted instead is
  // that a range picked out of the rendered text paints back exactly the words it named —
  // over content that has historically broken offsets: math, markdown, entities, newlines.
  it.each(SAMPLES)("a mark round-trips through: %s", (source) => {
    const html = renderExamHtml(source);
    const text = renderedText(html);
    // A slice from the middle, so any drift at either end shows up.
    const needle = text.slice(4, Math.max(10, Math.floor(text.length / 2)));
    expect(markedText(html, offsetsOf(text, needle))).toBe(needle);
  });

  it("a range recorded in the runner selects the same words in review", () => {
    const source = "The author argues that the practice was widespread.";
    const runnerHtml = renderExamHtml(source);
    const range = offsetsOf(renderedText(runnerHtml), "the practice");

    // Review renders through the same pipeline, so the same offsets must select the same run.
    expect(markedText(renderExamHtml(source), range)).toBe("the practice");
  });

  it("survives markdown, which is where a renderer swap goes wrong", () => {
    // MathText and renderExamHtml both turn **bold** into an element. A renderer that did
    // NOT would leave four extra asterisks in the text and shift every later offset.
    const source = "The term **stimulus** is used loosely here.";
    const text = renderedText(renderExamHtml(source));
    expect(text).not.toContain("**");
    expect(markedText(renderExamHtml(source), offsetsOf(text, "used loosely"))).toBe("used loosely");
  });
});

describe("assessment — runner and review render the same text", () => {
  // The runner draws `prompt` and `question_prompt` through processInstructionalText
  // (StableHtml); review now does the same, where it used to use AssessmentText — which
  // wraps that very function, so the string is unchanged.
  it.each(SAMPLES)("a mark round-trips through: %s", (source) => {
    const html = processInstructionalText(source);
    const text = renderedText(html);
    const needle = text.slice(4, Math.max(10, Math.floor(text.length / 2)));
    expect(markedText(html, offsetsOf(text, needle))).toBe(needle);
  });

  it("a range recorded in the runner selects the same words in review", () => {
    const source = "Which choice best states the main purpose of the text?";
    const html = processInstructionalText(source);
    const range = offsetsOf(renderedText(html), "main purpose");
    expect(markedText(processInstructionalText(source), range)).toBe("main purpose");
  });
});

describe("what shifts an offset, so the limits stay honest", () => {
  it("text added inside a region moves every later mark", () => {
    // Exactly why the answer-choices container is NOT painted in review: it gains
    // "Correct"/"Incorrect" labels that the runner never showed.
    const source = "Paris is the capital.";
    const text = renderedText(renderExamHtml(source));
    const range = offsetsOf(text, "capital");

    const withPrefix = renderExamHtml(`Correct — ${source}`);
    expect(markedText(withPrefix, range)).not.toBe("capital");
  });
});
