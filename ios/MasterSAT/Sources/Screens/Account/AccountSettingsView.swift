import SwiftUI
import MasterSATKit

/// Settings: every setting a student has, one page each — the web's Settings tab menu, in its
/// order and with its hints.
///
/// Two of the web's sections are not here, on purpose: **Study goal** already lives on Home
/// (the goal sliders and the SAT-date picker), and **Appearance** follows the phone's own
/// light/dark setting. About is the app's own addition: a phone has a version worth knowing.
struct AccountSettingsView: View {
    @Environment(Session.self) private var session
    @State private var verifyingEmail = false
    @State private var toast: RewardsToastMessage?

    private var user: CurrentUser? {
        if case .signedIn(let user) = session.phase { return user }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PageTitle("Settings")

                if let user, user.emailVerified == false {
                    emailNudge(hasEmail: !user.email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

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
                        badge: user?.emailVerified == false ? "Confirm email" : nil
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
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $verifyingEmail) {
            AccountEmailVerificationSheet(currentEmail: user?.email ?? "") { _ in
                toast = .accountSuccess(AccountCopy.emailConfirmed)
                await session.refreshUser()
            }
        }
        .rewardsToast($toast)
    }

    /// The web's amber hero chip — "Confirm your email" / "Add your email" — where this page
    /// can carry it.
    private func emailNudge(hasEmail: Bool) -> some View {
        Button {
            verifyingEmail = true
        } label: {
            HStack(spacing: 13) {
                IconTile(systemName: "envelope.badge", tone: Theme.warning)
                VStack(alignment: .leading, spacing: 2) {
                    Text(hasEmail ? "Confirm your email" : "Add your email")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.primary)
                    Text("Your results and sign-in codes go there.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.amberSoft))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.amber.opacity(0.35), lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
