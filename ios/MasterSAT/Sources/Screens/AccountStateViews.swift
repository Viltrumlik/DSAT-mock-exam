import SwiftUI
import MasterSATKit

/// A frozen account: nothing to use, one way out.
///
/// The web makes the whole site inert behind an overlay that cannot be dismissed; this is that
/// overlay. Most endpoints would 403 anyway, but a student meeting a dozen separate "You do not
/// have access" errors learns nothing — one screen that says what happened does.
struct FrozenAccountView: View {
    @Environment(Session.self) private var session
    @State private var checking = false

    var body: some View {
        StateScreen(
            icon: "snowflake",
            tone: Theme.info,
            title: "Your account is frozen",
            message: "Your access has been temporarily frozen by an administrator. You can’t use the platform right now. Please contact your administrator to restore your access."
        ) {
            Button {
                checking = true
                Task {
                    await session.refreshUser()
                    checking = false
                }
            } label: {
                Group { if checking { ProgressView() } else { Text("Check again") } }
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(SecondaryButtonStyle(fullWidth: true))
            .disabled(checking)

            Button {
                Task { await session.signOut() }
            } label: {
                Text("Sign out").frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(tone: Color(.label), fullWidth: true))
        }
    }
}

/// Signed in, but nothing to show: offline on a first launch after an update, with no copy of
/// the account on the phone. Deliberately not the sign-in form.
struct UnreachableView: View {
    @Environment(Session.self) private var session
    @State private var retrying = false

    var body: some View {
        StateScreen(
            icon: "wifi.exclamationmark",
            tone: Theme.warning,
            title: "Can’t reach MasterSAT",
            message: "Check your internet connection. You’re still signed in — nothing is lost."
        ) {
            Button {
                retrying = true
                Task {
                    await session.restore()
                    retrying = false
                }
            } label: {
                Group { if retrying { ProgressView().tint(.white) } else { Text("Try again") } }
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(retrying)
        }
    }
}

/// The shared layout of a whole-screen state: an icon, a headline, a sentence, the actions.
struct StateScreen<Actions: View>: View {
    let icon: String
    let tone: Color
    let title: String
    let message: String
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 40)
            IconTile(systemName: icon, tone: tone, size: 72)
                .padding(.bottom, 22)
            Text(title)
                .font(.system(size: 26, weight: .heavy))
                .tracking(-0.6)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.top, 10)
            Spacer(minLength: 32)
            VStack(spacing: 10) { actions() }
                .padding(.bottom, 24)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: 460)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
    }
}
