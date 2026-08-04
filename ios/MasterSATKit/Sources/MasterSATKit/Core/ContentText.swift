import Foundation

/// The sanitiser from `frontend/src/components/MathText.tsx`, ported line for line.
///
/// Authored SAT content is not HTML and it is not markdown. It is a narrow dialect:
/// LaTeX between `\( \)`, `\[ \]`, `$ … $` or `$$ … $$`; `**bold**` and `*italic*`; and a
/// frozen allowlist of eight inline tags. Everything else — links, images, block elements,
/// scripts — is removed.
///
/// This runs BEFORE the content reaches a web view, which is what lets that web view run
/// JavaScript at all: after this pass there is no `<img>`, no `<a>` and no `<iframe>` left
/// in the string, so the page has nothing that could reach the network. The promise that
/// question content stays offline is kept *here*, not by a setting.
///
/// The pipeline order is load-bearing and matches the web exactly:
///   1. strip dangerous tags  — security
///   2. markdown              — on the RAW text, so its `\n` exclusion still stops emphasis
///                              from spanning a real line break
///   3. newlines              — `\n` → `<br>` for textarea-authored content
public enum ContentText {
    /// The complete allowlist. Frozen at eight on the web; frozen at eight here.
    private static let allowedTags: Set<String> = ["b", "i", "u", "em", "strong", "sup", "sub", "br"]

    /// Tags whose *content* must go too — `<script>evil()</script>` must not leave
    /// "evil()" behind as text.
    private static let dangerousTags =
        "script|style|iframe|object|embed|form|input|button|select|textarea|link|meta|head|html|body"

    public static func prepare(_ raw: String) -> String {
        applyNewlines(applyMarkdown(stripDangerousTags(raw)))
    }

    // MARK: - Pass 1 & 2: sanitise

    private static func stripDangerousTags(_ raw: String) -> String {
        var out = replacing(
            raw,
            pattern: "<(\(dangerousTags))\\b[^>]*>[\\s\\S]*?</\\1>",
            options: [.caseInsensitive]
        ) { _ in "" }

        // Opening tags, with any attributes or a self-closing slash. An allowlisted tag is
        // re-emitted BARE — every attribute is dropped, unconditionally, so
        // `<b onclick="x">` becomes `<b>`.
        out = replacing(out, pattern: "<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*/?>") { groups in
            let name = groups[1].lowercased()
            return allowedTags.contains(name) ? "<\(name)>" : ""
        }

        out = replacing(out, pattern: "</([a-zA-Z][a-zA-Z0-9]*)\\s*>") { groups in
            let name = groups[1].lowercased()
            return allowedTags.contains(name) ? "</\(name)>" : ""
        }

        return out
    }

    // MARK: - Pass 3: emphasis

    /// `**bold**` → `<b>`, `*italic*` → `<i>`.
    ///
    /// The inner class allows an authored `<br>` but excludes every other `<` and all bare
    /// newlines, so `**bold\ntext**` is deliberately NOT bolded: an author who pressed
    /// return in the middle almost certainly did not mean one emphasis span.
    private static func applyMarkdown(_ text: String) -> String {
        let inner = "(?:<br\\s*/?>|[^*\\n<])+?"
        // Bold first, or `**x**` would be eaten as two italics.
        var out = replacing(text, pattern: "\\*\\*(\(inner))\\*\\*") { "<b>\($0[1])</b>" }
        out = replacing(out, pattern: "(?<!\\*)\\*(\(inner))\\*(?!\\*)") { "<i>\($0[1])</i>" }
        return out
    }

    private static func applyNewlines(_ text: String) -> String {
        text.replacingOccurrences(of: "\n", with: "<br>")
    }

    // MARK: - Detection

    /// Whether a string needs the full renderer at all.
    ///
    /// This is the check that was wrong before: it tested only for `<` and `&`, so `$x^2$`
    /// — no angle bracket anywhere — took the plain-`Text` path and a student was shown the
    /// raw LaTeX in the middle of a maths question. Markup, math delimiters and markdown
    /// emphasis all have to count.
    public static func needsRendering(_ raw: String) -> Bool {
        if raw.contains("<") || raw.contains("&") { return true }
        if raw.contains("$") { return true }
        if raw.contains("\\(") || raw.contains("\\[") { return true }
        if raw.contains("**") { return true }
        // A lone `*` is emphasis only when it closes; `2 * 3` must stay plain text.
        if raw.range(of: "\\*[^*\\n]+\\*", options: .regularExpression) != nil { return true }
        if raw.contains("\n") { return true }
        return false
    }

    /// A one-line preview for list rows, where a web view each is out of the question.
    ///
    /// Rows show a stripped string, so LaTeX is unwrapped rather than left with its
    /// delimiters showing — `$x^2$` reads better as `x^2` than as `$x^2$` in a subtitle.
    public static func plainPreview(_ raw: String) -> String {
        var out = raw.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        for delimiter in ["$$", "\\(", "\\)", "\\[", "\\]", "$", "**"] {
            out = out.replacingOccurrences(of: delimiter, with: "")
        }
        return out
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Regex plumbing

    /// `NSRegularExpression` with a closure per match, because the replacements here depend
    /// on the captured tag name and template strings cannot make that decision.
    private static func replacing(
        _ input: String,
        pattern: String,
        options: NSRegularExpression.Options = [],
        transform: ([String]) -> String
    ) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return input }
        let ns = input as NSString
        var result = ""
        var last = 0
        for match in regex.matches(in: input, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: last, length: match.range.location - last))
            var groups: [String] = []
            for index in 0..<match.numberOfRanges {
                let range = match.range(at: index)
                groups.append(range.location == NSNotFound ? "" : ns.substring(with: range))
            }
            result += transform(groups)
            last = match.range.location + match.range.length
        }
        result += ns.substring(from: last)
        return result
    }
}
