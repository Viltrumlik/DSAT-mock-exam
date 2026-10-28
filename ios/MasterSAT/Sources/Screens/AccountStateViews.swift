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
            medal: StateMedal.blue("snowflake"),
            title: "Your account is frozen",
            message: forDebt
                ? "This month’s payment hasn’t been made, so your access is paused."
                : "Your access has been temporarily frozen by an administrator. You can’t use the platform right now. Please contact your administrator to restore your access."
        ) {
            if let owed {
                // The kit's `.owe`: Archivo on the red tint.
                Text(verbatim: "You owe \(UZS.format(owed))")
                    .appDisplayFont(19, monospacedDigits: true)
                    .tracking(-0.3)
                    .foregroundStyle(NewLook.red)
                    .multilineTextAlignment(.center)
                    // The amount is what this screen exists to say, and it is the most
                    // compressible thing on it: without this, the largest text sizes truncate it
                    // in preference to the paragraphs around it.
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .background(NewLook.red50, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            if forDebt {
                Text("Pay at your learning center. Your account unlocks by itself within 15 minutes of the payment being recorded.")
                    .appFont(14, weight: .medium)
                    .foregroundStyle(NewLook.ink4)
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
                Group { if checking { ProgressView().tint(NewLook.blueDeep) } else { Text("Check again") } }
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(NewLookButtonStyle(kind: .tint, size: .large))
            .disabled(checking)
            .accessibilityLabel(checking ? "Checking again" : "Check again")

            Button {
                Task { await session.signOut() }
            } label: {
                Text("Sign out").frame(maxWidth: .infinity)
            }
            // The ink pair: near-black with white words by day, pale with navy words at night.
            .buttonStyle(NewLookButtonStyle(kind: .ink, size: .large))
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
                Group {
                    if retrying {
                        ProgressView().tint(.white)
                    } else {
                        Label("Try again", systemImage: "arrow.clockwise")
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(NewLookButtonStyle(kind: .primary, size: .large))
            .disabled(retrying)
            // The spinner says nothing to VoiceOver; the label does (as `ErrorState`'s retry does).
            .accessibilityLabel(retrying ? "Trying again" : "Try again")
        }
    }
}

/// The shared layout of a whole-screen state — the "front door" look (mockups 93–94): the
/// sign-in's blue top with the wordmark, a white icon tile on the band's edge, a headline, a
/// sentence, anything the state has to add under it, and the actions at the bottom.
///
/// Most states are the four without the fifth — `detail` exists for what a state carries beside
/// its sentence: the debt on a frozen account, the version line on the update screen.
struct StateScreen<Detail: View, Actions: View>: View {
    private let medal: StateMedal.Look
    let title: String
    let message: String
    @ViewBuilder let detail: () -> Detail
    @ViewBuilder let actions: () -> Actions

    /// Optional, so a screen drawn without a session (a preview) still renders, never offline.
    @Environment(Session.self) private var session: Session?

    init(
        medal: StateMedal.Look, title: String, message: String,
        @ViewBuilder detail: @escaping () -> Detail,
        @ViewBuilder actions: @escaping () -> Actions
    ) {
        self.medal = medal
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
        self.init(medal: StateMedal.look(for: art), title: title, message: message, detail: detail, actions: actions)
    }

    /// The offline strip sits over the band's top (mockup 93, middle): the wordmark drops a row.
    private var offline: Bool { session?.connectivity.isOnline == false }

    var body: some View {
        // Scrollable, because at the accessibility text sizes a title, a message, an amount, a
        // paragraph and two full-width buttons are taller than a phone: without this the buttons
        // — the only way off a frozen account — go off the bottom with no way to reach them.
        // The minimum height keeps the actions at the bottom when it does fit, which is every
        // other size: a bare ScrollView would collapse the Spacer and float them mid-page.
        GeometryReader { screen in
            let total = screen.size.height + screen.safeAreaInsets.top
            ScrollView {
                VStack(spacing: 0) {
                    // The sign-in's band, shorter, under the status bar too.
                    AuthBand(height: min(262, total * 0.3), markTop: offline ? 40 : 6)
                    content
                }
                .frame(minHeight: total)
                .frame(maxWidth: .infinity)
            }
            .ignoresSafeArea(.container, edges: .top)
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(NewLook.page.ignoresSafeArea())
        // The band is blue in either appearance: the clock over it is white.
        .background(LightStatusBar())
        .animation(.easeInOut(duration: 0.25), value: offline)
    }

    private var content: some View {
        VStack(spacing: 0) {
            // The kit's `.door-tile`: 96 pt, r30, white, astride the band's edge.
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(NewLook.card)
                .newLookShadow(.card)
                .frame(width: 96, height: 96)
                .overlay { StateMedal(look: medal, diameter: 60) }
                .padding(.top, -48)
                .accessibilityHidden(true)
            Text(title)
                .appDisplayFont(28)
                .tracking(-0.6)
                .foregroundStyle(NewLook.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 26)
            Text(message)
                .appFont(15, weight: .medium)
                .foregroundStyle(NewLook.ink4)
                .lineSpacing(3)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
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
        // Takes the height the band leaves, so the actions sit at the bottom of the screen.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The usual state: a mark, a headline, a sentence and the actions.
extension StateScreen where Detail == EmptyView {
    init(medal: StateMedal.Look, title: String, message: String, @ViewBuilder actions: @escaping () -> Actions) {
        self.init(medal: medal, title: title, message: message, detail: { EmptyView() }, actions: actions)
    }

    init(art: LottieAsset, title: String, message: String, @ViewBuilder actions: @escaping () -> Actions) {
        self.init(art: art, title: title, message: message, detail: { EmptyView() }, actions: actions)
    }
}
