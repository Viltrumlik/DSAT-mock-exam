import SwiftUI
import MasterSATKit

/// The profile's Settings tab — the web's section menu (`SettingsTab.tsx`), each row opening
/// its page. The same rows, hints and pages as `AccountSettingsView`, which is where the rest
/// of the app reaches them.
///
/// Two of the web's six sections are not rows here, on purpose: **Study goal** is set from
/// Overview's "Your goal" (the same sheet and date list Home uses), and **Appearance** follows
/// the phone's own light/dark setting. About is the app's own addition: a phone has a version
/// worth knowing.
struct ProfileSettingsTab: View {
    /// No address yet, or one not confirmed: Sign-in & password carries a "Confirm email" badge.
    let emailNeedsConfirming: Bool

    var body: some View {
        VStack(spacing: 10) {
            AccountMenuRow(icon: "person.crop.circle", tone: Theme.accent, title: "Account", hint: "Photo, name and phone") {
                AccountDetailsView()
            }
            AccountMenuRow(icon: "bell.badge", tone: Theme.info, title: "Notifications", hint: "What reaches you") {
                NotificationSettingsView()
            }
            AccountMenuRow(
                icon: "key",
                tone: Theme.success,
                title: "Sign-in & password",
                hint: "Email, Telegram, password",
                badge: emailNeedsConfirming ? "Confirm email" : nil
            ) {
                AccountSignInView()
            }
            AccountMenuRow(icon: "laptopcomputer.and.iphone", tone: Theme.danger, title: "Devices", hint: "Where you're signed in") {
                AccountDevicesView()
            }
            AccountMenuRow(icon: "info.circle", tone: Theme.accentDeep, title: "About", hint: "Version and the learning center") {
                AccountAboutView()
            }
        }
    }
}
