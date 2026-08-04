import SwiftUI
import WebKit
import MasterSATKit

/// Renders authored question content: LaTeX maths, `**bold**`, `*italic*`, `<sup>`/`<sub>`.
///
/// This is the one place the app deliberately does not draw the content itself. Question
/// text is authored once, in the builder, in the dialect described by
/// `frontend/src/components/MATH_TEXT_BOUNDARIES.md` — porting a maths renderer to Swift
/// would mean a second implementation of *how a question looks*, and the first time the two
/// disagreed a student would sit a different exam on their phone than on their laptop.
///
/// So the content is rendered by the same engine the web uses: **KaTeX 0.17.0**, the exact
/// version `frontend/package.json` pins, vendored into `Resources/katex` and loaded from
/// disk. Nothing is fetched.
///
/// JavaScript IS enabled here, which the earlier version of this view refused. That refusal
/// was what made maths silently fail: KaTeX is JavaScript, and without it every `$x^2$` in
/// the bank reached students as literal dollar signs. The safety that setting was standing
/// in for now comes from somewhere stronger — `ContentText.prepare` runs first and its
/// allowlist has no `<img>`, no `<a>`, no `<iframe>`, no `<script>`. After that pass the
/// document contains nothing that could reach the network even if it wanted to, and the
/// navigation delegate refuses every load but the first.
struct RichTextView: UIViewRepresentable {
    /// Raw authored text, straight from the API. Sanitising happens here, not at the call
    /// site, so no caller can accidentally skip it.
    let text: String
    /// The runner's zoom. Applied inside the document rather than as a SwiftUI
    /// `scaleEffect`: scaling the view would blur the text and leave the frame the wrong
    /// size, while a bigger root font reflows properly, exactly as the web's CSS `zoom`
    /// does.
    var scale: Double = 1.0
    /// Serif, for passages and explanations — the site sets those in Georgia.
    var serif = false
    var italic = false
    /// The ink colour, resolved by SwiftUI and passed in.
    ///
    /// NOT left to the page's own `prefers-color-scheme`. A `WKWebView` answers that query
    /// from its own trait resolution, which does not necessarily agree with the app's — and
    /// when it disagreed the result was white text on a white card: every question with any
    /// markup in it rendered as an empty box, while plain-text questions (which never reach
    /// this view) looked fine. An invisible question is worse than an ugly one.
    var isDark = false
    /// Struck through — a choice the student has crossed out with the elimination tool.
    /// Done in the document rather than with SwiftUI's `strikethrough`, which has no effect
    /// on a web view's content.
    var struckThrough = false
    /// Reported back so the surrounding SwiftUI layout can size the view to its content.
    @Binding var contentHeight: CGFloat



