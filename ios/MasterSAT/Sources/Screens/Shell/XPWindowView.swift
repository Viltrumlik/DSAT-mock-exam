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

    /// The payload behind the points box. The store carries only the header's three figures, and
    /// this window needs the points, the coins and the conversion rate as well.
    @State private var mine: MyRewards?
    /// `/rewards/me/` did not land. With nothing kept it is the failure state; with `mine` kept
    /// it is a refresh that failed over good numbers — which here means the conversion's
    /// read-back, the one read this window takes after the first. Never an empty "0 points".
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
    /// Counts conversions whose coin burst was skipped, so the haptic the burst would have given
    /// is still given — once. Over this window that is every conversion; see `celebrateMint()`.
    @State private var convertBuzz = 0
    /// Where the coin would burst from: the points box, measured in global coordinates, which is
    /// what `CelebrationCenter` draws in.
    @State private var pointsSpot = FrameBox()

    /// The glow's far end. Flipped on appearance, and back whenever Reduce Motion is turned on
    /// while the window is up.
    @State private var breathingOut = false
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

    /// A conversion whose outcome is unknown — the answer was lost and so was the read-back — so
    /// the points on screen may already have been spent. Convert stays off until a read confirms
    /// them, because a second conversion is a second conversion.
    private var unconfirmed: Bool { convertNote == Self.unconfirmedNote }

    /// Both tracks always exist; the setting picks the animation, never the tree. The bolt and the
    /// coin stop where they started, and the glow rests half way between its two ends rather than
    /// at the dim, small one.
    ///
    /// The budget is the twin's, and the flame's (`MotionBudget.allowsLoopingLottie`): the glow,
    /// the bolt and the coin are all `repeatForever` loops, and a loop never finishes, so Low
    /// Power rests them exactly as it rests a looping Lottie. `!reduceMotion` alone would turn
    /// three of them forever on a dying battery. Read per update rather than once, so the art
    /// follows the setting changing while the window is open.
    private var breathes: Bool {
        MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
            .allowsLoopingLottie
    }
    private var glowPhase: Double { breathes ? (breathingOut ? 1 : 0) : 0.5 }

    var body: some View {
        VStack(spacing: 4) {
            bolt
            figures
            pointsBox
                .padding(.top, 10)
            waysOn
                .padding(.top, 10)
            HStack(spacing: 2) {
                RewardsExplainButton(explainer: .xp, title: RewardsExplainer.xp.title)
                RewardsExplainButton(explainer: .points, title: RewardsExplainer.points.title)
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
        .task { await load() }
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
            // One expression, no branch — but the gate is on the output, not on `repeating:`.
            // `repeating: false` does not hold the initial value: the track plays through once
            // and rests at its FINAL keyframe, so a Reduce-Motion student would still see the
            // bolt pulse once as the window opens, which is exactly the motion W-R5 owes them
            // none of. So the animator keeps repeating and the scale it hands out is ignored
            // while the budget says rest.
            .keyframeAnimator(initialValue: 1.0, repeating: true) { view, scale in
                view.scaleEffect(breathes ? scale : 1)
            } keyframes: { _ in
                KeyframeTrack {
                    CubicKeyframe(1.09, duration: 0.64)
                    CubicKeyframe(1.04, duration: 0.32)
                    CubicKeyframe(1.0, duration: 0.64)
                }
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
            VStack(spacing: 4) {
                VStack(spacing: 2) {
                    Text(ScoreText.string(window.xp))
                        .appFont(42, weight: .black, design: .rounded)
                        .foregroundStyle(Theme.accent)
                        .contentTransition(.numericText(value: Double(window.xp)))
                    // "XP · #4 in the centre" while the board is in; the unit alone otherwise, so
                    // no half-sentence is left hanging after a "·".
                    Text(placeState == .shown ? "XP · \(window.placeLine)" : "XP")
                        .appFont(13, weight: .bold)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
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
                Text(climb)
                    .appFont(11.5, weight: .medium)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
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
            HStack(spacing: 10) {
                coin
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: "\(ScoreText.string(window.points)) points")
                        .appFont(15, weight: .heavy)
                    Text(window.coinsLine)
                        .appFont(11, weight: .medium)
                        .foregroundStyle(Theme.textSecondary)
                }
                .fixedSize(horizontal: false, vertical: true)
                // The count and what it is worth are one thing to VoiceOver: "125 points, 29
                // coins to spend". Convert keeps its own element, below.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(RewardsFormat.count(window.points, "point")), \(window.coinsLine)")
                Spacer(minLength: 4)
                convertControl(window)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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
                    if convertNote == Self.unconfirmedNote, !meFailed { checkAgain }
                }
                .padding(.top, 6)
            }
        }
    }

    /// The coin, turning slowly about its own axis. Decorative; the count beside it is the figure.
    ///
    /// Gated on the output, like the bolt: `repeating: false` would rest the coin at 360° — a full
    /// turn played once — rather than hold it still, so the angle is dropped instead.
    private var coin: some View {
        RewardsCoinArt(kind: .coin, size: 34)
            .keyframeAnimator(initialValue: 0.0, repeating: true) { view, angle in
                view.rotation3DEffect(
                    .degrees(breathes ? angle : 0),
                    axis: (x: 0, y: 1, z: 0),
                    perspective: 0.6
                )
            } keyframes: { _ in
                KeyframeTrack { LinearKeyframe(360.0, duration: 2.4) }
            }
            .accessibilityHidden(true)
    }

    /// Convert, or — when there is nothing whole to convert — the quiet line that says how far off
    /// the next coin is. A Convert button that would mint nothing is worse than no button.
    ///
    /// It is also off while nothing is confirmed (`unconfirmedNote`): a conversion is not
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
                .appFont(12, weight: .heavy)
                .foregroundStyle(Theme.accent)
                .padding(.horizontal, 10)
                .frame(minHeight: 30)
                .background(Theme.accent.opacity(0.12), in: Capsule())
                .hitTarget(44)
            }
            .buttonStyle(PressBounce())
            .disabled(converting || unconfirmed)
            // The spinner has no words of its own, and a button held off says why — "dimmed" is
            // not a reason.
            .accessibilityLabel(
                converting ? "Converting points"
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
    private var waysOn: some View {
        AdaptiveStack(spacing: 8, columnSpacing: 8) {
            wayOn("Leaderboard", tint: Theme.accent, hint: "Opens the leaderboard") {
                router.open(.leaderboard, baseURL: session.client.config.baseURL) { openURL($0) }
            }
            wayOn("Shop", tint: Theme.amber, hint: "Opens the Shop, where coins are spent") {
                router.open(.shop, baseURL: session.client.config.baseURL) { openURL($0) }
            }
        }
    }

    private func wayOn(
        _ title: String,
        tint: Color,
        hint: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .appFont(12, weight: .bold)
                .foregroundStyle(tint)
                .frame(maxWidth: .infinity, minHeight: 40)
                .padding(.horizontal, 10)
                // The mockup's two soft slabs as tints, so dark mode follows the brand rather
                // than printing #e8f0fd and #fff8e1 as slabs of paper.
                .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
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
            if !converting, convertNote == Self.unconfirmedNote { convertNote = nil }
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
    @MainActor
    private func convert() async {
        guard !converting, let before = mine, before.convertibleCoins > 0 else { return }
        converting = true
        convertNote = nil
        var answered = false
        // Coins were minted. Only that note is news the window already shows; every other note is
        // the only signal that the conversion did not happen.
        var minted = false
        do {
            let result = try await session.rewards.convert(points: nil)
            answered = true
            minted = result.minted > 0
            let after = before.applying(result.balances)
            if mine != after {
                withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { mine = after }
            }
            if result.minted > 0 { celebrateMint() }
            convertNote = result.detail.isEmpty
                ? (result.minted > 0
                    ? "Converted \(result.pointsSpent) points into \(RewardsFormat.count(result.minted, "coin"))."
                    : "Not enough points yet — \(RewardsFormat.count(after.pointsToNextCoin, "point")) to your next coin.")
                : result.detail
        } catch {
            // Said only after the read-back below: it decides which note is true.
        }
        let fresh = await loadMe()
        if !answered {
            if let fresh, fresh.coins > before.coins {
                // The answer was lost but the conversion was not.
                minted = true
                celebrateMint()
                convertNote = "Converted points into \(RewardsFormat.count(fresh.coins - before.coins, "coin"))."
            } else if fresh != nil {
                convertNote = "That didn't go through — your coins are as they were. Try again."
            } else {
                convertNote = Self.unconfirmedNote
            }
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
        if let convertNote {
            // After the figures have been read, not over them: speech started by the cursor's move
            // is not cut off. A success waits its turn behind that read; a conversion that did not
            // go through is said at normal priority, so it cannot be dropped.
            do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
            celebrations.announce(convertNote, queued: minted)
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
    @MainActor
    private func celebrateMint() {
        let bursts = celebrations.coinCount
        celebrations.coinBurst(at: pointsSpot.rect.celebrationPoint)
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
