/**
 * assessmentText — flowSoftWraps + processInstructionalText contract tests
 *
 * flowSoftWraps is the assessment-only reflow step: a single ("soft") newline
 * from the authoring textarea or pasted, pre-wrapped source text collapses to a
 * space so prose fills the container at any width, while a blank line (2+
 * newlines) stays as an intentional paragraph break. This is what stops
 * passages from stranding short mid-sentence fragments at the wide student width
 * while looking fine in the narrow builder preview.
 *
 * Scope: assessment surfaces only. MathText / the exam runner keep the literal
 * \n → <br> contract and are intentionally NOT covered here.
 */

import { describe, expect, it } from "vitest";
import { flowSoftWraps, processInstructionalText } from "../assessmentText";

// The exact passage from the reported bug (hard \n after "bat-like" and
// "For instance," — line-wrap artifacts, not authored breaks).
const DINO_PASSAGE =
  "When people think of dinosaurs with feathers, they typically think of winged dinosaurs, such as the bat-like\n" +
  "Ambopteryx. However, many dinosaurs that didn't have wings also had feathers on their bodies. For instance,\n" +
  "research indicates that the wingless large Yutyrannus likely had feathers.";

describe("flowSoftWraps — single-newline soft wraps", () => {
  it("collapses a lone newline to a space", () => {
    expect(flowSoftWraps("line one\nline two")).toBe("line one line two");
  });

  it("reflows the reported passage into one continuous line (no stray breaks)", () => {
    const out = flowSoftWraps(DINO_PASSAGE);
    expect(out).not.toContain("\n");
    expect(out).toContain("such as the bat-like Ambopteryx.");
    expect(out).toContain("For instance, research indicates");
  });

  it("collapses runs of spaces/tabs around a soft newline to a single space", () => {
    expect(flowSoftWraps("a  \n  b")).toBe("a b");
    expect(flowSoftWraps("a\t\n\tb")).toBe("a b");
  });
});

describe("flowSoftWraps — intentional paragraph breaks are preserved", () => {
  it("keeps a blank line as a paragraph separator", () => {
    expect(flowSoftWraps("para one\n\npara two")).toBe("para one\n\npara two");
  });

  it("reflows soft wraps within each paragraph but keeps the paragraph break", () => {
    expect(flowSoftWraps("a\nb\n\nc\nd")).toBe("a b\n\nc d");
  });

  it("collapses 3+ newlines to a single paragraph break", () => {
    expect(flowSoftWraps("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("trims stray leading/trailing newlines", () => {
    expect(flowSoftWraps("\ntext\n")).toBe("text");
  });
});

describe("processInstructionalText — end-to-end HTML", () => {
  it("renders the reported passage with NO <br> (continuous prose)", () => {
    const html = processInstructionalText(DINO_PASSAGE);
    expect(html).not.toContain("<br>");
    expect(html).not.toContain("bat-like<br>");
  });

  it("renders an intentional blank line as a <br><br> paragraph break", () => {
    const html = processInstructionalText("para one\n\npara two");
    expect(html).toContain("<br><br>");
  });

  it("still applies bold markdown across a former soft wrap", () => {
    // A single newline is now a space, so bold spanning a wrapped line is one phrase.
    const html = processInstructionalText("**bold\nphrase**");
    expect(html).toContain("<b>bold phrase</b>");
  });

  it("still renders fill-in-the-blank underscores as a styled blank", () => {
    const html = processInstructionalText("Fill the ____ here");
    expect(html).toContain('class="ms-blank"');
  });

  it("still preserves LaTeX delimiters for KaTeX", () => {
    const html = processInstructionalText("Solve \\( x^2 = 4 \\)");
    expect(html).toContain("katex");
  });
});
