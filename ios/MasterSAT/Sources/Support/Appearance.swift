import SwiftUI

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

    /// What `.preferredColorScheme` takes. `nil` is not "light": it gives the decision back to
    /// the phone, which is the whole of "Use the phone's setting".
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    /// How a change of choice is drawn. Under Reduce Motion it is not: the colours change in
    /// one frame. Otherwise a short, even fade — a spring would overshoot the colours it is
    /// blending and flash a shade neither scheme has.
    static func swapAnimation(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .easeInOut(duration: 0.25)
    }
}

extension View {
    /// Dresses the whole app in the stored appearance. Put it once, on the app's root view.
    ///
    /// On the root of the window group, `.preferredColorScheme` sets the style of the window
    /// itself. Every sheet, full-screen cover, popover and system sheet the app presents
    /// (the Me sheet, the certificate, a story's web page, the share sheet) is hung off that one
    /// window, so each inherits it and none needs the modifier of its own. A second
    /// `.preferredColorScheme` further down would only override the window for that one
    /// presentation, and is how a sheet ends up dark under a light app.
    func appliesStoredAppearance() -> some View {
        modifier(StoredAppearance())
    }
}

/// A modifier of its own so that reading the setting rebuilds this wrapper and not `RootView`,
/// whose body would rebuild the tab view and the navigation stacks with it.
private struct StoredAppearance: ViewModifier {
    @AppStorage(AppAppearance.storageKey) private var appearance = AppAppearance.system

    func body(content: Content) -> some View {
        content.preferredColorScheme(appearance.colorScheme)
    }
}
