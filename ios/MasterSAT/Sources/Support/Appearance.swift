import SwiftUI
import UIKit

/// How the app is dressed on this phone: as the phone is set, or always light, or always dark.
///
/// A setting of the DEVICE, not of the account. The website keeps its theme in the browser the
/// same way, so this sits in `UserDefaults`, is never sent to the server, and is not wiped by
/// signing out: whoever signs in next on this phone is still holding the same phone.
enum AppAppearance: String, CaseIterable, Identifiable {
    case system, light, dark

    /// The `UserDefaults` key behind `@AppStorage` — one name for the root that applies the
    /// choice and the page that makes it, so the two cannot drift apart.
    static let storageKey = "appearance"

    var id: String { rawValue }

    /// What the choice is, as a window is told it. `.unspecified` is not "light": it takes the
    /// override off and gives the decision back to the phone, which is the whole of "Use the
    /// phone's setting".
    var interfaceStyle: UIUserInterfaceStyle {
        switch self {
        case .system: .unspecified
        case .light: .light
        case .dark: .dark
        }
    }

    /// The stored choice, read straight from `UserDefaults` for the code that has no view to
    /// ask (a window appearing).
    static var stored: AppAppearance {
        UserDefaults.standard.string(forKey: storageKey).flatMap(AppAppearance.init(rawValue:)) ?? .system
    }

    /// How the page's own ring and tick change. Under Reduce Motion they do not: the change is
    /// one frame. Otherwise a short, even fade, not a spring.
    static func swapAnimation(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .easeInOut(duration: 0.25)
    }
}

extension View {
    /// Dresses the whole app in the stored appearance. Put it once, on the app's root view.
    ///
    /// **One writer: the windows.** The choice is written to `overrideUserInterfaceStyle` on
    /// every window of every connected scene (`WindowStyle`), and nowhere else. It is not also
    /// given to `.preferredColorScheme`: that modifier is a second writer of the same property,
    /// and going from a forced scheme back to `nil` does not reset a sheet that is already open
    /// (seen on a device: "Use the phone's setting" left the open Me sheet dark under a light app).
    ///
    /// **What reaches what.** A presented sheet, cover or popover takes its traits from the window
    /// it is shown in. Read from the source: the app sets a scheme nowhere below the root and
    /// creates no window of its own, so what it presents is presented from inside the windows
    /// this styles. Seen on a device: the Me sheet re-themes at once when Dark is chosen. Not yet
    /// seen: the other presentations (certificate, covers, popovers, dialogs); they are on the
    /// device checklist.
    ///
    /// **Windows that come later.** The scene's window is not there when the app is built, and
    /// others (a second scene, the keyboard's) appear after it, so the style is applied when the
    /// root enters its window, again whenever any window becomes visible, and on every change.
    func appliesStoredAppearance() -> some View {
        modifier(StoredAppearance())
    }
}

/// A modifier of its own so that reading the setting rebuilds this wrapper and not `RootView`,
/// whose body would rebuild the tab view and the navigation stacks with it.
private struct StoredAppearance: ViewModifier {
    @AppStorage(AppAppearance.storageKey) private var appearance = AppAppearance.system

    func body(content: Content) -> some View {
        content
            // Zero-sized and inert: it is only here to be told when the root reaches a window.
            .background {
                WindowStyleAnchor()
                    .frame(width: 0, height: 0)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            // After the update, not during it: a window's style is UIKit state, and changing it
            // inside SwiftUI's own update would ask for another update while it runs.
            .onChange(of: appearance) { _, now in WindowStyle.apply(now) }
    }
}

/// The one place the choice reaches a window.
@MainActor
enum WindowStyle {
    /// Sets every window of every connected scene, skipping the ones already right. In a single
    /// frame, with no UIKit transition: the style is what the student asked for, and an animation
    /// is the one thing Reduce Motion would have to take back. (The page's own ring and tick keep
    /// their fade; see `AppAppearance.swapAnimation`.)
    static func apply(_ appearance: AppAppearance = .stored) {
        let style = appearance.interfaceStyle
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
        for window in windows where window.overrideUserInterfaceStyle != style {
            UIView.performWithoutAnimation { window.overrideUserInterfaceStyle = style }
        }
    }
}

/// Tells `WindowStyle` when there is a window to dress: when the root is first put in one, and
/// whenever any window becomes visible afterwards.
private struct WindowStyleAnchor: UIViewRepresentable {
    func makeUIView(context: Context) -> WindowStyleAnchorView { WindowStyleAnchorView() }
    func updateUIView(_ view: WindowStyleAnchorView, context: Context) {}
}

private final class WindowStyleAnchorView: UIView {
    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        // Selector-based, so the observer goes away with the view and there is no token to hold
        // across actors.
        NotificationCenter.default.addObserver(
            self, selector: #selector(aWindowAppeared), name: UIWindow.didBecomeVisibleNotification, object: nil
        )
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { WindowStyle.apply() }
    }

    @objc private func aWindowAppeared() {
        WindowStyle.apply()
    }
}
