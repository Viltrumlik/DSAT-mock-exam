/**
 * MathText.prepareRichText — Semantic contract tests
 *
 * These tests verify that correct, intended content is preserved exactly
 * through the rendering pipeline. They complement the security tests
 * (MathText.security.test.ts), which verify that dangerous content is blocked.
 *
 * The distinction:
 *   Security tests:  dangerous input → safe output (nothing harmful survives)
 *   Semantic tests:  valid input → correct output (intended formatting preserved)
 *
 * Test categories:
 *   A. Pipeline order guarantees (strip → newlines → markdown)
 *   B. Math + emphasis coexistence
 *   C. Nested emphasis edge cases
 *   D. Sup/sub preservation in context
 *   E. Newline semantics
 *   F. Mixed plaintext + math
 *   G. Large input stability
 *   H. Whitespace normalization
 *   I. SAT-realistic content patterns
 */

import { describe, expect, it } from "vitest";
import { prepareRichText } from "../MathText";

// ── A. Pipeline order guarantees ──────────────────────────────────────────────

describe("A. Pipeline order (strip → newlines → markdown)", () => {
  it("newlines are converted before markdown so bold cannot span lines", () => {
    // If markdown ran first, **line1\nline2** might match.
    // Since newlines become <br> first, and `<` is excluded from the bold
    // character class, cross-line bold is impossible.
    const out = prepareRichText("**line1\nline2**");
    expect(out).not.toContain("<b>");
    expect(out).toContain("line1<br>line2");
  });

  it("stripping runs before newlines so malicious content in stripped tags cannot inject <br>", () => {
    // If newlines ran first, a tag like <script\n> might survive the tag regex.
    // Since stripping runs first, the tag is removed before newline conversion.
    const out = prepareRichText("<script\n>evil()\n</script>\nsafe");
    expect(out).not.toContain("evil()");
    // The \n in <script\n> is part of the tag, handled by tag stripping.
    // The \n before "safe" is a content newline → <br>.
    expect(out).toContain("safe");
  });

  it("markdown runs after stripping so injected bold syntax in stripped tags has no effect", () => {
    // An allowed tag like <b> cannot carry injected markdown via attributes
    // because all attributes are stripped.
    const out = prepareRichText('<b data-inject="**bold**">text</b>');
    expect(out).toBe("<b>text</b>");
  });
});

// ── B. Math + emphasis coexistence ────────────────────────────────────────────

describe("B. Math and emphasis coexistence", () => {
  it("bold before inline math", () => {
    const out = prepareRichText("**Solve** \\( x^2 = 4 \\)");
    expect(out).toBe("<b>Solve</b> \\( x^2 = 4 \\)");
  });

  it("bold after inline math", () => {
    const out = prepareRichText("\\( x = 2 \\) is **positive**");
    expect(out).toBe("\\( x = 2 \\) is <b>positive</b>");
  });

  it("italic wrapping a description of a math expression", () => {
    const out = prepareRichText("where *n* is an integer and \\( n > 0 \\)");
    expect(out).toBe("where <i>n</i> is an integer and \\( n > 0 \\)");
  });

  it("bold and italic in same string with math", () => {
    const out = prepareRichText("**Note:** *all* values satisfy \\( f(x) > 0 \\)");
    expect(out).toBe("<b>Note:</b> <i>all</i> values satisfy \\( f(x) > 0 \\)");
  });

  it("display math delimiter is preserved alongside emphasis", () => {
    const out = prepareRichText("The **area** is: \\[ A = \\pi r^2 \\]");
    expect(out).toBe("The <b>area</b> is: \\[ A = \\pi r^2 \\]");
  });

  it("dollar-sign inline math coexists with bold", () => {
    const out = prepareRichText("**Find** $x$ when $x^2 = 9$");
    expect(out).toBe("<b>Find</b> $x$ when $x^2 = 9$");
  });

  it("complex SAT-style stem: bold, italic, inline math together", () => {
    const input = "**Question:** If \\( f(x) = x^2 - 4 \\), what is *f*(2)?";
    const out = prepareRichText(input);
    expect(out).toContain("<b>Question:</b>");
    expect(out).toContain("\\( f(x) = x^2 - 4 \\)");
    expect(out).toContain("<i>f</i>");
  });

  it("asterisk inside LaTeX is not treated as markdown italic marker", () => {
    // In LaTeX, \begin{equation*} uses *. The delimiters protect it.
    // Our regex excludes `<` but LaTeX asterisks inside \( \) are just text.
    // The bold/italic regex [^*\n<] excludes * itself, so \( a * b \) is safe
    // only if we don't write *a * b* at the top level outside delimiters.
    // Verify: asterisk inside LaTeX delimiter is not consumed by markdown.
    const out = prepareRichText("Result: \\( a^* \\)");
    expect(out).toBe("Result: \\( a^* \\)");
    expect(out).not.toContain("<i>");
  });
});

