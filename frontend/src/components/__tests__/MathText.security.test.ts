/**
 * MathText.prepareRichText — Security regression tests
 *
 * `prepareRichText` is the security boundary between all authored academic content
 * and every render surface (student runner, author preview, review page).
 *
 * These tests MUST NOT be deleted or weakened. Any PR that makes previously
 * rejected payloads pass is a security regression.
 *
 * Test categories:
 *   A. Script injection
 *   B. Event handler injection
 *   C. Attribute injection on allowed tags
 *   D. Non-allowlisted tag removal
 *   E. Dangerous URL schemes
 *   F. Encoded / obfuscated attacks
 *   G. Allowlisted tags preserved correctly
 *   H. Math syntax preserved (must not corrupt LaTeX)
 *   I. Markdown formatting preserved
 *   J. Edge cases / malformed input
 */

import { describe, expect, it } from "vitest";
import { prepareRichText } from "../MathText";

// ── A. Script injection ───────────────────────────────────────────────────────

describe("A. Script injection", () => {
  it("removes <script>…</script> including inner content", () => {
    const out = prepareRichText("<script>alert(1)</script>safe text");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("safe text");
  });

  it("removes <script> with attributes", () => {
    const out = prepareRichText('<script type="text/javascript">evil()</script>ok');
    expect(out).not.toContain("evil()");
    expect(out).toContain("ok");
  });

  it("removes nested script tags", () => {
    const out = prepareRichText("<script><script>x</script></script>safe");
    expect(out).not.toContain("script");
    expect(out).toContain("safe");
  });

  it("removes <style> blocks including inner content", () => {
    const out = prepareRichText("<style>body{display:none}</style>visible");
    expect(out).not.toContain("<style");
    expect(out).not.toContain("body{display:none}");
    expect(out).toContain("visible");
  });

  it("removes <iframe> including src", () => {
    const out = prepareRichText('<iframe src="https://evil.com"></iframe>text');
    expect(out).not.toContain("iframe");
    expect(out).not.toContain("evil.com");
    expect(out).toContain("text");
  });
});

// ── B. Event handler injection ────────────────────────────────────────────────

describe("B. Event handler injection", () => {
  it("strips onclick from an allowlisted tag", () => {
    const out = prepareRichText('<b onclick="alert(1)">bold</b>');
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("<b>bold</b>");
  });

  it("strips onmouseover from <i>", () => {
    const out = prepareRichText('<i onmouseover="steal()">italic</i>');
    expect(out).not.toContain("onmouseover");
    expect(out).toContain("<i>italic</i>");
  });

  it("strips onerror from <img>", () => {
    const out = prepareRichText('<img src="x" onerror="alert(1)">after');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("img");
    expect(out).toContain("after");
  });

  it("strips onload from <svg>", () => {
    const out = prepareRichText('<svg onload="alert(1)"></svg>text');
    expect(out).not.toContain("onload");
    expect(out).not.toContain("svg");
    expect(out).toContain("text");
  });

  it("strips onerror from <sup> (allowlisted tag with event handler)", () => {
    const out = prepareRichText('<sup onerror="x()">2</sup>');
    expect(out).not.toContain("onerror");
    expect(out).toContain("<sup>2</sup>");
  });

  it("strips all data-* attributes from allowlisted tags", () => {
    const out = prepareRichText('<b data-payload="x">text</b>');
    expect(out).not.toContain("data-payload");
    expect(out).toContain("<b>text</b>");
  });

  it("strips class attribute from allowlisted tags (no style injection)", () => {
    const out = prepareRichText('<b class="text-red-500">text</b>');
    expect(out).not.toContain("class");
    expect(out).toContain("<b>text</b>");
  });

  it("strips style attribute from allowlisted tags", () => {
    const out = prepareRichText('<b style="color:red;display:none">text</b>');
    expect(out).not.toContain("style");
    expect(out).toContain("<b>text</b>");
  });
});

// ── C. Non-allowlisted tag removal ────────────────────────────────────────────

