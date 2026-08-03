import Foundation
import WebKit

/// Serves the vendored KaTeX out of the app bundle under a private URL scheme.
///
/// The alternative — writing each rendered page to disk beside a copy of KaTeX and using
/// `loadFileURL(_:allowingReadAccessTo:)` — was tried and does not work: the load produced
/// no navigation events at all (no finish, no failure, not even a policy callback) and the
/// question card came up blank. Loading the document from memory has always worked here, so
/// only the subresources need a home, and this is it.
///
/// It is also the tighter answer. The handler resolves exactly one directory inside the
/// bundle and refuses everything else, so the page can reach KaTeX and nothing at all
/// besides — no file system, no network, no other origin.
final class KatexSchemeHandler: NSObject, WKURLSchemeHandler {
    /// Where the vendored copy sits in the bundle.
    private static let root = Bundle.main.url(forResource: "katex", withExtension: nil)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let root = Self.root else {
            task.didFailWithError(URLError(.badURL))
            return
        }

        // The path is taken apart and rebuilt component by component, so `../../` cannot
        // walk out of the KaTeX directory into the rest of the bundle.
        let components = url.path
            .split(separator: "/")
            .map(String.init)
            .filter { $0 != "." && $0 != ".." && !$0.isEmpty }
        guard !components.isEmpty else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let file = components.reduce(root) { $0.appendingPathComponent($1) }
        guard let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let response = URLResponse(
            url: url,
            mimeType: Self.mimeType(for: file.pathExtension),
            expectedContentLength: data.count,
            textEncodingName: "utf-8"
        )
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    /// Enough types for what KaTeX ships. A wrong MIME on the stylesheet is silent — the
    /// page simply renders unstyled — so these are named rather than guessed.
    private static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "css": return "text/css"
        case "js": return "text/javascript"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        default: return "application/octet-stream"
        }
    }
}
