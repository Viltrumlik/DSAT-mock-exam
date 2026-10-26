import SwiftUI
import MasterSATKit

/// A frozen account: nothing to use, one way out.
///
/// The web makes the whole site inert behind an overlay that cannot be dismissed; this is that
/// overlay. Most endpoints would 403 anyway, but a student meeting a dozen separate "You do not
/// have access" errors learns nothing — one screen that says what happened does.
///
/// An unpaid month reads differently from an administrator's freeze, as in `FrozenOverlay.tsx`:
/// it says what is owed and that it ends by itself. `/lcup/me/finance/` stays open to a frozen
/// student for exactly this. A read that fails leaves the administrator's wording standing —
/// never an invented amount, and never "you owe nothing".
struct FrozenAccountView: View {
    @Environment(Session.self) private var session
    @State private var checking = false
    @State private var finance: MyFinance?

    private var forDebt: Bool { finance?.frozenForDebt == true }

    /// Above zero: lc-up can hold a debt freeze whose balance has since been settled by hand,
    /// and "You owe 0 UZS" would be a lie in the most alarming place in the app.
    private var owed: Double? {
        guard forDebt, let debt = finance?.debt, debt > 0 else { return nil }
        return debt
    }

    var body: some View {
        StateScreen(
            icon: "snowflake",
            tone: Theme.info,
            title: "Your account is frozen",
            message: forDebt
                ? "This month’s payment hasn’t been made, so your access is paused."
                : "Your access has been temporarily frozen by an administrator. You can’t use the platform right now. Please contact your administrator to restore your access."
        ) {
            if let owed {
                Text(verbatim: "You owe \(UZS.format(owed))")
                    .appFont(17, weight: .heavy, monospacedDigits: true)
                    .foregroundStyle(Theme.danger)
                    .multilineTextAlignment(.center)
                    // The amount is what this screen exists to say, and it is the most
                    // compressible thing on it: without this, the largest text sizes truncate it
                    // in preference to the paragraphs around it.
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                            .fill(Theme.dangerSoft)
                    )
            }
            if forDebt {
                Text("Pay at your learning center. Your account unlocks by itself within 15 minutes of the payment being recorded.")
                    .appFont(14, weight: .medium)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } actions: {
            Button {
                checking = true
                Task {
                    await session.refreshUser()
                    await loadFinance()
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
        .task { await loadFinance() }
    }

    /// Run on its own task so the screen keeps what it already knows if the view's task is
    /// cancelled mid-request; a failure simply leaves the wording as it was.
    private func loadFinance() async {
        let api = FinanceAPI(client: session.client)
        let request = Task { try await api.mine() }
        if let money = try? await request.value.finance, money != finance { finance = money }
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

/// The shared layout of a whole-screen state: a mark, a headline, a sentence, anything the
/// state has to add under it, and the actions.
///
/// Most states are the four without the fifth — `detail` exists for the one that carries a
/// figure (the debt on a frozen account), which belongs with the sentence rather than among
/// the buttons.
struct StateScreen<Detail: View, Actions: View>: View {
    /// What stands above the title: an icon tile, or — where the state is a failure the student
    /// can do something about — its art, which is the screen's one animation.
    private enum Mark {
        case icon(String, tone: Color)
        case art(LottieAsset)
    }

    private let mark: Mark
    let title: String
    let message: String
    @ViewBuilder let detail: () -> Detail
    @ViewBuilder let actions: () -> Actions

    init(
        icon: String, tone: Color, title: String, message: String,
        @ViewBuilder detail: @escaping () -> Detail,
        @ViewBuilder actions: @escaping () -> Actions
    ) {
        mark = .icon(icon, tone: tone)
        self.title = title
        self.message = message
        self.detail = detail
        self.actions = actions
    }

    init(
        art: LottieAsset, title: String, message: String,
        @ViewBuilder detail: @escaping () -> Detail,
        @ViewBuilder actions: @escaping () -> Actions
    ) {
        mark = .art(art)
        self.title = title
        self.message = message
        self.detail = detail
        self.actions = actions
    }

    var body: some View {
        // Scrollable, because at the accessibility text sizes a title, a message, an amount, a
        // paragraph and two full-width buttons are taller than a phone: without this the buttons
        // — the only way off a frozen account — go off the bottom with no way to reach them.
        // The minimum height keeps the screen centred when it does fit, which is every other
        // size: a bare ScrollView would collapse the Spacers and sit it all under the status bar.
        GeometryReader { proxy in
            ScrollView {
                content.frame(minWidth: proxy.size.width, minHeight: proxy.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(Theme.background.ignoresSafeArea())
    }

    private var content: some View {
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
            // The gap belongs to the detail, not to the sentence: a state without one must
            // sit exactly where it always has.
            VStack(spacing: 12) { detail() }
                .padding(.top, Detail.self == EmptyView.self ? 0 : 16)
            Spacer(minLength: 32)
            VStack(spacing: 10) { actions() }
                .padding(.bottom, 24)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: 460)
        // The height and the background belong to the scroll view above, not to its content.
        .frame(maxWidth: .infinity)
    }
}

/// The usual state: a mark, a headline, a sentence and the actions.
extension StateScreen where Detail == EmptyView {
    init(
        icon: String, tone: Color, title: String, message: String,
        @ViewBuilder actions: @escaping () -> Actions
    ) {
        self.init(icon: icon, tone: tone, title: title, message: message, detail: { EmptyView() }, actions: actions)
    }

    init(art: LottieAsset, title: String, message: String, @ViewBuilder actions: @escaping () -> Actions) {
        self.init(art: art, title: title, message: message, detail: { EmptyView() }, actions: actions)
    }
}
