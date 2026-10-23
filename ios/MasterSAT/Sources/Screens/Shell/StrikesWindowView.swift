import SwiftUI
import MasterSATKit

/// What the header's flame opens: the strikes a student can spend, the run behind them, and the
/// way to the Shop.
///
/// **The big number is the spendable balance, never the run** (Ruling W-R2). The pill the student
/// just tapped shows the run — lessons attended in a row — and this window exists to answer the
/// question that pill cannot: how many of those are still in hand. A student who has spent six of
/// nine has three, and showing nine here would be an offer the Shop refuses.
///
/// It reads `/rewards/me/` once and nothing else (W-R3). The read is ticketed against
/// `RewardsStore` exactly as the Rewards hub's is, so the window and the pill behind it can never
/// disagree about the same two numbers, and the run it prints is `streakShown` — the figure the
/// flame has actually rolled to, not one a celebration is still holding back.
///
/// Sized to its content: the card around it (`HeaderWindowCard`) owns the padding, the width and
/// the scrolling, so nothing here reaches for the full height or nests a second scroll view.
struct StrikesWindowView: View {
    @Environment(Session.self) private var session
    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(AppRouter.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The one payload the window shows. Kept here rather than read from the store, because the
    /// store carries only the header's three figures and this window needs the strikes and the
    /// best run as well.
    @State private var mine: MyRewards?
    /// The last read did not land. With `mine` still set it means a stale refresh (the numbers
    /// stay, with a note); with nothing kept it is the failure state. Never an empty "0".
    @State private var failed = false
    /// The glow's far end. Flipped on appearance so the breath starts, and back whenever Reduce
    /// Motion is turned on mid-window.
    @State private var breathingOut = false
    /// VoiceOver's cursor, sent to the figures when the window opens (W-R7).
    @AccessibilityFocusState private var figuresFocused: Bool

    /// The window's wording, from the kit — the big number, the unit and the run line in one
    /// tested place.
    ///
    /// The run it is built with is `streakShown`: while a rise is being held for a celebration
    /// the header's flame still shows the old run, and a window drawn right under that flame must
    /// not print a number the flame has not rolled to yet. Only the three fields `StrikesWindow`
    /// reads are carried over — spendable, run, best — so no other figure can be invented here.
    private var window: StrikesWindow? {
        guard let mine else { return nil }
        guard let shown = celebrations.streakShown(rewards.streak), shown != mine.currentStreak else {
            return StrikesWindow(rewards: mine)
        }
        return StrikesWindow(rewards: MyRewards(
            points: mine.points,
            coins: mine.coins,
            currentStreak: shown,
            bestStreak: mine.bestStreak,
            strikes: mine.strikes
        ))
    }

    /// Both tracks of the glow are always drawn; the setting picks how far it travels, which is
    /// what "Reduce Motion never restructures the tree" means here. Still, it rests half way
    /// between the two ends rather than at the dim, small one.
    private var breathes: Bool { !reduceMotion }
    private var glowPhase: Double { breathes ? (breathingOut ? 1 : 0) : 0.5 }

    var body: some View {
        VStack(spacing: 4) {
            flame
            figures
                .accessibilityFocused($figuresFocused)
            shopButton
                .padding(.top, 14)
            RewardsExplainButton(explainer: .strike, title: RewardsExplainer.strike.title)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
        .task { await read() }
        // A beat, because a cursor set in the frame the window is inserted in finds nothing there
        // yet — the same wait `RankUpCard` takes. Nothing is announced: the student asked for this
        // window, so the cursor arriving on the figure is the whole answer (W-R7).
        .task {
            try? await Task.sleep(for: .milliseconds(250))
            if !Task.isCancelled { figuresFocused = true }
        }
    }

    // MARK: - The art

    /// The flame over a glow that breathes, in a box of a fixed size so the figures under it do
    /// not move while the glow swells. Decorative, and silent to VoiceOver.
    private var flame: some View {
        ZStack {
            Circle()
                .fill(RadialGradient(
                    colors: [Theme.strike.opacity(0.55), Theme.strike.opacity(0)],
                    center: .center,
                    startRadius: 0,
                    endRadius: 50
                ))
                .frame(width: 100, height: 100)
                // Scoped to the glow's own two properties, as `LoadingSkeleton` scopes its pulse:
                // a repeating animation applied to the whole update would carry whatever else
                // changed in it — the first layout, the numbers landing — and repeat that forever.
                .animation(breathes ? .easeInOut(duration: 2.2).repeatForever(autoreverses: true) : nil) {
                    $0.opacity(0.35 + 0.35 * glowPhase).scaleEffect(0.92 + 0.16 * glowPhase)
                }
            LottieClip(.strikeFlame, playback: .loop)
                .frame(width: 96, height: 96)
        }
        .frame(width: 120, height: 128)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { breathingOut = breathes }
        .onChange(of: breathes) { _, now in breathingOut = now }
    }

    // MARK: - The figures

    @ViewBuilder private var figures: some View {
        if let window {
            VStack(spacing: 4) {
                VStack(spacing: 2) {
                    Text(ScoreText.string(window.spendable))
                        .appFont(42, weight: .black, design: .rounded)
                        .foregroundStyle(Theme.strike)
                        .contentTransition(.numericText(value: Double(window.spendable)))
                    Text(window.spendable == 1 ? "strike to spend" : "strikes to spend")
                        .appFont(13, weight: .bold)
                }
                // The numeral and its unit are one sentence, so VoiceOver says "3 strikes to
                // spend" rather than "3" and then a caption of its own (W-R7).
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(window.spokenSpendable)

                Text(window.runLine)
                    .appFont(11.5, weight: .medium)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                // The numbers stay and say they may be old: a refresh that failed over good
                // figures never blanks them.
                if failed { StaleNote().padding(.top, 6) }
            }
        } else if failed {
            // Error is not empty: a failed read must never be drawn as "0 strikes to spend".
            ErrorState(
                title: "Your strikes aren't loading right now.",
                message: "Nothing has been spent — the window just couldn't fetch your total.",
                style: .inline
            ) {
                await Task { @MainActor in await read() }.value
            }
        } else {
            LoadingSkeleton(rows: 2, height: 22, label: "Loading your strikes")
                .padding(.horizontal, 48)
                .padding(.vertical, 6)
        }
    }

    // MARK: - The ways on

    private var shopButton: some View {
        Button {
            // Routing closes the window itself (`AppRouter.open`), so there is nothing to undo
            // here — and nothing that could leave a window floating over the Shop.
            router.open(.shop, baseURL: session.client.config.baseURL) { openURL($0) }
        } label: {
            Text("Spend in the Shop")
                .appFont(13, weight: .bold)
                .foregroundStyle(Theme.strike)
                .frame(maxWidth: .infinity, minHeight: 44)
                .padding(.horizontal, 12)
                // The mockup's warm surface, as the tint rather than as a hex pair: in dark mode
                // `Theme.strike` is the lighter orange and this fill follows it, where #fff4e6
                // would be a slab of cream.
                .background(Theme.strike.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(PressBounce())
        .accessibilityHint("Opens the Shop, where strikes are spent")
    }

    // MARK: - Reading

    /// One `/rewards/me/`, ordered against the header's store.
    ///
    /// The ticket is taken BEFORE the request and handed back to `apply`, so an answer older than
    /// a refresh the header has already taken cannot wind either of them back. A refused answer
    /// means a newer one landed somewhere this window never saw, so it asks once more rather than
    /// showing a skeleton over numbers that exist — the hub's rule, kept the same here.
    @MainActor
    private func read(again: Bool = true) async {
        let ticket = rewards.ticket()
        do {
            let me = try await session.rewards.me()
            guard rewards.apply(me, ticket: ticket) else {
                if again, !Task.isCancelled { await read(again: false) }
                return
            }
            if failed { failed = false }
            if mine != me {
                withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { mine = me }
            }
        } catch {
            // A cancelled read is not a failed one — the window closing must not paint an error
            // on its way out — and a failed one keeps the last good numbers.
            guard !Task.isCancelled else { return }
            if !failed { failed = true }
        }
    }
}