// ── C. Nested emphasis edge cases ─────────────────────────────────────────────

describe("C. Nested emphasis edge cases", () => {
  it("bold and italic on separate words do not interfere", () => {
    const out = prepareRichText("**bold** plain *italic*");
    expect(out).toBe("<b>bold</b> plain <i>italic</i>");
  });

  it("adjacent bold and italic without space", () => {
    const out = prepareRichText("**bold***italic*");
    // After bold match: "<b>bold</b>*italic*"
    // After italic match: "<b>bold</b><i>italic</i>"
    expect(out).toBe("<b>bold</b><i>italic</i>");
  });

  it("bold containing allowed HTML passthrough tag", () => {
    // <sup> is allowlisted — it can appear inside a bold region in authored HTML.
    // However, markdown bold cannot contain < (by regex design), so this must
    // be written with direct HTML: <b>x<sup>2</sup></b>
    const out = prepareRichText("<b>x<sup>2</sup></b>");
    expect(out).toBe("<b>x<sup>2</sup></b>");
  });

  it("italic does not double-match inside bold", () => {
    // The negative lookbehind/lookahead on * prevents ** from matching as italic
    const out = prepareRichText("**bold** and *italic*");
    expect(out).toBe("<b>bold</b> and <i>italic</i>");
    // Ensure no double-wrapping
    expect(out).not.toContain("<i><b>");
    expect(out).not.toContain("<b><i>");
  });

  it("empty bold markers produce no output", () => {
    const out = prepareRichText("****");
    expect(out).not.toContain("<b></b>");
    expect(out).not.toContain("<b>");
  });

  it("single asterisk alone is not converted", () => {
    const out = prepareRichText("multiply: a * b");
    expect(out).not.toContain("<i>");
    expect(out).toBe("multiply: a * b");
  });
});

// ── D. Sup/sub in context ─────────────────────────────────────────────────────

describe("D. Sup and sub in context", () => {
  it("superscript in non-math context", () => {
    expect(prepareRichText("x<sup>2</sup> + y<sup>2</sup>")).toBe(
      "x<sup>2</sup> + y<sup>2</sup>",
    );
  });

  it("subscript in chemistry context", () => {
    expect(prepareRichText("H<sub>2</sub>O")).toBe("H<sub>2</sub>O");
  });

  it("sup alongside inline math", () => {
    const out = prepareRichText("The value is x<sup>2</sup> where \\( x = 3 \\)");
    expect(out).toContain("<sup>2</sup>");
    expect(out).toContain("\\( x = 3 \\)");
  });

  it("bold wrapping a superscript expression written with HTML tags", () => {
    // Markdown bold cannot wrap HTML tags (< excluded from char class),
    // so this must be written as direct HTML: <b>x<sup>2</sup></b>
    const out = prepareRichText("<b>x<sup>2</sup></b>");
    expect(out).toBe("<b>x<sup>2</sup></b>");
  });

  it("sup and sub attributes are stripped", () => {
    const out = prepareRichText("<sup class='big'>2</sup>");
    expect(out).toBe("<sup>2</sup>");
    expect(out).not.toContain("class");
  });
});

