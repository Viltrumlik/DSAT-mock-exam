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
    /// The last read did not land, and nothing was kept — the failure state, with "Try again".
    /// There is no stale state to distinguish: the window is built fresh on every open and reads
    /// once, so a failure here is always a first failure over no numbers at all.
    @State private var failed = false
    /// The glow's far end. Flipped on appearance so the breath starts, and back whenever Reduce
    /// Motion is turned on mid-window.
    @State private var breathingOut = false
    /// VoiceOver's cursor, sent to the one combined figure — "3 strikes to spend" — when it
    /// appears (W-R7). On the element itself rather than on the stack around it: a container has
    /// no element of its own, so which child the cursor would land on is anyone's guess.
    @AccessibilityFocusState private var figuresFocused: Bool

    /// The window's wording, from the kit — the big number, the unit and the run line in one
    /// tested place.
    ///
    /// The run it is built with is `streakShown`: while a rise is being held for a celebration
    /// the header's flame still shows the old run, and a window drawn right under that flame must
    /// not print a number the flame has not rolled to yet. The kit takes that run as a parameter
    /// and keeps the two figures consistent with it, so nothing here rebuilds a payload.
    private var window: StrikesWindow? {
        guard let mine else { return nil }
        return StrikesWindow(rewards: mine, shownRun: celebrations.streakShown(rewards.streak))
    }

    /// Both tracks of the glow are always drawn; the setting picks how far it travels, which is
    /// what "Reduce Motion never restructures the tree" means here. Still, it rests half way
    /// between the two ends rather than at the dim, small one.
    ///
    /// The budget is the one `LottieClip` uses for the flame it sits behind
    /// (`MotionBudget.allowsLoopingLottie`): a `repeatForever` is a loop that never finishes, so
    /// Low Power rests it exactly as it rests the flame. Reading it per update rather than once
    /// keeps the two in step when the setting changes while the window is open.
    private var breathes: Bool {
        MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
            .allowsLoopingLottie
    }
    private var glowPhase: Double { breathes ? (breathingOut ? 1 : 0) : 0.5 }

    var body: some View {
        VStack(spacing: 4) {
            flame
            figures
            shopButton
                .padding(.top, 14)
            RewardsExplainButton(explainer: .strike, title: RewardsExplainer.strike.title)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
        .task { await read() }
        // The cursor goes to the figure when the figure is actually there. A fixed wait would
        // usually land before `/rewards/me/` answers, leaving the cursor on the loading skeleton
        // inside an `.isModal` card — and the numbers that replaced it might then never be heard.
        // So this is keyed on the figures appearing, with a short beat for the frame they are
        // inserted in (a cursor set in that frame finds nothing yet — the wait `RankUpCard`
        // takes). Lowered before it is raised, so a second appearance moves the cursor again.
        // Nothing is announced: the student asked for this window, so the cursor arriving on the
        // figure is the whole answer (W-R7).
        .task(id: window != nil) {
            guard window != nil else { return }
            figuresFocused = false
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
                    // The unit comes from the kit beside `spokenSpendable`, so the caption on
                    // screen and the sentence VoiceOver hears are one tested decision.
                    Text(window.spendableUnit)
                        .appFont(13, weight: .bold)
                }
                // The numeral and its unit are one sentence, so VoiceOver says "3 strikes to
                // spend" rather than "3" and then a caption of its own (W-R7).
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(window.spokenSpendable)
                .accessibilityFocused($figuresFocused)

                Text(window.runLine)
                    .appFont(11.5, weight: .medium)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                // No stale state here: the window is rebuilt on every open and reads once, so
                // there is never a failed refresh sitting over good numbers — a failure is
                // always a first failure, and `ErrorState` below is the whole of it.
            }
        } else if failed {
            // Error is not empty: a failed read must never be drawn as "0 strikes to spend".
            ErrorState(
                title: "Your strikes aren't loading right now.",
                message: "Nothing has been spent — the window just couldn't fetch your total.",
                style: .inline
            ) {
                // `ErrorState.retry` is already `@MainActor () async -> Void` and is run in a
                // task of its own, so there is nothing left for a wrapper to do here.
                await read()
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
                guard !Task.isCancelled else { return }
                if again {
                    await read(again: false)
                } else if mine == nil {
                    // Twice refused with nothing to show: the window has no numbers and no way
                    // to ask for more, so it must offer "Try again" rather than a skeleton that
                    // never resolves.
                    failed = true
                }
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
