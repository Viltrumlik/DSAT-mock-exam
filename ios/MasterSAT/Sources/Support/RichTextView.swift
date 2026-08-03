import SwiftUI
import WebKit

/// Renders authored question content: HTML, with MathML for the Math section.
///
/// This is the one place the app deliberately does not draw the content itself. Question
/// text is authored once, in the builder, as HTML with embedded math — porting a math
/// renderer to Swift would mean a second implementation of *how a question looks*, and the
/// first time the two disagreed a student would sit a different exam on their phone than
/// on their laptop.
///
/// So the content is rendered by the same engine the web runner uses, and everything
/// around it — the timer, navigation, answer state, autosave, submission — is native. The
/// web view is a text renderer here: no navigation, no scrolling of its own, no network.
struct RichTextView: UIViewRepresentable {
    let html: String
    /// Reported back so the surrounding SwiftUI layout can size the view to its content.
    @Binding var contentHeight: CGFloat

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.suppressesIncrementalRendering = true
        // Question content is static text. Nothing it contains should be able to reach the
        // network, and nothing the student does should navigate anywhere.
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.isScrollEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.renderedHTML != html else { return }
        context.coordinator.renderedHTML = html
        webView.loadHTMLString(Self.document(for: html), baseURL: nil)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onHeight: { contentHeight = $0 })
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var renderedHTML: String?
        private let onHeight: @MainActor (CGFloat) -> Void

        init(onHeight: @escaping @MainActor (CGFloat) -> Void) {
            self.onHeight = onHeight
        }

        nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // Measuring needs JavaScript, which the page itself is not allowed to run —
            // `evaluateJavaScript` is the host asking, not the content executing.
            webView.evaluateJavaScript("document.documentElement.scrollHeight") { value, _ in
                guard let height = value as? CGFloat else { return }
                // WebKit delivers its callbacks on the main thread; say so explicitly
                // rather than hopping and re-rendering a frame later.
                MainActor.assumeIsolated { self.onHeight(height) }
            }
        }

        /// Only the initial in-memory load is allowed. A link inside authored content must
        /// never take a student out of an exam.
        nonisolated func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            decisionHandler(navigationAction.navigationType == .other ? .allow : .cancel)
        }
    }

    /// Wraps authored HTML in a shell that matches the app's typography and follows the
    /// system light/dark setting.
    private static func document(for body: String) -> String {
        """
        <!doctype html>
        <html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
        <style>
          :root { color-scheme: light dark; }
          body {
            margin: 0;
            font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
            font-size: 17px;
            line-height: 1.55;
            color: #000;
            background: transparent;
            -webkit-text-size-adjust: 100%;
          }
          @media (prefers-color-scheme: dark) { body { color: #fff; } }
          img, svg { max-width: 100%; height: auto; }
          table { border-collapse: collapse; max-width: 100%; }
          td, th { border: 1px solid currentColor; padding: 4px 8px; }
          /* Long equations and wide tables scroll themselves rather than forcing the page
             sideways — a horizontally scrolling exam is unusable on a phone. */
          .scroll-x { overflow-x: auto; }
        </style>
        </head><body>\(body)</body></html>
        """
    }
}

/// Authored content, rendered the cheapest way that is still faithful.
///
/// Most answer choices are a plain sentence. Spinning up a `WKWebView` for each of them
/// would mean four web views per question, torn down and rebuilt on every navigation —
/// expensive, and visibly slower to appear than the question around it. So plain strings
/// take a native `Text` and only real markup pays for the web view.
struct RichText: View {
    let html: String
    @State private var height: CGFloat = 40

    var body: some View {
        if html.containsMarkup {
            RichTextView(html: html, contentHeight: $height)
                .frame(height: height)
        } else {
            Text(html)
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

extension String {
    /// Whether this needs a real HTML renderer.
    ///
    /// Deliberately eager: a false positive costs one web view, while a false negative
    /// shows a student raw `<sup>` tags or an unrendered formula in the middle of an exam.
    var containsMarkup: Bool {
        contains("<") || contains("&")
    }
}
