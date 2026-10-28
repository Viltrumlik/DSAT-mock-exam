import SwiftUI
import MasterSATKit

/// What the header's XP pill opens: the total, where it puts the student on the board, the points
/// waiting to become coins, and the two ways on — the Leaderboard and the Shop.
///
/// The twin of `StrikesWindowView`, and deliberately built the same way: one ticketed
/// `/rewards/me/`, the same three states over it, the same Reduce-Motion idiom, the same silent
/// art. Two things are its own.
///
/// **The XP shown is the pill's figure, not the payload's** (W-R3). While a gain is in flight the
/// pill shows `xp − heldXP`, and this window is drawn directly under that pill: showing
/// `MyRewards.xp` here would hand the student a number the flame-side pill has not rolled to, and
/// then roll it a second time when the flight lands. So the pill's figure is passed into
/// `XPWindow`'s `xp:` override and the payload's own total is never read.
///
/// **The place is a second read with a second outcome.** It comes from
/// `LeaderboardQuery.heroBoard` — the same question the Rewards hero and the welcome-back check
/// ask, so a place seen here can never contradict one seen there — and that read can fail while
/// `/rewards/me/` worked. It then says so: never "#—", and never a silently missing line, which
/// on a board surface reads as "you are not on the board" (error ≠ empty).
///
/// Sized to its content: the card around it (`HeaderWindowCard`) owns the padding, the width and
/// the scrolling.
struct XPWindowView: View {
    @Environment(Session.self) private var session
    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(AppRouter.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    /// The payload behind the points box. The store carries only the header's three figures, and
    /// this window needs the points, the coins and the conversion rate as well.
    @State private var mine: MyRewards?
    /// `/rewards/me/` did not land. With nothing kept it is the failure state; with `mine` kept
    /// it is a refresh that failed over good numbers — the conversion's read-back, "Check again",
    /// or the read each return to the front takes. Never an empty "0 points".
    @State private var meFailed = false
    /// The hero board, for the place and the climb line — and its own failure, kept apart from
    /// the payload's so one can be shown while the other is said to have failed.
    @State private var board: LeaderboardBoard?
    @State private var boardFailed = false
    /// The board's request order. A reference, so taking a ticket never re-renders the window.
    @State private var reads = XPWindowReads()

    @State private var converting = false
    @State private var confirmingConvert = false
    @State private var convertNote: String?
    /// A conversion whose outcome is unknown — the answer was lost and so was the read-back — so
    /// the points on screen may already have been spent. Convert stays off until a read confirms
    /// them, because a second conversion is a second conversion.
    ///
    /// Asked of `ConversionOutcome` when the conversion is decided (`== .unconfirmed`), never
    /// matched back out of the sentence on screen: the hold is a money guard, and keying it on
    /// wording is how the two copies of this flow drifted apart in the first place.
    @State private var unconfirmed = false
    /// Counts conversions whose coin burst was skipped, so the haptic the burst would have given
    /// is still given — once. Over this window that is every conversion; see `celebrateMint()`.
    @State private var convertBuzz = 0
    /// Where the coin would burst from: the points box, measured in global coordinates, which is
    /// what `CelebrationCenter` draws in.
    @State private var pointsSpot = FrameBox()

    /// The far end of all three loops — the glow, the bolt's pulse and the coin's turn. Flipped on
    /// appearance, and back whenever the motion budget closes while the window is up.
    ///
    /// One flag for the three, which is the point: a `@State` flipped once and an
    /// `.animation(…repeatForever…) { }` scoped to the properties it drives is the only loop idiom
    /// here that actually stops. A `keyframeAnimator(repeating: true)` keeps invalidating its
    /// output every frame however the budget reads, which is the cost
    /// `MotionBudget.allowsLoopingLottie` exists to avoid.
    @State private var breathingOut = false
    /// The coin's own far end, and not `breathingOut` for one reason: the coin is inserted with
    /// the figures, long after the bolt's `onAppear` has already flipped that flag, and a flag
    /// that is already at its far end is not a change — so the coin would be handed 360° with no
    /// animation to get there and would never turn. It has its own, flipped from its own
    /// appearance.
    @State private var coinTurning = false
    /// VoiceOver's cursor, sent to the figures when the window opens (W-R7).
    @AccessibilityFocusState private var figuresFocused: Bool

    /// The window's numbers and wording, from the kit.
    ///
    /// Built with the pill's XP rather than the payload's, for the reason in the type's doc. The
    /// board is passed as it stands: `placeLine` and `climbLine` are read only once `placeState`
    /// says the board is actually in, so a board that is still loading or has failed never prints
    /// as "Not on the board yet".
    private var window: XPWindow? {
        guard let mine else { return nil }
        // The store's XP is nil only until the header's first read lands — and this window's own
        // read fills it. Until then there is no pill figure to agree with, so the payload's own
        // total stands.
        let shown = rewards.xp.map { max(0, $0 - celebrations.heldXP) } ?? mine.xp
        return XPWindow(rewards: mine, board: board, xp: shown)
    }

    /// The place's three outcomes, which are not the payload's: the board can be out, in, or
    /// failed while the numbers above it are perfectly good.
    private enum PlaceState { case loading, shown, failed }

    private var placeState: PlaceState {
        if board != nil { return .shown }
        return boardFailed ? .failed : .loading
    }

    /// Both tracks always exist; the setting picks the animation, never the tree. The bolt and the
    /// coin stop where they started, and the glow rests half way between its two ends rather than
    /// at the dim, small one.
    ///
    /// The budget is the twin's, and the flame's (`MotionBudget.allowsLoopingLottie`): the glow,
    /// the bolt and the coin are all `repeatForever` loops, and a loop never finishes, so Low
    /// Power rests them exactly as it rests a looping Lottie. `!reduceMotion` alone would turn
    /// three of them forever on a dying battery. Read per update rather than once, so the art
    /// follows the setting changing while the window is open.
    ///
    /// And it is honoured, not merely consulted: when it says rest, the animation handed to all
    /// three is `nil` and the values they are given are the resting ones, so nothing is
    /// invalidated again until the setting changes.
    private var breathes: Bool {
        MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
            .allowsLoopingLottie
    }
    /// The glow rests half way between its two ends rather than at the dim, small one.
    private var glowPhase: Double { breathes ? (breathingOut ? 1 : 0) : 0.5 }
    /// The bolt rests where it started.
    private var boltScale: Double { breathes && breathingOut ? 1.09 : 1 }
    /// The coin rests face on. A full turn and no turn are the same picture, so the far end is a
    /// whole 360° — `autoreverses: false` then starts each lap from where the last one began
    /// instead of unwinding it.
    private var coinAngle: Double { breathes && coinTurning ? 360 : 0 }

    var body: some View {
        // The new look (mockup 12): the title, the bolt medallion beside the figure, the climb
        // chip, the points box, Leaderboard and Shop, the two explainers.
        VStack(alignment: .leading, spacing: 4) {
            Text("XP and points")
                .appDisplayFont(22)
                .tracking(-0.4)
                .foregroundStyle(NewLook.ink)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, 10)
            figures
            pointsBox
                .padding(.top, 14)
            waysOn
                .padding(.top, 12)
            // One above the other at the accessibility sizes, as the Leaderboard/Shop pair below
            // is: two full titles cannot share the ~300 pt an SE leaves inside this card at AX5.
            AdaptiveStack(columnAlignment: .center, spacing: 2) {
                RewardsExplainButton(explainer: .xp, title: RewardsExplainer.xp.title)
                RewardsExplainButton(explainer: .points, title: RewardsExplainer.points.title)
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
        // Read on every activation, not once.
        //
        // A window left open across a background/foreground would otherwise show two moments at
        // once: `RewardsRefresher` re-reads `/rewards/me/` into `RewardsStore` on the return, so
        // the store-driven XP above moves while `mine` — the points, the coins, the rate — does
        // not. The Convert alert quotes `mine`, so it could offer "20 points into 2 coins" while
        // the server spends 50 and mints 5. No money is lost (the server decides Max), but the
        // student confirms a trade that is not the one they are shown.
        //
        // `.task(id:)` rather than a close on background: the window stays usable, and this needs
        // nothing of `RootView.swift`, which belongs to another session this round.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await load()
        }
        // The flag is NOT cleared here. It stands for a request that is still out, and this view
        // going is exactly the case where that matters: a route can take the window mid-conversion
        // (`closeHeaderWindow(force:)`), and lowering the flag on the way out would let the window
        // be reopened and a second, non-idempotent conversion start over the first. `convert()`
        // lowers it from its own task, which a dismissal does not cancel.
        // The cursor goes to the figure when the figure is actually there. A fixed wait from the
        // window's own appearance would usually land before `/rewards/me/` answers, leaving the
        // cursor on the loading skeleton inside an `.isModal` card — and the numbers that replaced
        // it might then never be heard. So this is keyed on the figures appearing, with a short
        // beat for the frame they are inserted in (a cursor set in that frame finds nothing yet —
        // the wait `RankUpCard` takes). Lowered before it is raised, so a second appearance moves
        // the cursor again. Nothing is announced: the student asked for this window, so the cursor
        // arriving on the figure is the whole answer (W-R7). The one thing that does speak is the
        // conversion's result, below.
        .task(id: window != nil) {
            guard window != nil else { return }
            figuresFocused = false
            try? await Task.sleep(for: .milliseconds(250))
            if !Task.isCancelled { figuresFocused = true }
        }
        .sensoryFeedback(.success, trigger: convertBuzz)
        .alert(
            Text(verbatim: "Convert \(mine?.maxConvertiblePoints ?? 0) points into \(RewardsFormat.count(mine?.convertibleCoins ?? 0, "coin"))?"),
            isPresented: $confirmingConvert
        ) {
            Button("Convert") { Task { await convert() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Converted points don't come back, and your XP stays where it is. To choose an amount, open Points.")
        }
    }

    // MARK: - The art

    /// The bolt over a glow that breathes, in a box of a fixed size so the figures under it do not
    /// move while it pulses. Decorative, and silent to VoiceOver.
    ///
    /// Drawn rather than loaded: a looping Lottie bolt would be a second clip on a screen that can
    /// already show three, and a file in a byte budget this round does not touch (W-R5).
    private var bolt: some View {
        ZStack {
            Circle()
                .fill(RadialGradient(
                    colors: [Theme.accent.opacity(0.45), Theme.accent.opacity(0)],
                    center: .center,
                    startRadius: 0,
                    endRadius: 45
                ))
                .frame(width: 90, height: 90)
                // Scoped to the glow's own two properties, as `LoadingSkeleton` scopes its pulse:
                // a repeating animation applied to the whole update would carry whatever else
                // changed in it — the first layout, the numbers landing — and repeat that forever.
                .animation(breathes ? .easeInOut(duration: 2.2).repeatForever(autoreverses: true) : nil) {
                    $0.opacity(0.35 + 0.35 * glowPhase).scaleEffect(0.92 + 0.16 * glowPhase)
                }
            ZStack {
                BoltShape(lit: false).fill(Theme.accent)
                // The lit edge of the mockup's two-tone bolt. White rather than a second blue, so
                // it reads as light catching the face in both colour schemes.
                BoltShape(lit: true).fill(Color.white.opacity(0.38))
            }
            .frame(width: 70, height: 92)
            // The glow's idiom, for the reason in `breathingOut`'s doc: a
            // `keyframeAnimator(repeating: true)` runs forever and merely has its output thrown
            // away when the budget is closed, so a dying battery still paid for a `scaleEffect`
            // invalidated every frame for as long as the window was open. The repeat is scoped to
            // the one property it drives, so no other change in the update is caught in it.
            //
            // The mockup's three-stop pulse (1 → 1.09 → 1.04 → 1) becomes one autoreversing
            // breath over the same ~1.6 s: a two-point animation is what a far-end flag can
            // express, and at this amplitude the hold at 1.04 was never legible anyway.
            .animation(breathes ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true) : nil) {
                $0.scaleEffect(boltScale)
            }
        }
        .frame(width: 110, height: 104)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { breathingOut = breathes }
        .onChange(of: breathes) { _, now in breathingOut = now }
    }

    // MARK: - The figures

    @ViewBuilder private var figures: some View {
        if let window {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 14) {
                    // The medallion floats and glints (and holds still under Reduce Motion).
                    RewardMedallion(kind: .xp, size: 64)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text(ScoreText.string(window.xp))
                                .appDisplayFont(44, monospacedDigits: true)
                                .tracking(-1)
                                .foregroundStyle(NewLook.blueText)
                                .contentTransition(.numericText(value: Double(window.xp)))
                            Text("XP")
                                .appDisplayFont(17)
                                .foregroundStyle(NewLook.blueText)
                        }
                        // The place while the board is in; nothing hangs there otherwise.
                        if placeState == .shown {
                            Text(window.placeLine)
                                .appFont(16, weight: .semibold)
                                .foregroundStyle(NewLook.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 0)
                }
                // One sentence rather than a numeral followed by a caption of its own (W-R7). The
                // place rides with it because "455 XP" and "·" read as two fragments apart.
                .accessibilityElement(children: .ignore)
                // Spoken with the formatting the screen uses, not the raw integer: `ScoreText`
                // is what wrote the numeral above, so the two cannot drift apart.
                .accessibilityLabel(
                    placeState == .shown
                        ? "\(ScoreText.string(window.xp)) XP, \(window.placeLine)"
                        : "\(ScoreText.string(window.xp)) XP"
                )
                // On the combined element itself rather than on the stack around it: a container
                // has no element of its own, so which child the cursor would land on is anyone's
                // guess (W-R7).
                .accessibilityFocused($figuresFocused)

                place(window)

                // The numbers stay and say they may be old: a refresh that failed over good
                // figures never blanks them — with a way out, because this window has no pull to
                // refresh and Convert is held off until a read confirms the figures.
                if meFailed {
                    VStack(spacing: 6) {
                        StaleNote()
                        checkAgain
                    }
                    .padding(.top, 6)
                }
            }
        } else if meFailed {
            // Error is not empty: a failed read must never be drawn as "0 XP".
            ErrorState(
                title: "Your XP isn't loading right now.",
                message: "Nothing has been lost — the window just couldn't fetch your total.",
                style: .inline
            ) {
                // `ErrorState.retry` is already `@MainActor () async -> Void` and is run in a task
                // of its own, so there is nothing left for a wrapper to do here.
                _ = await loadMe()
            }
        } else {
            LoadingSkeleton(rows: 2, height: 22, label: "Loading your XP")
                .padding(.horizontal, 48)
                .padding(.vertical, 6)
        }
    }

