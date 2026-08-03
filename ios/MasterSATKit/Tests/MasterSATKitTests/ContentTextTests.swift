import Testing
@testable import MasterSATKit

/// `ContentText` is a security boundary, not a formatter. The web's copy of this pipeline
/// carries its own regression suite (`MathText.security.test.ts`) with the note "do NOT
/// change this file without running those tests" — so the port gets the same treatment.
@Suite("Authored content")
struct ContentTextTests {

    // MARK: - Security

    @Test("A script tag takes its contents with it")
    func stripsScriptBodies() {
        // Removing only the tags would leave `evil()` on screen as text.
        #expect(ContentText.prepare("<script>evil()</script>ok") == "ok")
        #expect(ContentText.prepare("<style>body{}</style>ok") == "ok")
        #expect(ContentText.prepare("<iframe src='x'>hi</iframe>ok") == "ok")
    }

    @Test("Allowlisted tags survive; their attributes never do")
    func stripsAttributes() {
        #expect(ContentText.prepare("<b onclick=\"steal()\">x</b>") == "<b>x</b>")
        #expect(ContentText.prepare("<B CLASS='a'>x</B>") == "<b>x</b>")
        #expect(ContentText.prepare("<sup>2</sup>") == "<sup>2</sup>")
        #expect(ContentText.prepare("<sub>2</sub>") == "<sub>2</sub>")
    }

    @Test("Anything not on the list is dropped, content kept")
    func dropsUnlistedTags() {
        #expect(ContentText.prepare("<a href='javascript:x'>click</a>") == "click")
        #expect(ContentText.prepare("<img src=x onerror=y>") == "")
        #expect(ContentText.prepare("<div><p>text</p></div>") == "text")
    }

    // MARK: - Emphasis

    @Test("Markdown emphasis becomes tags")
    func convertsEmphasis() {
        #expect(ContentText.prepare("**bold**") == "<b>bold</b>")
        #expect(ContentText.prepare("*italic*") == "<i>italic</i>")
        // Bold has to be matched first, or `**x**` comes out as two italics.
        #expect(ContentText.prepare("**a** and *b*") == "<b>a</b> and <i>b</i>")
    }

    @Test("Emphasis never spans a real line break")
    func emphasisStopsAtNewline() {
        // An author who pressed return in the middle almost certainly did not mean one
        // emphasis span, so this stays literal — and the newline still becomes a <br>.
        #expect(ContentText.prepare("**bold\ntext**") == "**bold<br>text**")
    }

    @Test("Newlines become breaks")
    func convertsNewlines() {
        #expect(ContentText.prepare("a\nb") == "a<br>b")
    }

    // MARK: - Maths is left alone

    @Test("LaTeX delimiters are never touched")
    func preservesMath() {
        // KaTeX runs later, over the rendered DOM. Anything this pass mangles is a formula
        // a student never gets to see.
        #expect(ContentText.prepare("$x^2$") == "$x^2$")
        #expect(ContentText.prepare("\\(a\\)") == "\\(a\\)")
        #expect(ContentText.prepare("$$\\frac{a}{b}$$") == "$$\\frac{a}{b}$$")
        #expect(ContentText.prepare("\\[ x \\]") == "\\[ x \\]")
    }

    @Test("An asterisk in maths is not emphasis")
    func doesNotEmphasiseInsideMath() {
        // `2 * 3` has one asterisk and no closer, so nothing should change.
        #expect(ContentText.prepare("2 * 3 = 6") == "2 * 3 = 6")
    }

    // MARK: - Which strings need the renderer

    @Test("Maths needs the renderer even with no angle bracket in sight")
    func detectsMath() {
        // This is the check that was wrong: it tested only for `<` and `&`, so `$x^2$` took
        // the plain-text path and a student saw raw dollar signs mid-question.
        #expect(ContentText.needsRendering("$x^2$"))
        #expect(ContentText.needsRendering("\\(a\\)"))
        #expect(ContentText.needsRendering("**bold**"))
        #expect(ContentText.needsRendering("*italic*"))
        #expect(ContentText.needsRendering("H<sub>2</sub>O"))
        #expect(ContentText.needsRendering("two\nlines"))
    }

    @Test("Plain prose takes the cheap path")
    func plainTextSkipsTheRenderer() {
        // A web view per answer choice is four per question, rebuilt on every navigation.
        #expect(!ContentText.needsRendering("What is the slope of the line?"))
        #expect(!ContentText.needsRendering("2 * 3"))
        #expect(!ContentText.needsRendering(""))
    }

    // MARK: - Previews

    @Test("A preview unwraps maths instead of showing its delimiters")
    func previewStripsDelimiters() {
        #expect(ContentText.plainPreview("Solve $x^2 + 1$ now") == "Solve x^2 + 1 now")
        #expect(ContentText.plainPreview("<b>Hi</b> &amp; bye") == "Hi & bye")
    }
}
