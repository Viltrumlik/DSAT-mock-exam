import SwiftUI
import UIKit
import MasterSATKit

/// The status bar's text, as the page on screen asks for it.
///
/// Most pages leave it alone, and the system draws it as it always has. Two pages paint a dark
/// colour of their own under it whatever the phone's setting — the Class tab's blue band and the
/// dark class page — and ask for white text while they are up.
///
/// SwiftUI has no modifier for the style, and the controller UIKit asks — the root hosting
/// controller, down through the tab and navigation controllers — is SwiftUI's own; a navigation
/// bar's colour scheme reaches it only while that bar is drawn, and the Class tab hides its bar. So
/// the style is answered by a controller of the app's: the root of a clear, touch-through window
/// laid over the app's (`StatusBarOverlayWindow`). UIKit takes the status bar's look from the
/// frontmost full-screen window, so while that window shows, its answer is the one used. It shows
/// only while a request holds: every other page — and a page that hides the status bar, a story, a
/// study session — is answered by the app's own controllers exactly as before. (Checked on the
/// iOS 26.3 simulator: white over the band and the class page, the system's own elsewhere.)
///
/// Asked for like the tab bar's style (`TabBarChrome`): a request names the tab it was made on and
/// holds only while that tab is open, and names its owner, so a page leaving withdraws its own
/// request and never a newer one — a push from the Class tab to the class page hands the white text
/// from one to the other in either order.
@MainActor
@Observable
final class StatusBarChrome {
    enum Style: Equatable {
        /// The system's own: dark on a light page, light on a dark one.
        case standard
        /// White, over a dark colour the page paints itself.
        case light
    }

    private struct Request: Equatable {
        let style: Style
        let tab: AppTab
        let owner: UUID
    }

    private var request: Request?
    /// The full-screen covers up right now (`coversCelebrations` registers each). A cover hides
    /// the tab under it, so the tab's request does not speak for it: the question runner, a word
    /// game, a ticket — light pages, all of them — would otherwise wear the band's white clock,
    /// invisible on their paper. While one is up the system answers, from the cover's own
    /// controller: dark text on a light page, light text at night, hidden for a story.
    private var covers: Set<UUID> = []

    /// The style while `tab` is open.
    func style(on tab: AppTab) -> Style {
        guard covers.isEmpty, let request, request.tab == tab else { return .standard }
        return request.style
    }

    func coverAppeared(_ cover: UUID) {
        if !covers.contains(cover) { covers.insert(cover) }
    }

    func coverDisappeared(_ cover: UUID) {
        if covers.contains(cover) { covers.remove(cover) }
    }

    func ask(_ style: Style, on tab: AppTab, owner: UUID) {
        let next = Request(style: style, tab: tab, owner: owner)
        if request != next { request = next }
    }

    func release(owner: UUID) {
        if request?.owner == owner { request = nil }
    }
}

/// The one reader: shows the overlay window while the open tab's request is for white text. A view
/// of its own, so a request redraws this and not the root's tab view and its stacks.
struct StatusBarHost: View {
    @Environment(StatusBarChrome.self) private var chrome
    @Environment(AppRouter.self) private var router

    var body: some View {
        StatusBarWindowAnchor(light: chrome.style(on: router.selection) == .light)
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// Learns the scene from its own window, and holds the overlay for it.
private struct StatusBarWindowAnchor: UIViewRepresentable {
    let light: Bool

    func makeUIView(context: Context) -> StatusBarAnchorView { StatusBarAnchorView() }

    func updateUIView(_ view: StatusBarAnchorView, context: Context) {
        view.light = light
    }

    static func dismantleUIView(_ view: StatusBarAnchorView, coordinator: ()) {
        // Signed out, or the shell rebuilt: nothing is asking any more.
        view.light = false
    }
}

private final class StatusBarAnchorView: UIView {
    var light = false {
        didSet { if light != oldValue { apply() } }
    }

    /// Held here: a scene does not keep a window alive on its own.
    private var overlay: StatusBarOverlayWindow?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        apply()
    }

    private func apply() {
        guard light, let scene = window?.windowScene else {
            overlay?.isHidden = true
            if window == nil { overlay = nil }
            return
        }
        if overlay?.windowScene !== scene {
            overlay?.isHidden = true
            overlay = StatusBarOverlayWindow(windowScene: scene)
        }
        overlay?.isHidden = false
    }
}

/// White text for a page that paints its own blue under the status bar wherever it stands — the
/// "front door" screens (sign-in, a frozen account, can't reach, time to update), which live
/// outside the tab shell and its `StatusBarHost`. Put it in the page's background; it holds while
/// the page is on screen.
struct LightStatusBar: View {
    var body: some View {
        StatusBarWindowAnchor(light: true)
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// Clear, above the app's window, and never touched: a tap, a drag and VoiceOver all go through it
/// to the app below. It exists only for its root controller's answer.
private final class StatusBarOverlayWindow: UIWindow {
    override init(windowScene: UIWindowScene) {
        super.init(windowScene: windowScene)
        // Just above the app; alerts and the keyboard keep their own, higher levels.
        windowLevel = .normal + 1
        backgroundColor = .clear
        isUserInteractionEnabled = false
        accessibilityElementsHidden = true
        rootViewController = StatusBarOverlayController()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? { nil }
}

private final class StatusBarOverlayController: UIViewController {
    override func loadView() {
        let view = UIView()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        self.view = view
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var prefersStatusBarHidden: Bool { false }
    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }
    /// Never a say in rotation: the app's own window decides it.
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }
}
