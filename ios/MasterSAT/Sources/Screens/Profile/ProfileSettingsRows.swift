import SwiftUI
import MasterSATKit

/// The Me sheet's settings rows — the web's section menu (`SettingsTab.tsx`), each row pushing
/// its page (`Screens/Account/`) as a `ProfileView.Route` the sheet's root declares. It is the
/// one way into them; an earlier standalone Settings page with the same rows was removed so the
/// two could not drift apart.
///
/// Two of the web's six sections are not rows here, on purpose: **Study goal** is set from
/// "Your goal" on this same page (the same sheet and date list Today uses), and **Appearance**
/// follows the phone's own light/dark setting. About is the app's own addition: a phone has a
/// version worth knowing.
struct ProfileSettingsRows: View {
    /// No address yet, or one not confirmed: Sign-in & password carries a "Confirm email" badge.
    let emailNeedsConfirming: Bool

    var body: some View {
        VStack(spacing: 10) {
            AccountMenuRow(
                icon: "person.crop.circle", tone: Theme.accent, title: "Account", hint: "Photo, name and phone",
                route: ProfileView.Route.accountDetails
            )
            AccountMenuRow(
                icon: "bell.badge", tone: Theme.info, title: "Notifications", hint: "What reaches you",
                route: ProfileView.Route.notifications
            )
            AccountMenuRow(
                icon: "key",
                tone: Theme.success,
                title: "Sign-in & password",
                hint: "Email, Telegram, password",
                badge: emailNeedsConfirming ? "Confirm email" : nil,
                route: ProfileView.Route.signIn
            )
            AccountMenuRow(
                icon: "laptopcomputer.and.iphone", tone: Theme.danger, title: "Devices", hint: "Where you're signed in",
                route: ProfileView.Route.devices
            )
            AccountMenuRow(
                icon: "info.circle", tone: Theme.accentDeep, title: "About", hint: "Version and the learning center",
                route: ProfileView.Route.about
            )
        }
    }
}