describe("C. Non-allowlisted tag removal", () => {
  it("removes <a> tags but preserves inner text", () => {
    const out = prepareRichText('<a href="javascript:evil()">click me</a>');
    expect(out).not.toContain("<a");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click me");
  });

  it("removes <div> tags", () => {
    const out = prepareRichText("<div>content</div>");
    expect(out).not.toContain("<div");
    expect(out).toContain("content");
  });

  it("removes <span> tags", () => {
    const out = prepareRichText('<span class="red">content</span>');
    expect(out).not.toContain("<span");
    expect(out).toContain("content");
  });

  it("removes <h1>–<h6> (no headings in academic answers)", () => {
    const out = prepareRichText("<h2>Heading</h2>");
    expect(out).not.toContain("<h");
    expect(out).toContain("Heading");
  });

  it("removes <table> and its contents (no tables in choices)", () => {
    const out = prepareRichText("<table><tr><td>cell</td></tr></table>");
    expect(out).not.toContain("<table");
    expect(out).not.toContain("<tr");
    expect(out).not.toContain("<td");
  });

  it("removes <ul> / <li> (no lists in choices)", () => {
    const out = prepareRichText("<ul><li>item</li></ul>");
    expect(out).not.toContain("<ul");
    expect(out).not.toContain("<li");
  });

  it("removes <object> and <embed>", () => {
    const out = prepareRichText('<object data="evil.swf"></object>text');
    expect(out).not.toContain("object");
    expect(out).not.toContain("evil.swf");
    expect(out).toContain("text");
  });
});

// ── D. Attribute injection on allowed tags ────────────────────────────────────

describe("D. Attribute injection hardening", () => {
  it("produces only <b> (no attributes) from any <b …> input", () => {
    const out = prepareRichText('<b id="x" data-x="y" onclick="z()">text</b>');
    // The only allowed output is exactly <b> ... </b>
    expect(out).toBe("<b>text</b>");
  });

  it("produces only <sup> from <sup …> with any attributes", () => {
    const out = prepareRichText('<sup class="superscript" id="s1">2</sup>');
    expect(out).toBe("<sup>2</sup>");
  });

  it("handles self-closing br correctly", () => {
    const out = prepareRichText("line1<br>line2");
    expect(out).toContain("<br>");
    expect(out).toContain("line1");
    expect(out).toContain("line2");
  });
});

// ── E. Dangerous URL schemes ──────────────────────────────────────────────────

describe("E. Dangerous URL schemes", () => {
  it("removes <a href='javascript:'>", () => {
    const out = prepareRichText('<a href="javascript:alert(1)">link</a>');
    expect(out).not.toContain("javascript:");
  });

  it("removes <a href='data:'>", () => {
    const out = prepareRichText('<a href="data:text/html,<script>alert(1)</script>">link</a>');
    expect(out).not.toContain("data:");
  });

  it("removes <img src='data:'>", () => {
    const out = prepareRichText('<img src="data:image/png;base64,abc">after');
    expect(out).not.toContain("data:");
    expect(out).not.toContain("<img");
    expect(out).toContain("after");
  });
});

// ── F. Encoded / obfuscated attacks ───────────────────────────────────────────

describe("F. Encoded and obfuscated attacks", () => {
  it("does not execute HTML entities as tags (&lt;script&gt; is safe text)", () => {
    const raw = "&lt;script&gt;alert(1)&lt;/script&gt;";
    const out = prepareRichText(raw);
    // HTML entities pass through as text — they are not executable
    expect(out).not.toContain("<script");
    expect(out).toBe(raw); // entities preserved as-is (safe text)
  });

  it("handles deeply nested attack: <b onclick=<script>x</script>>", () => {
    const out = prepareRichText("<b onclick=<script>x</script>>text</b>");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert");
  });

  it("handles mixed case tag names", () => {
    const out = prepareRichText("<SCRIPT>evil()</SCRIPT>safe");
    expect(out).not.toContain("evil()");
    expect(out).toContain("safe");
  });

  it("handles uppercase allowlisted tags — normalised to lowercase", () => {
    const out = prepareRichText("<B>bold</B>");
    expect(out).toContain("<b>bold</b>");
    expect(out).not.toContain("<B>");
  });

  it("handles extra whitespace in tag names — not a valid tag, treated as text", () => {
    // `< script >` with spaces is NOT a valid HTML tag in any browser.
    // Our regex requires the tag name immediately after `<`, so it also does
    // not match. The content passes through as inert literal text — which is
    // harmless because browsers will not execute it as a script.
    const out = prepareRichText("< script >evil()</ script >safe");
    // The result is literal text — no executable tags
    expect(out).not.toContain("<script");
    expect(out).toContain("safe");
    // "evil()" appears as visible text — inert, not executable
    // This is the correct secure behavior for this malformed input.
  });
});