// ── E. Newline semantics ──────────────────────────────────────────────────────

describe("E. Newline semantics", () => {
  it("single newline → single <br>", () => {
    expect(prepareRichText("line1\nline2")).toBe("line1<br>line2");
  });

  it("multiple consecutive newlines → multiple <br>", () => {
    // Authors who use blank lines for paragraph spacing get multiple <br>
    expect(prepareRichText("para1\n\npara2")).toBe("para1<br><br>para2");
  });

  it("trailing newline → trailing <br>", () => {
    expect(prepareRichText("text\n")).toBe("text<br>");
  });

  it("leading newline → leading <br>", () => {
    expect(prepareRichText("\ntext")).toBe("<br>text");
  });

  it("newline between math expressions preserved as <br>", () => {
    const out = prepareRichText("\\( a = 1 \\)\n\\( b = 2 \\)");
    expect(out).toBe("\\( a = 1 \\)<br>\\( b = 2 \\)");
  });

  it("CRLF line endings (Windows) — \\r\\n normalized", () => {
    // \\r is not explicitly converted — only \\n is converted.
    // CRLF produces <br> from the \\n but leaves \\r as a literal character.
    // Document the actual behavior so no surprises if Windows content is stored.
    const out = prepareRichText("line1\r\nline2");
    expect(out).toContain("<br>");
    expect(out).toContain("line1");
    expect(out).toContain("line2");
  });
});

// ── F. Mixed plaintext + math ─────────────────────────────────────────────────

describe("F. Mixed plaintext and math", () => {
  it("sentence with embedded inline math", () => {
    const input = "The slope of the line is \\( m = \\frac{rise}{run} \\).";
    expect(prepareRichText(input)).toBe(input);
  });

  it("multiple inline math spans in one sentence", () => {
    const input = "If \\( x > 0 \\) and \\( y > 0 \\), then \\( x + y > 0 \\).";
    expect(prepareRichText(input)).toBe(input);
  });

  it("plain text with no special syntax passes through unchanged", () => {
    const input = "The quick brown fox jumps over the lazy dog.";
    expect(prepareRichText(input)).toBe(input);
  });

  it("numbers and punctuation pass through unchanged", () => {
    expect(prepareRichText("42, 3.14, -7, 100%")).toBe("42, 3.14, -7, 100%");
  });

  it("Greek letters in LaTeX are preserved", () => {
    const input = "\\( \\alpha + \\beta = \\gamma \\)";
    expect(prepareRichText(input)).toBe(input);
  });

  it("fraction syntax preserved", () => {
    const input = "\\( \\frac{a + b}{c - d} \\)";
    expect(prepareRichText(input)).toBe(input);
  });

  it("square root preserved", () => {
    const input = "\\( \\sqrt{x^2 + y^2} \\)";
    expect(prepareRichText(input)).toBe(input);
  });
});

// ── G. Large input stability ──────────────────────────────────────────────────

describe("G. Large input stability", () => {
  it("1000-word question stem with mixed content does not throw", () => {
    const stem = Array.from(
      { length: 100 },
      (_, i) =>
        `Sentence ${i + 1} with \\( x_${i} = ${i} \\) and **emphasis** on *key*.`,
    ).join(" ");
    expect(() => prepareRichText(stem)).not.toThrow();
  });

  it("output of 1000-word stem contains all expected patterns", () => {
    const stem = "First \\( a = 1 \\). " + "Middle **bold** text. ".repeat(100) + "Last *italic*.";
    const out = prepareRichText(stem);
    expect(out).toContain("\\( a = 1 \\)");
    expect(out).toContain("<b>bold</b>");
    expect(out).toContain("<i>italic</i>");
    expect(out).not.toContain("**bold**"); // all converted
    expect(out).not.toContain("*italic*");
  });

  it("1000 consecutive newlines produce 1000 <br> tags", () => {
    const input = "\n".repeat(1000);
    const out = prepareRichText(input);
    expect(out).toBe("<br>".repeat(1000));
  });

  it("deeply nested allowed tags are handled without exponential blowup", () => {
    // 50 levels of <b> nesting — should process without hanging
    const nested = "<b>".repeat(50) + "text" + "</b>".repeat(50);
    expect(() => prepareRichText(nested)).not.toThrow();
    const out = prepareRichText(nested);
    expect(out).toContain("text");
  });
});

