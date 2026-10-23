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
            .accessibilityLabel(checking ? "Checking again" : "Check again")

            Button {
                Task { await session.signOut() }
            } label: {
                Text("Sign out").frame(maxWidth: .infinity)
            }
            // The ink pair: black with white text in light mode, white with black text in dark —
            // the label colour alone left white text on a white button there.
            .buttonStyle(PrimaryButtonStyle(tone: Theme.ink, text: Theme.onInk, fullWidth: true))
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
            art: .offline,
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
            // The spinner says nothing to VoiceOver; the label does (as `ErrorState`'s retry does).
            .accessibilityLabel(retrying ? "Trying again" : "Try again")
        }
    }
}

/// The shared layout of a whole-screen state: a mark, a headline, a sentence, the actions.
struct StateScreen<Actions: View>: View {
    /// What stands above the title: an icon tile, or — where the state is a failure the student
    /// can do something about — its art, which is the screen's one animation.
    private enum Mark {
        case icon(String, tone: Color)
        case art(LottieAsset)
    }

    private let mark: Mark
    let title: String
    let message: String
    @ViewBuilder let actions: () -> Actions

    init(
        icon: String, tone: Color, title: String, message: String,
        @ViewBuilder actions: @escaping () -> Actions
    ) {
        mark = .icon(icon, tone: tone)
        self.title = title
        self.message = message
        self.actions = actions
    }

    init(art: LottieAsset, title: String, message: String, @ViewBuilder actions: @escaping () -> Actions) {
        mark = .art(art)
        self.title = title
        self.message = message
        self.actions = actions
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 40)
            switch mark {
            case .icon(let icon, let tone):
                IconTile(systemName: icon, tone: tone, size: 72)
                    .padding(.bottom, 22)
            case .art(let asset):
                StateArt(asset, size: 128)
                    .padding(.bottom, 14)
            }
            Text(title)
                .appFont(26, weight: .heavy)
                .tracking(-0.6)
                .multilineTextAlignment(.center)
            Text(message)
                .appFont(15, weight: .medium)
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