// ── G. Allowlisted tags preserved correctly ───────────────────────────────────

describe("G. Allowlisted tags preserved", () => {
  it("preserves <b>bold</b>", () => {
    expect(prepareRichText("<b>bold</b>")).toBe("<b>bold</b>");
  });

  it("preserves <i>italic</i>", () => {
    expect(prepareRichText("<i>italic</i>")).toBe("<i>italic</i>");
  });

  it("preserves <em>emphasis</em>", () => {
    expect(prepareRichText("<em>emphasis</em>")).toBe("<em>emphasis</em>");
  });

  it("preserves <strong>strong</strong>", () => {
    expect(prepareRichText("<strong>strong</strong>")).toBe("<strong>strong</strong>");
  });

  it("preserves <sup>2</sup> (superscript — common in SAT math text)", () => {
    expect(prepareRichText("x<sup>2</sup>")).toBe("x<sup>2</sup>");
  });

  it("preserves <sub>0</sub> (subscript — common in chemistry/SAT)", () => {
    expect(prepareRichText("H<sub>2</sub>O")).toBe("H<sub>2</sub>O");
  });

  it("preserves <br> (line break — multiline answer text)", () => {
    const out = prepareRichText("line1<br>line2");
    expect(out).toContain("<br>");
  });
});

// ── H. Math syntax preservation ───────────────────────────────────────────────

describe("H. Math syntax preservation (must not corrupt LaTeX)", () => {
  it("preserves inline math \\( … \\)", () => {
    const math = "\\( x^2 + 1 = 0 \\)";
    expect(prepareRichText(math)).toBe(math);
  });

  it("preserves display math \\[ … \\]", () => {
    const math = "\\[ \\frac{1}{2} \\]";
    expect(prepareRichText(math)).toBe(math);
  });

  it("preserves $ inline math", () => {
    const math = "Answer is $x = 5$";
    expect(prepareRichText(math)).toBe(math);
  });

  it("preserves $$ display math", () => {
    const math = "$$\\int_0^1 x\\,dx = \\frac{1}{2}$$";
    expect(prepareRichText(math)).toBe(math);
  });

  it("preserves LaTeX with braces and backslashes", () => {
    const math = "\\( \\frac{a+b}{c} \\cdot \\sqrt{d} \\)";
    expect(prepareRichText(math)).toBe(math);
  });

  it("preserves LaTeX in presence of bold markdown", () => {
    const input = "**Simplify** \\( 2x + 3 = 7 \\)";
    const out = prepareRichText(input);
    expect(out).toContain("<b>Simplify</b>");
    expect(out).toContain("\\( 2x + 3 = 7 \\)");
  });

  it("does not corrupt angle brackets in LaTeX-like notation", () => {
    // LaTeX does not commonly use < > but trigonometry may use less/greater-than
    const input = "where \\( a < b \\) and \\( c > 0 \\)";
    const out = prepareRichText(input);
    // The < and > inside \( \) are text, not tags — they should survive
    expect(out).toContain("a < b");
    expect(out).toContain("c > 0");
  });

  it("preserves multi-line math (block math on separate lines)", () => {
    // \n is converted to <br> by applyNewlines — math syntax is preserved,
    // only the line-break mechanism changes (from whitespace to explicit <br>).
    const input = "Find \\( f(x) \\) where:\n\\[ f(x) = x^2 \\]";
    const out = prepareRichText(input);
    expect(out).toContain("\\( f(x) \\)");
    expect(out).toContain("\\[ f(x) = x^2 \\]");
    expect(out).toContain("<br>"); // \n → <br>
    expect(out).not.toContain("\n"); // bare newline removed
  });
});