    /// The way out of a read that did not land.
    ///
    /// This window has no pull to refresh — it is a card, not a page — so a note that only says
    /// "couldn't refresh" would stick for as long as the window is open, over figures Convert is
    /// then held off from trading. The button is the gesture the note used to ask for: one more
    /// `/rewards/me/`, which clears both the note and the hold on Convert when it goes through.
    private var checkAgain: some View {
        Button("Check again") { Task { await loadMe() } }
            .appFont(11.5, weight: .heavy)
            .foregroundStyle(Theme.accentText)
            .buttonStyle(.plain)
            .hitTarget(44)
    }

    /// The line under the place — and, when the board failed, the place's own failure.
    ///
    /// `climbLine` rather than `passLine`: it is the sentence a ranked student is never left
    /// without, whether they are at #1, have a row above them to name, or have a board that does
    /// not carry one. It is the Rewards hero's line too, from the same place in the kit.
    @ViewBuilder private func place(_ window: XPWindow) -> some View {
        switch placeState {
        case .shown:
            if let climb = window.climbLine {
                Label(climb, systemImage: "arrow.up.right")
                    .appFont(14, weight: .bold)
                    .foregroundStyle(NewLook.blueDeep)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 32)
                    .background(NewLook.blue50, in: Capsule())
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .loading:
            LoadingSkeleton(rows: 1, height: 12, label: "Loading your place")
                .padding(.horizontal, 64)
                .padding(.top, 2)
        case .failed:
            // Said as a failure, never as "not on the board": a missing place on a board surface
            // is read as an answer, and this is not one.
            VStack(spacing: 4) {
                Text("Your place didn't load — your XP above is safe.")
                    .appFont(11.5, weight: .medium)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Try again") { Task { await loadBoard() } }
                    .appFont(11.5, weight: .heavy)
                    .foregroundStyle(Theme.accentText)
                    .buttonStyle(.plain)
                    .hitTarget(44)
            }
            .padding(.top, 2)
        }
    }