    /// The origin the page is loaded against. KaTeX's assets are fetched from it and served
    /// out of the app bundle by `KatexSchemeHandler`.
    ///
    /// A file URL was the obvious way to do this and it does not work: `loadFileURL` with
    /// the page written beside a copy of KaTeX produced no navigation at all — no finish, no
    /// failure, not even a policy callback — and a blank card where the question should be.
    /// Loading the document from memory is the path that has always worked here; only the
    /// subresources need somewhere to come from, and a scheme handler is that somewhere.
    static let origin = "mastersat-katex://local/"

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // NOT `suppressesIncrementalRendering`: KaTeX pulls twenty web fonts off disk, and
        // asking WebKit to hold the first paint until it considers the page complete leaves
        // the question blank while they load.
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.setURLSchemeHandler(KatexSchemeHandler(), forURLScheme: "mastersat-katex")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.isScrollEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        // A UIView inside a SwiftUI Button eats the touch. An answer choice whose text
        // happened to contain maths was therefore impossible to select — the tap landed on
        // the web view and stopped there, while a plain-text choice next to it worked fine.
        // This content is read, never touched, so it gives every touch back.
        webView.isUserInteractionEnabled = false
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let signature = "\(scale)|\(serif)|\(italic)|\(isDark)|\(struckThrough)|\(text)"
        guard context.coordinator.rendered != signature else { return }
        context.coordinator.rendered = signature
        webView.loadHTMLString(
            Self.document(
                for: text,
                scale: scale,
                serif: serif,
                italic: italic,
                isDark: isDark,
                struckThrough: struckThrough
            ),
            baseURL: URL(string: Self.origin)
        )
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onHeight: { contentHeight = $0 })
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var rendered: String?
        private let onHeight: @MainActor (CGFloat) -> Void

        init(onHeight: @escaping @MainActor (CGFloat) -> Void) {
            self.onHeight = onHeight
        }

        nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // KaTeX lays out with its own fonts, so the honest height is only known once
            // those have loaded. `document.fonts.ready` is exactly that promise; without
            // waiting the first measurement comes back short and a long formula is clipped.
            //
            // `callAsyncJavaScript` wraps this in an async function, so the body must
            // RETURN — an IIFE expression here resolves to undefined and the height is
            // never reported, which reads on screen as a permanently 24pt-tall question.
            let script = """
            try { await document.fonts.ready } catch (e) {}
            return document.documentElement.scrollHeight
            """
            webView.callAsyncJavaScript(script, in: nil, in: .page) { result in
                guard case .success(let value) = result, let height = value as? CGFloat else { return }
                MainActor.assumeIsolated { self.onHeight(max(height, 1)) }
            }
        }

        /// Only the initial load is allowed. A link inside authored content must never take
        /// a student out of an exam — and after `ContentText.prepare` there are no links
        /// left to click anyway.
        nonisolated func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            decisionHandler(navigationAction.navigationType == .other ? .allow : .cancel)
        }
    }

    /// Wraps sanitised content in a shell that matches the app's typography, follows the
    /// system light/dark setting, and runs KaTeX over the result.
    private static func document(
        for raw: String,
        scale: Double,
        serif: Bool,
        italic: Bool,
        isDark: Bool,
        struckThrough: Bool
    ) -> String {
        let body = ContentText.prepare(raw)
        let family = serif
            ? "Georgia, \"Times New Roman\", serif"
            : "-apple-system, \"SF Pro Text\", system-ui, sans-serif"
        return """
        <!doctype html>
        <html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
        <link rel="stylesheet" href="\(origin)katex.min.css">
        <style>
          body {
            margin: 0;
            font-family: \(family);
            font-style: \(italic ? "italic" : "normal");
            text-decoration: \(struckThrough ? "line-through" : "none");
            text-decoration-thickness: 2px;
            font-size: \(Int((17 * scale).rounded()))px;
            line-height: 1.55;
            color: \(isDark ? "#ffffff" : "#000000");
            background: transparent;
            -webkit-text-size-adjust: 100%;
            overflow-wrap: break-word;
          }
          /* A long formula scrolls itself rather than forcing the page sideways — a
             horizontally scrolling exam is unusable on a phone. */
          .katex-display { overflow-x: auto; overflow-y: hidden; padding: 2px 0; }
          .katex { font-size: 1.05em; }
        </style>
        </head><body>
        <div id="c">\(body)</div>
        <script src="\(origin)katex.min.js"></script>
        <script src="\(origin)auto-render.min.js"></script>
        <script>
          try {
            renderMathInElement(document.getElementById('c'), {
              // The same four pairs, in the same order, as `lib/mathRender.ts`: $$ has to
              // be tried before $ or every display block is read as two inline ones.
              delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\\\[', right: '\\\\]', display: true },
                { left: '\\\\(', right: '\\\\)', display: false },
                { left: '$', right: '$', display: false }
              ],
              // A malformed formula shows as red source text instead of taking the whole
              // question down with an exception.
              throwOnError: false
            });
          } catch (e) {}
        </script>
        </body></html>
        """
    }
}

/// Authored content, rendered the cheapest way that is still faithful.
///
/// Most answer choices are a plain sentence. Spinning up a `WKWebView` for each would mean
/// four web views per question, torn down and rebuilt on every navigation — expensive, and
/// visibly slower to appear than the question around it. So plain strings take a native
/// `Text` and only real content pays for the web view.
struct RichText: View {
    let text: String
    var scale: Double = 1.0
    var serif = false
    var italic = false
    var weight: Font.Weight = .regular
    var struckThrough = false
    @Environment(\.colorScheme) private var colorScheme
    @State private var height: CGFloat = 24

    var body: some View {
        if ContentText.needsRendering(text) {
            RichTextView(
                text: text,
                scale: scale,
                serif: serif,
                italic: italic,
                isDark: colorScheme == .dark,
                struckThrough: struckThrough,
                contentHeight: $height
            )
                .frame(height: height)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text(text)
                .font(.system(size: 17 * scale, weight: weight, design: serif ? .serif : .default))
                .italic(italic)
                .strikethrough(struckThrough)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

extension String {
    /// A one-line preview of authored content, for rows that cannot afford a web view.
    var strippedHTML: String { ContentText.plainPreview(self) }
}