// ── I. Markdown formatting ────────────────────────────────────────────────────

describe("I. Markdown formatting (SAT-safe subset)", () => {
  it("converts **bold** to <b>bold</b>", () => {
    expect(prepareRichText("**bold text**")).toBe("<b>bold text</b>");
  });

  it("converts *italic* to <i>italic</i>", () => {
    expect(prepareRichText("*italic text*")).toBe("<i>italic text</i>");
  });

  it("does not convert __underline__ (not in SAT subset)", () => {
    const out = prepareRichText("__not underlined__");
    expect(out).not.toContain("<u>");
    expect(out).not.toContain("<ins>");
  });

  it("does not convert # headings (explicitly forbidden)", () => {
    const out = prepareRichText("# Heading");
    expect(out).not.toContain("<h");
    expect(out).toContain("# Heading");
  });

  it("does not convert - list items (explicitly forbidden)", () => {
    const out = prepareRichText("- item one\n- item two");
    expect(out).not.toContain("<ul");
    expect(out).not.toContain("<li");
    expect(out).toContain("item one");
  });

  it("bold and italic can coexist in one string", () => {
    const out = prepareRichText("**bold** and *italic* together");
    expect(out).toBe("<b>bold</b> and <i>italic</i> together");
  });

  it("bold marker does not match across newlines (safety boundary)", () => {
    // applyNewlines converts \n → <br> before applyMarkdown runs.
    // The markdown regex excludes `<` so **line1<br>line2** does NOT match.
    const out = prepareRichText("**line1\nline2**");
    expect(out).not.toContain("<b>");
    expect(out).toContain("<br>"); // line break is preserved
  });
});

// ── J. Edge cases ─────────────────────────────────────────────────────────────

describe("J. Edge cases and malformed input", () => {
  it("handles empty string", () => {
    expect(prepareRichText("")).toBe("");
  });

  it("handles string with only whitespace", () => {
    expect(prepareRichText("   ")).toBe("   ");
  });

  it("converts bare newlines to <br> (textarea line-break preservation)", () => {
    expect(prepareRichText("line1\nline2")).toBe("line1<br>line2");
  });

  it("newline conversion does not affect security — <br> is allowlisted", () => {
    // A newline inside a dangerous tag pair is handled by stripDangerousTags first
    const out = prepareRichText("<script>evil()\n</script>safe\nnewline");
    expect(out).not.toContain("evil()");
    expect(out).toContain("safe<br>newline");
  });

  it("bold markers must not span newlines (cross-line bold is forbidden)", () => {
    // The markdown regex excludes `<` (in addition to `*` and `\n`) so that
    // after \n → <br> conversion, **text<br>text** cannot match as bold.
    // This prevents accidental large-region bolding across line breaks.
    const out = prepareRichText("**line1\nline2**");
    expect(out).not.toContain("<b>");
    expect(out).toContain("<br>"); // line break preserved
    expect(out).toContain("line1"); // content preserved
    expect(out).toContain("line2");
  });

  it("handles string with no special content", () => {
    expect(prepareRichText("plain text")).toBe("plain text");
  });

  it("handles unclosed tags gracefully (does not throw)", () => {
    expect(() => prepareRichText("<b>unclosed")).not.toThrow();
  });

  it("handles deeply nested allowed tags", () => {
    const out = prepareRichText("<b><i>bold italic</i></b>");
    expect(out).toContain("<b>");
    expect(out).toContain("<i>");
    expect(out).not.toContain("onclick");
  });

  it("handles very long string without performance cliff", () => {
    const long = "normal text ".repeat(1000) + "\\( x^2 \\)";
    expect(() => prepareRichText(long)).not.toThrow();
    const out = prepareRichText(long);
    expect(out).toContain("\\( x^2 \\)");
  });

  it("does not throw on null-like values coerced to string", () => {
    // Defensive: callers may pass String(value) which could be "undefined" or "null"
    expect(() => prepareRichText("undefined")).not.toThrow();
    expect(() => prepareRichText("null")).not.toThrow();
    expect(prepareRichText("undefined")).toBe("undefined");
  });
});