    // MARK: - The points box

    /// Points, coins and Convert, on an inset of its own so the trade is one thing on the card.
    @ViewBuilder private var pointsBox: some View {
        if let window {
            // A row while the words fit beside the coin; a column once they cannot. Checked on the
            // device at AX5, where the fixed row squeezed "9 points" into a sliver of width and
            // broke it mid-word ("point / s"), with the coin crushed to an edge and the next-coin
            // line stacked one word per line beside it.
            AdaptiveStack(spacing: 10, columnSpacing: 8) {
                coin
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: "\(ScoreText.string(window.points)) points")
                        .appDisplayFont(17)
                        .foregroundStyle(NewLook.ink)
                    Text(window.coinsLine)
                        .appFont(14, weight: .medium)
                        .foregroundStyle(NewLook.ink4)
                }
                .fixedSize(horizontal: false, vertical: true)
                // The count and what it is worth are one thing to VoiceOver: "125 points, 29
                // coins to spend". Convert keeps its own element, below.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(RewardsFormat.count(window.points, "point")), \(window.coinsLine)")
                // Not a plain `Spacer`: once the box is a column it would only add the gap twice.
                AdaptiveSpacer()
                convertControl(window)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NewLook.page, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { pointsSpot.rect = $0 }
            // Contain, not combine: Convert must stay its own VoiceOver target.
            .accessibilityElement(children: .contain)

            if let convertNote {
                VStack(spacing: 6) {
                    Text(convertNote)
                        .appFont(11, weight: .semibold)
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    // The unconfirmed note is the one that asks the student to look, and the only
                    // one Convert is held off behind. It carries the button itself unless the
                    // figures above already offer it, so there is never a second one.
                    if unconfirmed, !meFailed { checkAgain }
                }
                .padding(.top, 6)
            }
        }
    }

    /// The coin, turning slowly about its own axis. Decorative; the count beside it is the figure.
    ///
    /// The glow's idiom, like the bolt: a flag flipped once, and a repeat scoped to the one
    /// property it drives, so that a closed budget actually stops the loop rather than discarding
    /// its output frame by frame.
    private var coin: some View {
        // Our own point coin: this box counts points.
        RewardsCoinArt(kind: .point, size: 42)
            .animation(breathes ? .linear(duration: 2.4).repeatForever(autoreverses: false) : nil) {
                $0.rotation3DEffect(
                    .degrees(coinAngle),
                    axis: (x: 0, y: 1, z: 0),
                    perspective: 0.6
                )
            }
            .accessibilityHidden(true)
            .onAppear { coinTurning = breathes }
            .onChange(of: breathes) { _, now in coinTurning = now }
    }

    /// Convert, or — when there is nothing whole to convert — the quiet line that says how far off
    /// the next coin is. A Convert button that would mint nothing is worse than no button.
    ///
    /// It is also off while nothing is confirmed (`unconfirmed`, set from the outcome itself rather
    /// than by matching the sentence it prints — a money guard keyed on wording is what let the two
    /// copies of this flow drift apart unnoticed): a conversion is not
    /// idempotent, and after a lost answer AND a lost read-back the points on screen may already
    /// have been spent, so trading them again could mint a second time. That is the simpler
    /// guarantee than reasoning about how stale the figures might be — the hold lifts the moment
    /// a read goes through, which "Check again" is there to ask for.
    @ViewBuilder private func convertControl(_ window: XPWindow) -> some View {
        if window.convertibleCoins > 0 {
            Button { confirmingConvert = true } label: {
                HStack(spacing: 5) {
                    if converting {
                        ProgressView().controlSize(.mini).tint(Theme.accent)
                    }
                    Text(converting ? "Converting…" : "Convert")
                }
                .appFont(15, weight: .bold)
                .foregroundStyle(NewLook.blueDeep)
                .padding(.horizontal, 16)
                .frame(minHeight: 40)
                .background(NewLook.blue50, in: Capsule())
                .hitTarget(44)
            }
            .buttonStyle(PressBounce())
            // `headerWindowBusy` as well as `converting`: a conversion whose window a route closed
            // keeps running, and this window may be a NEW one opened over it, with `converting`
            // false and a stale `convertibleCoins`. Converting again there would spend twice.
            .disabled(converting || unconfirmed || router.headerWindowBusy)
            // The spinner has no words of its own, and a button held off says why — "dimmed" is
            // not a reason.
            .accessibilityLabel(
                converting || router.headerWindowBusy ? "Converting points"
                    : "Convert points into \(RewardsFormat.count(window.convertibleCoins, "coin"))"
            )
            .accessibilityHint(unconfirmed ? "Unavailable until your points are checked again" : "")
        } else {
            Text(window.nextCoinLine)
                .appFont(11, weight: .heavy)
                .foregroundStyle(Theme.textLabel)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - The ways on

    /// Side by side, one above the other at the accessibility sizes. Routing closes the window
    /// itself (`AppRouter.open`), so neither of these has anything to undo.
    ///
    /// And both are held off while a conversion is out, because that close is a forced one: a
    /// route must take the window with it or leave it floating over the tab the student has been
    /// sent to. Holding the two buttons is what keeps the forced path off the one journey where
    /// the window has something left to say.
    private var waysOn: some View {
        AdaptiveStack(spacing: 8, columnSpacing: 8) {
            // The leaderboard sheet (mockup 13), the same short board Today's rank card opens.
            wayOn("Leaderboard", icon: "trophy", tint: NewLook.blueDeep, fill: NewLook.blue50, hint: "Opens the leaderboard") {
                router.openLeaderboardSheet()
            }
            wayOn("Shop", icon: "bag", tint: NewLook.bronzeInk, fill: NewLook.bronze50, hint: "Opens the Shop, where coins are spent") {
                router.open(.shop, baseURL: session.client.config.baseURL) { openURL($0) }
            }
        }
        .disabled(converting)
    }

    private func wayOn(
        _ title: String,
        icon: String,
        tint: Color,
        fill: Color,
        hint: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .appFont(16, weight: .bold)
                .foregroundStyle(tint)
                .frame(maxWidth: .infinity, minHeight: 48)
                .padding(.horizontal, 10)
                // The kit's two soft pills — blue and bronze — dark-aware.
                .background(fill, in: Capsule())
        }
        .buttonStyle(PressBounce())
        .accessibilityHint(hint)
    }

    // MARK: - Reading

    /// The two reads, side by side — the payload and the board each land, and fail, on their own.
    @MainActor
    private func load() async {
        async let me: MyRewards? = loadMe()
        async let place: Void = loadBoard()
        _ = await (me, place)
    }

    /// One `/rewards/me/`, ordered against the header's store.
    ///
    /// The ticket is taken BEFORE the request and handed back to `apply`, so an answer older than
    /// a refresh the header has already taken cannot wind either of them back — the conversion's
    /// read-back against a slower read started when the window opened is exactly that race. A
    /// refused answer means a newer one landed somewhere this window never saw, so it asks once
    /// more rather than showing a skeleton over numbers that exist.
    @MainActor
    @discardableResult
    private func loadMe(again: Bool = true) async -> MyRewards? {
        let ticket = rewards.ticket()
        do {
            let me = try await session.rewards.me()
            guard rewards.apply(me, ticket: ticket) else {
                guard !Task.isCancelled else { return nil }
                if again { return await loadMe(again: false) }
                // Twice refused with nothing to show: the window has no numbers and no second
                // read coming, so it must offer "Try again" rather than a skeleton that never
                // resolves. With numbers kept, the `StaleNote` path already says they may be old.
                if mine == nil { meFailed = true }
                return nil
            }
            if meFailed { meFailed = false }
            // A read the window actually took, so "check again" has been done and Convert is let
            // go — after the ticket, never before it: a refused answer leaves `mine` as it was,
            // and lifting the hold over figures the window did not take is the double-mint this
            // hold exists to prevent. Not the conversion's own read-back, which decides its note
            // itself.
            if !converting, unconfirmed {
                unconfirmed = false
                convertNote = nil
            }
            if mine != me {
                withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { mine = me }
            }
            return me
        } catch {
            // A cancelled read is not a failed one — the window closing must not paint an error on
            // its way out — and a failed one keeps the last good numbers.
            guard !Task.isCancelled else { return nil }
            if !meFailed { meFailed = true }
            return nil
        }
    }

    /// The hero board, for the place and the climb line.
    ///
    /// `LeaderboardQuery.heroBoard` and nothing else (W-R3): the Rewards hero and the welcome-back
    /// check ask the same question, so a place read here is the same place, not a near-neighbour
    /// of it. Only the newest read asked is shown (`LatestOnly`), so a "Try again" tapped twice
    /// cannot land the older answer last.
    ///
    /// It does not note the rank as the hub does: what the student has *seen* is the welcome-back
    /// check's bookkeeping, and a window that can be opened and shut in a second is not where that
    /// belongs. Nor does it wait for a quiet stage — this window reports `coversCelebrations`, so
    /// while it is up the stage is held anyway.
    ///
    /// **The place can outrun the XP beside it, and that is accepted.** The board is the server's
    /// current answer and already counts a gain still held for a flight, while the figure above it
    /// is the pill's `xp − heldXP` (W-R3) — so a window opened over a held gain can read "#4" next
    /// to a total that has not yet risen to it. Accepted rather than re-read, because the only
    /// moment a re-read would fix is `heldXP` reaching zero, and it cannot reach zero while this
    /// window is open: the card covers the stage, so no flight runs and nothing is released until
    /// it closes. A re-read keyed on that would be a line that never fires. The two numbers are a
    /// place that is true now and a total that is one held gain behind it — never a wrong place,
    /// and the next open shows both settled.
    @MainActor
    private func loadBoard() async {
        let ticket = reads.board.issue()
        do {
            let fresh = try await LeaderboardAPI(client: session.client).board(.heroBoard)
            guard !Task.isCancelled, reads.board.isNewestAsked(ticket) else { return }
            if board != fresh {
                withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { board = fresh }
            }
            if boardFailed { boardFailed = false }
        } catch {
            guard !Task.isCancelled, reads.board.isNewestAsked(ticket) else { return }
            if !boardFailed { boardFailed = true }
        }
    }

    // MARK: - Converting

    /// Nothing is known — the answer was lost and so was the read-back — so the note sends the
    /// student to look; the next read that goes through takes it away (`loadMe`).
    ///
    /// Worded for a window, not a page: the hub says "pull down to check your coins" because the
    /// hub has a pull. This card's scroll view has none, so the note names the button beside it
    /// (`checkAgain`) instead of asking for a gesture that does nothing here.
    private static let unconfirmedNote = "We couldn't confirm that went through. Check again to see your coins."

    /// Spends Max — every point that buys a whole coin. The hub's flow, not a second version of
    /// it: not idempotent (a second call is a second conversion), so it runs once per
    /// confirmation, with the button off from the press until the read-back has settled, and is
    /// never retried.
    ///
    /// The read-back is the truth either way — and the button stays off through it, because an
    /// answer that was dropped on the way back may still have been a conversion that landed. When
    /// it shows the coins rose after an error, the note says it worked rather than leaving "That
    /// didn't go through" over a box that went up.
    ///
    /// **Which outcome this was, and what it says, is `ConversionOutcome` in the kit** — shared
    /// with `RewardsHubView.convert()`, the other surface that spends points, and tested there
    /// rather than in two uncheckable copies (which had already drifted apart once). What stays
    /// here is this window's own I/O: the request, the busy flag, the balances written into
    /// `@State`, the burst, the focus move and the announcement.
    ///
    /// The window refuses to close for the length of it (`AppRouter.headerWindowBusy`). Unlike the
    /// hub, which lives in a tab nothing tears down, this view is destroyed on close and every
    /// write below would go with it — the note, the announcement on both failure branches, and the
    /// burst's own coordinates.
    @MainActor
    private func convert() async {
        guard !converting, !router.headerWindowBusy, let before = mine, before.convertibleCoins > 0 else { return }
        converting = true
        router.setHeaderWindowBusy(true)
        // Lowered on every path, including the ones that leave early below: this task is not
        // cancelled by the window going, so the flag cannot latch — and until it is lowered a
        // reopened window will not offer Convert again.
        defer { router.setHeaderWindowBusy(false) }
        convertNote = nil
        unconfirmed = false
        var answered: ConversionResult?
        // Coins were minted. Only that note is news the window already shows; every other note is
        // the only signal that the conversion did not happen.
        var minted = false
        // What happened, in words. Held HERE and not only in `convertNote`, because a route may
        // have taken the window with it by now (`closeHeaderWindow(force:)`) — then every write to
        // this view's state goes nowhere, and reading it back for the announcement would say
        // nothing on exactly the branches that must be said aloud.
        var note: String?
        do {
            let result = try await session.rewards.convert(points: nil)
            answered = result
            // Decided from the answer alone: a server that spoke is the authority on its own
            // conversion, so the read-back below is not consulted on this path.
            let outcome = ConversionOutcome.decide(answer: result, before: before, readBack: nil)
            minted = outcome.mintedCoins
            let after = before.applying(result.balances)
            if mine != after {
                withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { mine = after }
            }
            if minted { celebrateMint() }
            note = outcome.text(unconfirmed: Self.unconfirmedNote)
            convertNote = note
        } catch {
            // Said only after the read-back below: it decides which note is true.
        }
        let fresh = await loadMe()
        if answered == nil {
            let outcome = ConversionOutcome.decide(answer: nil, before: before, readBack: fresh)
            minted = outcome.mintedCoins
            // The answer was lost but, when the coins rose, the conversion was not.
            if minted { celebrateMint() }
            note = outcome.text(unconfirmed: Self.unconfirmedNote)
            convertNote = note
            unconfirmed = outcome == .unconfirmed
        }
        converting = false
        // A conversion that spent every coin it could leaves no Convert button, and VoiceOver's
        // cursor goes with it: the figures are where the window's result shows, so it goes there.
        // Lowered first, with a yield between: the cursor is usually already on the figures when
        // the window is driven by VoiceOver, and writing `true` over `true` moves nothing. A beat
        // rather than a bare yield, so the two writes land in different updates instead of being
        // coalesced into one that changes nothing.
        figuresFocused = false
        try? await Task.sleep(for: .milliseconds(50))
        figuresFocused = true
        if let note {
            // After the figures have been read, not over them: speech started by the cursor's move
            // is not cut off. A success waits its turn behind that read; a conversion that did not
            // go through is said at normal priority, so it cannot be dropped.
            //
            // Said from the local copy, so a window a route closed mid-conversion still tells the
            // student what became of their points — the centre outlives this view.
            do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
            celebrations.announce(note, queued: minted)
        }
    }

    /// A coin would burst where the points box is; when the burst is skipped, the success haptic
    /// it would have given is given here instead — never both.
    ///
    /// **Over this window it is always skipped, and that is the intended outcome.** The card
    /// reports `coversCelebrations`, so `CelebrationCenter` holds every cue while it is up — which
    /// is right: the overlay draws *under* the window, and a coin flying behind a dimmed card
    /// would be a celebration the student mostly cannot see. The student is not left with nothing,
    /// because the three signals that matter are not the burst: the coin count rolls in the box
    /// under their thumb, the note says what happened in words, and this gives the success haptic
    /// the burst would have carried. Written as the hub writes it — measure, ask, give the haptic
    /// only if no burst was counted — rather than as an unconditional buzz, so the day the window
    /// stops covering the stage it still cannot double up.
    /// A route can take the window mid-conversion, and then `pointsSpot.rect` is where the box
    /// WAS: bursting there would throw coins at a corner of whatever page the student has landed
    /// on. With no window up the burst has no place of its own, so it goes to the middle of the
    /// stage, as every other placeless cue does.
    @MainActor
    private func celebrateMint() {
        let bursts = celebrations.coinCount
        let spot = router.headerWindow == .xp ? pointsSpot.rect.celebrationPoint : nil
        celebrations.coinBurst(at: spot)
        if celebrations.coinCount == bursts { convertBuzz += 1 }
    }
}

/// The window's request order, nothing renders from — a reference, so taking a ticket never
/// re-renders it. One ticket line, for the board; `/rewards/me/` is ordered by the store's.
@MainActor
private final class XPWindowReads {
    var board = LatestOnly()
}

/// The mockup's two-tone bolt, drawn in its own 70 × 92 box and scaled to whatever it is given.
///
/// `lit` is the smaller, brighter face laid over the whole bolt; the two share their first three
/// points, so the highlight sits exactly on the body rather than beside it.
private struct BoltShape: Shape {
    let lit: Bool

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width / 70, rect.height / 92)
        let originX = rect.midX - 35 * scale
        let originY = rect.midY - 46 * scale
        let corners: [(CGFloat, CGFloat)] = lit
            ? [(40, 2), (6, 52), (32, 52), (30, 64), (52, 34), (38, 34)]
            : [(40, 2), (6, 52), (32, 52), (26, 90), (64, 34), (38, 34)]
        var path = Path()
        for (index, corner) in corners.enumerated() {
            let point = CGPoint(x: originX + corner.0 * scale, y: originY + corner.1 * scale)
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        path.closeSubpath()
        return path
    }
}
