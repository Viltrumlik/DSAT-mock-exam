import SwiftUI
import WebKit

/// The Desmos calculator — the same one the College Board hands students in the real
/// Bluebook app, and the same one the web runner embeds.
///
/// There is no native Desmos SDK for iOS, and there is no version of "write our own
/// graphing calculator" that a student should trust in a maths assessment. So this is the
/// real thing: `calculator.js` from Desmos, in a `WKWebView`, with the same options and
/// the same key the web uses.
///
/// Unlike `RichTextView` — which renders authored content and therefore runs no
/// JavaScript and reaches no network — this view is a live third-party tool and needs
/// both. It is kept in its own type for exactly that reason: the locked-down renderer
/// must not quietly become a general-purpose browser because one screen needed one.
struct DesmosView: UIViewRepresentable {
    enum Mode: String, CaseIterable, Identifiable {
        case graphing
        case scientific

        var id: String { rawValue }
        var title: String { self == .graphing ? "Graphing" : "Scientific" }
        /// The same bundle ships both factories.
        var factory: String { self == .graphing ? "GraphingCalculator" : "ScientificCalculator" }
    }

    let mode: Mode
    @Binding var didFail: Bool

    /// Desmos's own public demo key — the one their docs hand out and the one the web
    /// runner defaults to. Swap it for a licensed key in both places at once.
    private static let apiKey = "dcb31709b452b1cf9dc26972add0fda6"

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        // Loaded against the Desmos origin so the script is a same-origin request; a
        // `nil` baseURL makes the page opaque and the CDN load is refused.
        webView.loadHTMLString(Self.document(mode: mode), baseURL: URL(string: "https://www.desmos.com/"))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.renderedMode != mode else { return }
        context.coordinator.renderedMode = mode
        webView.loadHTMLString(Self.document(mode: mode), baseURL: URL(string: "https://www.desmos.com/"))
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(mode: mode, onFail: { didFail = true })
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var renderedMode: DesmosView.Mode
        private let onFail: @MainActor () -> Void

        init(mode: DesmosView.Mode, onFail: @escaping @MainActor () -> Void) {
            self.renderedMode = mode
            self.onFail = onFail
        }

        nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // The page always loads; what can fail is the CDN script behind it. Ask the
            // page whether the calculator actually mounted, so "no signal" shows a
            // message instead of a permanently blank rectangle.
            webView.evaluateJavaScript("window.__desmosReady === true") { value, _ in
                let ready = (value as? Bool) ?? false
                MainActor.assumeIsolated { if !ready { self.onFail() } }
            }
        }

        nonisolated func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            MainActor.assumeIsolated { self.onFail() }
        }
    }

    private static func document(mode: Mode) -> String {
        """
        <!doctype html>
        <html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
        <style>
          html, body { margin: 0; height: 100%; background: transparent; }
          #calc { width: 100%; height: 100%; }
        </style>
        </head>
        <body>
        <div id="calc"></div>
        <script src="https://www.desmos.com/api/v1.11/calculator.js?apiKey=\(apiKey)"></script>
        <script>
          window.__desmosReady = false;
          try {
            var mount = document.getElementById('calc');
            var make = window.Desmos && window.Desmos.\(mode.factory);
            if (make) {
              var calc = make(mount, {
                expressions: true,
                settingsMenu: false,
                zoomButtons: true,
                border: false
              });
              // Desmos measures its container ONCE, at mount. The panel lives in a sheet
              // whose height animates between detents, so it can mount at zero height and
              // stay there — a blank rectangle over a maths question. Watching the box and
              // re-measuring is the only thing that survives a resize.
              if (window.ResizeObserver) {
                new ResizeObserver(function () { calc.resize(); }).observe(mount);
              }
              window.addEventListener('resize', function () { calc.resize(); });
              window.__desmosReady = true;
            }
          } catch (e) {}
        </script>
        </body></html>
        """
    }
}

/// The calculator as it appears over a question: a draggable-height panel with the two
/// modes the SAT allows.
struct CalculatorPanel: View {
    let onClose: @MainActor () -> Void

    @State private var mode: DesmosView.Mode = .graphing
    @State private var didFail = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Picker("Calculator", selection: $mode) {
                    ForEach(DesmosView.Mode.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 220)
                .onChange(of: mode) { _, _ in didFail = false }

                Spacer()

                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(Theme.surface2))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)

            Divider()

            if didFail {
                VStack(spacing: 10) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 28))
                        .foregroundStyle(Theme.warning)
                    Text("The calculator needs a connection")
                        .font(.system(size: 15, weight: .bold))
                    // Named rather than left blank: a student staring at an empty box
                    // during a maths question will assume the app is broken.
                    Text("Desmos loads from the internet. It will come back when you are online.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                    Button("Try again") { didFail = false }
                        .buttonStyle(SecondaryButtonStyle())
                }
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                DesmosView(mode: mode, didFail: $didFail)
                    // A fresh identity per mode: Desmos mounts once into its div, so
                    // reusing the web view would leave the old calculator in place.
                    .id(mode)
            }
        }
        .background(Theme.card)
    }
}