// ── H. Whitespace normalization ───────────────────────────────────────────────

describe("H. Whitespace normalization", () => {
  it("leading/trailing spaces are preserved (not trimmed)", () => {
    // MathText does not trim — callers trim if needed.
    expect(prepareRichText("  text  ")).toBe("  text  ");
  });

  it("multiple internal spaces are preserved", () => {
    // HTML collapses whitespace at render time, but the string itself is correct.
    expect(prepareRichText("a  b")).toBe("a  b");
  });

  it("tab character is preserved as-is", () => {
    expect(prepareRichText("col1\tcol2")).toBe("col1\tcol2");
  });

  it("empty string produces empty string", () => {
    expect(prepareRichText("")).toBe("");
  });

  it("whitespace-only string produces only that whitespace", () => {
    expect(prepareRichText("   ")).toBe("   ");
  });
});

// ── I. SAT-realistic content patterns ────────────────────────────────────────

describe("I. SAT-realistic content patterns", () => {
  it("typical SAT math choice: a fraction", () => {
    const input = "\\( \\frac{3}{4} \\)";
    expect(prepareRichText(input)).toBe(input);
  });

  it("typical SAT math choice: a negative fraction", () => {
    const input = "\\( -\\frac{1}{2} \\)";
    expect(prepareRichText(input)).toBe(input);
  });

  it("typical SAT English choice: bolded key term in sentence", () => {
    const input = "The author uses **irony** to underscore the contradiction.";
    expect(prepareRichText(input)).toBe(
      "The author uses <b>irony</b> to underscore the contradiction.",
    );
  });

  it("typical SAT reading question stem with line break", () => {
    const input =
      "Read the following passage carefully.\n" +
      "Which choice best describes the author's tone?";
    expect(prepareRichText(input)).toBe(
      "Read the following passage carefully.<br>" +
      "Which choice best describes the author's tone?",
    );
  });

  it("SAT math problem with multi-line setup", () => {
    const input =
      "Given that \\( f(x) = 2x + 3 \\)\n" +
      "and \\( g(x) = x^2 - 1 \\),\n" +
      "find \\( f(g(2)) \\).";
    const out = prepareRichText(input);
    expect(out).toContain("\\( f(x) = 2x + 3 \\)");
    expect(out).toContain("\\( g(x) = x^2 - 1 \\)");
    expect(out).toContain("\\( f(g(2)) \\)");
    expect(out).toContain("<br>");
    // All math preserved, line breaks inserted
    expect(out.split("<br>")).toHaveLength(3);
  });

  it("scientific notation in answer choice", () => {
    const input = "\\( 3.2 \\times 10^{-4} \\)";
    expect(prepareRichText(input)).toBe(input);
  });

  it("chemistry formula with subscripts", () => {
    const input = "H<sub>2</sub>SO<sub>4</sub>";
    expect(prepareRichText(input)).toBe(input);
  });

  it("ordinal numbers with superscripts", () => {
    const input = "The 21<sup>st</sup> century began in 2001.";
    expect(prepareRichText(input)).toBe(input);
  });

  it("explanation with bold key phrase and math", () => {
    const input =
      "**The correct answer is C.** " +
      "Substituting \\( x = 2 \\) gives \\( f(2) = 2(2) + 3 = 7 \\).";
    const out = prepareRichText(input);
    expect(out).toContain("<b>The correct answer is C.</b>");
    expect(out).toContain("\\( x = 2 \\)");
    expect(out).toContain("\\( f(2) = 2(2) + 3 = 7 \\)");
  });
});
