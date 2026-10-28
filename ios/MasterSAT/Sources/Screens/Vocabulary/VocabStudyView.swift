import SwiftUI
import MasterSATKit

/// What a mode hands back when its round is over.
///
/// Every mode ends on the same screen, so each one only has to say what it wants counted —
/// the chrome, the saving, and the two buttons are not four separate problems.
struct StudyOutcome {
    let title: String
    var description: String?
    let stats: [ModeStat]
    var restartLabel = "Study again"
    /// Extra content between the stats and the actions. Only the test uses it.
    var extra: AnyView?
}

/// A study run in any of the four modes.
///
/// `assignmentId` is the homework the set page was opened from; the run is opened bound to
/// it, so the homework — not the server's guess — gets the credit.
struct VocabStudyView: View {
    let mode: StudyMode
    let set: VocabSetDetail
    var assignmentId: Int?
    /// Called once, when the server has the first round of this cover (its grading call landed);
    /// the set page celebrates it. A round whose save failed is not announced until a retry lands.
    var onFinished: (@MainActor () -> Void)? = nil
    let onClose: @MainActor () -> Void

    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var runner: VocabStudyRunner?
    @State private var outcome: StudyOutcome?
    /// Bumped to replay the mode. Every mode holds its deck in `@State`, so a fresh
    /// identity is what re-deals it — resetting fields one by one would forget one.
    @State private var runKey = 0
    /// Once per cover: "Study again" is more practice, not another finish to announce.
    @State private var reportedFinish = false

    var body: some View {
        Group {
            if let runner {
                if let startError = runner.startError, !runner.isStarted {
                    // Nothing played without a session can be credited, so the round does
                    // not go on as if it could. The server's own sentence says why — "That
                    // homework is not assigned to you for this set." among them.
                    startFailed(startError)
                } else if !runner.isStarted {
                    // No card is dealt until the server has opened the run. Dealing first
                    // would let a student answer cards that a failed start then throws away.
                    dealing
                } else if let outcome {
                    ModeOutcomeView(
                        mode: mode,
                        title: outcome.title,
                        description: outcome.description,
                        stats: outcome.stats,
                        summary: runner.summary,
                        errorText: runner.saveError?.errorDescription,
                        isSaving: runner.isCompleting || (runner.completionRequested && !runner.isFinished && runner.saveError == nil),
                        restartLabel: outcome.restartLabel,
                        onRestart: { Task { await restart() } },
                        onExit: exit,
                        onRetrySave: { Task { await runner.complete() } },
                        extra: outcome.extra
                    )
                } else {
                    modeView(runner)
                        .id(runKey)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { await begin() }
        // The round is in once the server has it: the flashcards send the grading call at their
        // final verdict, the other modes in `finish`. Watching the runner's own flag (not the
        // end screen) keeps a failed save from being celebrated.
        .onChange(of: runner?.isFinished == true) { _, saved in
            if saved { reportFinish() }
        }
        .onChange(of: scenePhase) { _, phase in
            // Leaving mid-run banks what has been answered so far. Without this, a student
            // who does 20 of 25 cards and takes a call gets credited for none of them.
            if phase != .active, let runner, !runner.isFinished {
                Task { await runner.flush(isPartial: true) }
            }
        }
    }

    @ViewBuilder
    private func modeView(_ runner: VocabStudyRunner) -> some View {
        switch mode {
        case .flashcard:
            FlashcardView(runner: runner, set: set, onExit: exit, onFinish: finish)
        case .test:
            VocabTestView(runner: runner, set: set, onExit: exit, onFinish: finish)
        case .matching:
            MatchingView(runner: runner, set: set, onExit: exit, onFinish: finish)
        case .speed:
            SpeedView(runner: runner, set: set, onExit: exit, onFinish: finish)
        }
    }

    /// Opening the run — inside the same frame, so the way out is there from the first frame.
    private var dealing: some View {
        StudyShell(title: mode.title, subtitle: set.title, tone: mode.tone, onExit: onClose) {
            VStack(spacing: 12) {
                ProgressView().controlSize(.large)
                Text("Dealing your words…")
                    .appFont(13, weight: .semibold)
                    .foregroundStyle(NewLook.ink4)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// The web's `ModeStartError`, inside the same frame so the way out never disappears.
    private func startFailed(_ error: APIError) -> some View {
        StudyShell(title: mode.title, subtitle: set.title, tone: mode.tone, onExit: onClose) {
            ScrollView {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .appFont(26)
                        .foregroundStyle(NewLook.orange)
                        .capDynamicType()
                        .frame(width: 56, height: 56)
                        .background(Circle().fill(NewLook.orange50))
                        .accessibilityHidden(true)
                    Text("Couldn't start this round")
                        .appDisplayFont(19)
                        .foregroundStyle(NewLook.ink)
                    Text(error.errorDescription ?? ErrorState.nothingLost)
                        .appFont(14)
                        .foregroundStyle(NewLook.ink4)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    VStack(spacing: 10) {
                        Button { Task { await restart() } } label: {
                            Label("Try again", systemImage: "arrow.counterclockwise")
                        }
                        .buttonStyle(NewLookToneButtonStyle(tone: mode.tone))
                        Button("Back to vocabulary", action: onClose)
                            .buttonStyle(NewLookButtonStyle(kind: .light, size: .large))
                    }
                    .padding(.top, 8)
                }
                .padding(24)
                .frame(maxWidth: .infinity)
            }
        }
    }

    @MainActor
    private func finish(_ result: StudyOutcome) {
        outcome = result
        // The grading call — what marks the set complete and can master this game. A latch:
        // the flashcards already sent it at the final verdict, and this only waits for it.
        Task { await runner?.complete() }
    }

    /// The one-shot: the first saved round of this cover is announced, never a replay.
    @MainActor
    private func reportFinish() {
        guard !reportedFinish else { return }
        reportedFinish = true
        onFinished?()
    }

    @MainActor
    private func begin() async {
        guard runner == nil else { return }
        let created = VocabStudyRunner(
            mode: mode.kitMode,
            words: VocabGames.shuffle(set.words),
            setId: set.id,
            assignmentId: assignmentId,
            api: session.student
        )
        runner = created
        await created.begin()
    }

    @MainActor
    private func restart() async {
        let previous = runner
        outcome = nil
        runner = nil
        runKey += 1
        // Whatever the last run still holds — a grading call that failed, answers not yet
        // sent — goes out before the run is let go, rather than vanishing with it.
        if let previous, previous.isStarted, !previous.isFinished {
            Task {
                await previous.flush(isPartial: true)
                // A finished round whose first grading call failed is graded by this flush, and
                // nothing watches the old runner any more: its finish is reported here.
                if previous.isFinished { reportFinish() }
            }
        }
        await begin()
    }

    @MainActor
    private func exit() {
        // The run being left, taken once: the flush and the check after it are about the same one.
        let leaving = runner
        Task {
            await leaving?.flush(isPartial: true)
            // Leaving can be what grades a finished round; say so before the cover goes — the
            // change may never reach `onChange` once it is closing. A no-op if it was said.
            if leaving?.isFinished == true { reportFinish() }
            onClose()
        }
    }
}

// MARK: - Flashcards

/// Flip, self-grade, then drill whatever did not stick until the pile is empty.
///
/// Rounds rather than one long queue: a card answered wrong comes back in the NEXT round,
/// not three cards later, so a student sees the pile shrink instead of a queue that will
/// not end. Every verdict from every round is reported — a word answered wrong then right
/// records both, and the progress model sees the real history.
///
/// A verdict does not deal the next card. It starts a five-second hold with the definition
/// face up: the pause is study time a student was skipping, and it is also what stops the
/// mode being cleared by mashing one button. Everything but flipping is locked until the
/// next card is dealt.
struct FlashcardView: View {
    @Bindable var runner: VocabStudyRunner
    let set: VocabSetDetail
    let onExit: @MainActor () -> Void
    let onFinish: @MainActor (StudyOutcome) -> Void

    private enum Phase { case study, checkpoint }

    /// The hold after a verdict — long enough that the definition is actually read.
    static let holdSeconds = 5
    /// The card turning over: 250 ms, eased in and out, no overshoot — the card is the content.
    static let flipAnimation = Animation.easeInOut(duration: 0.25)

    /// Non-nil only while a graded card is being held.
    private struct Hold: Equatable {
        let correct: Bool
        var secondsLeft: Int
    }

    @State private var deck: [VocabWord] = []
    @State private var index = 0
    @State private var flipped = false
    @State private var missed: [VocabWord] = []
    @State private var round = 1
    @State private var reviewed = 0
    @State private var correct = 0
    @State private var phase: Phase = .study
    @State private var hold: Hold?
    @State private var holdTask: Task<Void, Never>?
    /// The throttle itself. Separate from `hold` because two taps can land before the view
    /// re-renders with the buttons disabled.
    @State private var locked = false
    /// One tick per flip the student asked for — the selection haptic.
    @State private var flips = 0
    /// Cards dealt after a verdict (and rounds started): each one moves VoiceOver to the card.
    @State private var deals = 0
    /// VoiceOver's cursor on the card.
    @AccessibilityFocusState private var cardFocused: Bool

    /// The swipe gives a verdict exactly as the buttons do, and is off when they are.
    private var swipeVerdict: (@MainActor (Bool) -> Void)? {
        guard hold == nil, !locked else { return nil }
        return { answer($0) }
    }

    private var current: VocabWord? { index < deck.count ? deck[index] : nil }

    var body: some View {
        StudyShell(
            title: "Flashcards",
            subtitle: set.title,
            tone: StudyMode.flashcard.tone,
            progress: phase == .study && !deck.isEmpty ? Double(index) / Double(deck.count) : nil,
            trailing: phase == .study
                ? AnyView(StudyPill(text: "\(index + 1) / \(deck.count)", tone: StudyMode.flashcard.tone, ink: StudyMode.flashcard.ink))
                : nil,
            onExit: onExit
        ) {
            switch phase {
            case .study: study
            case .checkpoint: checkpoint
            }
        }
        .task { if deck.isEmpty { deck = set.words } }
        // The cursor stays where the student left it — on the verdict button they pressed, which
        // sits disabled for the hold — while the card in front of it is replaced. After a deal,
        // it moves to the new card. The wait lets the update that deals the card finish first
        // (focus can only land on an element that exists), and leaving the screen cancels it.
        .task(id: deals) {
            guard deals > 0 else { return }
            cardFocused = false
            try? await Task.sleep(for: .milliseconds(150))
            if !Task.isCancelled { cardFocused = true }
        }
        // The mode is left by a button, not a navigation, so nothing else would stop the
        // hold: without this it keeps counting and deals a card in a screen that is gone.
        .onDisappear { holdTask?.cancel() }
        .sensoryFeedback(.selection, trigger: flips)
        // A light tap when a verdict is given — by the buttons or by the swipe alike.
        .sensoryFeedback(.impact(weight: .light), trigger: reviewed)
    }

    @ViewBuilder
    private var study: some View {
        ScrollView {
            VStack(spacing: 14) {
                if round > 1 {
                    NewLookChip(text: "Round \(ScoreText.string(round)) · still learning",
                                systemImage: "arrow.counterclockwise", style: .orange, small: false)
                }

                if let word = current {
                    // Flipping stays live during the hold — the pause is a pause, not a freeze.
                    FlipCard(word: word, flipped: flipped, onSwipe: swipeVerdict) {
                        withAnimation(Self.flipAnimation) { flipped.toggle() }
                        flips += 1
                    }
                    .accessibilityFocused($cardFocused)
                    // A new card is a new view: a finger still down from the last one, or a
                    // definition scrolled halfway, never carries over to the next word.
                    .id(word.id)
                    .padding(.horizontal, 16)
                }

                if let hold {
                    FlashcardHoldStrip(correct: hold.correct, secondsLeft: hold.secondsLeft, total: Self.holdSeconds)
                        .padding(.horizontal, 16)
                } else {
                    Text("Tap to flip — swipe right if you knew it, left to see it again.")
                        .appFont(12.5, weight: .medium)
                        .foregroundStyle(NewLook.muted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 20)
                        // VoiceOver cannot swipe the card sideways: it hears the way it can.
                        .accessibilityLabel("Double-tap the card to turn it over. Choose Correct or Still learning from the card's actions, or with the buttons below.")
                }

                HStack(spacing: 12) {
                    verdict("Still learning", icon: "arrow.counterclockwise", tone: FlashcardTone.amber, isCorrect: false)
                    verdict("Correct", icon: "checkmark", tone: FlashcardTone.emerald, isCorrect: true)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
            .padding(.top, 12)
        }
    }

    private func verdict(_ label: String, icon: String, tone: VocabPalette.Tone, isCorrect: Bool) -> some View {
        let chosen = hold?.correct == isCorrect
        let held = hold != nil
        return Button { answer(isCorrect) } label: {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 18, weight: .bold))
                    .foregroundStyle(tone.solid)
                    .accessibilityHidden(true)
                Text(label).appFont(16, weight: .heavy).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(tone.ink)
            .frame(maxWidth: .infinity, minHeight: 60)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous).fill(tone.solid.opacity(0.12))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(tone.solid.opacity(chosen ? 0.9 : 0.28), lineWidth: 2)
            )
            .contentShape(Rectangle())
        }
        // Not `.plain`: it greys a disabled label, and the verdict just given must stay lit.
        .buttonStyle(FocusPress())
        .disabled(held)
        // The verdict just given stays readable; the other one recedes for the hold.
        .opacity(held && !chosen ? 0.4 : 1)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }

    /// Between rounds: a progress moment, not a results table.
    private var checkpoint: some View {
        let learned = deck.filter { w in !missed.contains { $0.id == w.id } }
        let cleared = deck.isEmpty ? 0.0 : Double(learned.count) / Double(deck.count)

        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 12) {
                        NewLookTile(systemName: "flag.fill", tone: .blue)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Round \(ScoreText.string(round)) done")
                                .appDisplayFont(19)
                                .tracking(-0.3)
                                .foregroundStyle(NewLook.ink)
                                .accessibilityAddTraits(.isHeader)
                            Text("Keep going — the pile shrinks every round.")
                                .appFont(13, weight: .medium)
                                .foregroundStyle(NewLook.ink4)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    // Two segments, not a bar with a gap: what stuck and what is coming
                    // back are the whole story of the round.
                    GeometryReader { geometry in
                        HStack(spacing: 2) {
                            Rectangle().fill(FlashcardTone.emerald.solid)
                                .frame(width: max(0, geometry.size.width * cleared))
                            Rectangle().fill(FlashcardTone.amber.solid)
                        }
                    }
                    .frame(height: 10)
                    .clipShape(Capsule())
                    Text("\(ScoreText.string(learned.count)) of \(ScoreText.string(deck.count)) cards cleared this round")
                        .appFont(13, weight: .semibold)
                        .foregroundStyle(NewLook.ink4)
                }
                .newLookCard(padding: 18)

                reviewColumn("You know these", words: learned, tone: FlashcardTone.emerald, icon: "sparkles",
                             emptyText: "Nothing landed this round — that's what the next one is for.")
                reviewColumn("Keep practising these", words: missed, tone: FlashcardTone.amber,
                             icon: "arrow.counterclockwise", emptyText: nil)

                Button {
                    practiseMissed()
                } label: {
                    Label("Practice \(ScoreText.string(missed.count)) word\(missed.count == 1 ? "" : "s") again",
                          systemImage: "arrow.counterclockwise")
                }
                .buttonStyle(NewLookButtonStyle(kind: .primary, size: .large))
            }
            .padding(16)
        }
    }

    private func reviewColumn(
        _ title: String,
        words: [VocabWord],
        tone: VocabPalette.Tone,
        icon: String,
        emptyText: String?
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(tone.tile)
                    .frame(width: 34, height: 34)
                    .overlay(
                        Image(systemName: icon)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(tone.solid)
                    )
                    .accessibilityHidden(true)
                Text(title)
                    .appFont(16, weight: .heavy)
                    .foregroundStyle(NewLook.ink)
                Spacer(minLength: 0)
                Text(ScoreText.string(words.count))
                    .appFont(13, weight: .heavy, monospacedDigits: true)
                    .foregroundStyle(tone.ink)
                    .padding(.horizontal, 9)
                    .frame(minHeight: 22)
                    .background(Capsule().fill(tone.solid.opacity(0.14)))
            }
            if words.isEmpty {
                if let emptyText {
                    Text(emptyText).appFont(13).foregroundStyle(NewLook.ink4)
                }
            } else {
                WrappingChips(words: words.map(\.word), tone: tone.solid, ink: tone.ink)
            }
        }
        .newLookCard(padding: 16)
    }

    @MainActor
    private func answer(_ isCorrect: Bool) {
        guard !locked, hold == nil, let word = current else { return }
        locked = true
        // Reported here, not when the hold ends: a student who walks out mid-pause — or
        // after 20 of 25 cards — keeps every verdict they actually gave.
        runner.record(wordId: word.id, correct: isCorrect)
        reviewed += 1
        if isCorrect { correct += 1 } else { missed.append(word) }

        // Graded here too, and not after the hold: the hold opens five seconds after the
        // FINAL card in which leaving would bank the run as unfinished, and an unfinished
        // run can never master the game. The student has finished the set by now.
        if index + 1 >= deck.count && missed.isEmpty {
            Task { await runner.complete() }
        }

        // The hold is meant to teach, so the answer has to be on screen for it.
        withAnimation(Self.flipAnimation) { flipped = true }
        hold = Hold(correct: isCorrect, secondsLeft: Self.holdSeconds)
        holdTask?.cancel()
        holdTask = Task { @MainActor in
            for left in stride(from: Self.holdSeconds - 1, through: 0, by: -1) {
                try? await Task.sleep(for: .seconds(1))
                if Task.isCancelled { return }
                if left > 0 { hold?.secondsLeft = left }
            }
            advance()
        }
    }

    /// End the hold and deal the next card — or close the round.
    @MainActor
    private func advance() {
        holdTask = nil
        hold = nil
        flipped = false
        locked = false

        if index + 1 < deck.count {
            index += 1
            deals += 1
            return
        }
        if missed.isEmpty {
            onFinish(StudyOutcome(
                title: "Every word learned",
                description: "You cleared all \(ScoreText.string(set.words.count)) words in \(ScoreText.string(round)) round\(round == 1 ? "" : "s").",
                stats: [
                    ModeStat(label: "Words", value: ScoreText.string(set.words.count)),
                    ModeStat(label: "Cards reviewed", value: ScoreText.string(reviewed)),
                    .accuracy(VocabGames.accuracyPercent(correct: correct, of: reviewed), tone: .success),
                ]
            ))
        } else {
            phase = .checkpoint
        }
    }

    private func practiseMissed() {
        deck = missed
        missed = []
        index = 0
        flipped = false
        round += 1
        phase = .study
        deals += 1
    }
}

/// The hold between a verdict and the next card. On its own, two greyed-out buttons would
/// just look broken — this names what happens next and shows the time draining away.
private struct FlashcardHoldStrip: View {
    let correct: Bool
    let secondsLeft: Int
    let total: Int

    var body: some View {
        HStack(spacing: 12) {
            let tone = correct ? FlashcardTone.emerald : FlashcardTone.amber
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(tone.tile)
                .frame(width: 36, height: 36)
                .overlay(
                    Image(systemName: correct ? "checkmark" : "arrow.counterclockwise")
                        .appFont(16, weight: .bold)
                        .capDynamicType()
                        .foregroundStyle(tone.solid)
                        .accessibilityHidden(true)
                )
            VStack(alignment: .leading, spacing: 8) {
                Text(correct
                     ? "Nice — sit with the definition for a beat."
                     : "Read it through — you'll see this one again.")
                    .appFont(14, weight: .bold)
                    .foregroundStyle(NewLook.ink)
                    .fixedSize(horizontal: false, vertical: true)
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(NewLook.line)
                        Capsule()
                            .fill(NewLook.blue)
                            .frame(width: geometry.size.width * CGFloat(secondsLeft) / CGFloat(max(total, 1)))
                            .animation(.linear(duration: 1), value: secondsLeft)
                    }
                }
                .frame(height: 6)
            }
            StudyPill(text: "\(secondsLeft)s", icon: "timer", tone: NewLook.blue, ink: NewLook.blueText)
                .accessibilityHidden(true)
        }
        .newLookCard(padding: 12)
        .accessibilityElement(children: .combine)
    }
}

/// The card's two faces and the turn between them.
///
/// Only one face is ever drawn. `turn` (0 word up, 1 definition up) is what animates, so this body
/// runs for every frame of the turn and the faces change places at the half-way frame, where the
/// card is edge-on and shows nothing: the change cannot be seen. The first build kept both faces
/// drawn and cross-faded their opacity along the whole turn, so for 250 ms a mirrored ghost of the
/// face turning away lay over the face turning in — plainest a little before 45° — and the card
/// flickered. Under Reduce Motion the card does not turn and the faces cross-fade instead; the
/// tree is the same either way, the setting only picks the values.
private struct FlipFaces<Front: View, Back: View>: View, Animatable {
    var turn: Double
    let calm: Bool
    let front: Front
    let back: Back

    // `nonisolated`: `Animatable` is, and a `View`'s members are main-actor otherwise.
    nonisolated var animatableData: Double {
        get { turn }
        set { turn = newValue }
    }

    var body: some View {
        let backUp = turn >= 0.5
        ZStack {
            front
                .opacity(calm ? 1 - turn : (backUp ? 0 : 1))
                .allowsHitTesting(!backUp)
            back
                .opacity(calm ? turn : (backUp ? 1 : 0))
                .allowsHitTesting(backUp)
                // Pre-turned, so that once the card has turned it reads the right way round.
                .rotation3DEffect(.degrees(calm ? 0 : 180), axis: (x: 0, y: 1, z: 0))
        }
        .rotation3DEffect(.degrees(calm ? 0 : turn * 180), axis: (x: 0, y: 1, z: 0))
    }
}

/// A two-sided card. The corner chip is the flip affordance — the whole face responds, but
/// nothing about a word on its own says there is a back.
struct FlipCard: View {
    let word: VocabWord
    let flipped: Bool
    /// Swiping gives the verdict — right "Correct", left "Still learning" — a shortcut for the
    /// buttons under the card. Nil while a verdict is held: the card only flips then.
    var onSwipe: (@MainActor (Bool) -> Void)? = nil
    let onFlip: @MainActor () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// How far the card is being dragged sideways. A gesture state, so a drag the system cancels
    /// (a call, a notification, the app going inactive) puts the card back by itself instead of
    /// leaving a tilt — and a stamp — on it.
    @GestureState(resetTransaction: Transaction(animation: Motion.focus)) private var drag: CGFloat = 0

    /// Past this far, letting go gives the verdict.
    private static let threshold: CGFloat = 110
    /// The card follows the finger exactly this far…
    private static let reach: CGFloat = 160
    /// …then is held back like a rubber band: each point further moves it less, and it never
    /// goes more than this much past `reach`.
    private static let stretch: CGFloat = 40

    /// Where the card is drawn for a drag of `translation`. The slope is 1 at `reach` and falls
    /// away smoothly from there, so the card does not catch as it passes the point. The verdict
    /// is decided on the finger, not on this: pulling harder gives no other answer.
    static func follow(_ translation: CGFloat) -> CGFloat {
        let distance = abs(translation)
        guard distance > reach else { return translation }
        let held = reach + stretch * (1 - exp(-(distance - reach) / stretch))
        return translation < 0 ? -held : held
    }

    /// How far a drag moves the card: only a mostly sideways one does, so a long definition
    /// being scrolled up and down never nudges it. The same rule draws the card and decides the
    /// verdict, so what the stamp says is what letting go gives.
    private static func sideways(_ translation: CGSize) -> CGFloat {
        abs(translation.width) > abs(translation.height) ? translation.width : 0
    }

    /// The verdict a card dragged this far would give — nil until it has gone far enough.
    private static func verdict(at offset: CGFloat) -> Bool? {
        abs(offset) >= threshold ? offset > 0 : nil
    }

    /// The verdict letting go would give now.
    private var leaning: Bool? { Self.verdict(at: drag) }

    /// Stamp ink: white on the deep light-mode fills, dark on the pale dark-mode ones (white on
    /// #34d399 or #fbbf24 is under 2:1; this is above 9:1).
    private static let stampInk = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 15 / 255, green: 23 / 255, blue: 42 / 255, alpha: 1) : .white })

    var body: some View {
        let shift = Self.follow(drag)
        FlipFaces(turn: flipped ? 1 : 0, calm: reduceMotion, front: face(back: false), back: face(back: true))
            // The stamp's own beat (120 ms) is scoped to the stamp: the card's return and its
            // 250 ms turn keep theirs.
            .overlay(alignment: .top) { stamp.animation(Motion.focusTap, value: leaning) }
            .offset(x: shift)
            // A tilt that follows the finger, about the bottom edge; none under Reduce Motion.
            .rotationEffect(.degrees(reduceMotion ? 0 : Double(shift) / 18), anchor: .bottom)
            .frame(maxWidth: .infinity)
            .frame(height: 360)
            .contentShape(Rectangle())
            .onTapGesture { onFlip() }
            // Simultaneous, so the faces' own up-and-down scrolling still works.
            .simultaneousGesture(swipe)
            .sensoryFeedback(trigger: leaning) { _, now in now == nil ? nil : .selection }
            // One element for VoiceOver: it reads the side that is up, a double-tap turns the card
            // over (the other side is one turn away), and the two verdicts are actions on it — only
            // while a verdict is allowed (`onSwipe` is nil during the hold), like the buttons below.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.spokenSide(of: word, flipped: flipped))
            .accessibilityHint(flipped ? "Double-tap to turn it back to the word." : "Double-tap to turn it over to the definition.")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { onFlip() }
            .accessibilityActions {
                if let onSwipe {
                    Button("Correct") { onSwipe(true) }
                    Button("Still learning") { onSwipe(false) }
                }
            }
            // VoiceOver does not read a label that changes under its cursor, so a turn would
            // pass in silence. Say the side now up — whoever turned the card, the student or the
            // verdict that holds the definition open.
            .onChange(of: flipped) { _, now in
                AccessibilityNotification.Announcement(Self.spokenSide(of: word, flipped: now)).post()
            }
    }

    /// A side in full — what the eye reads.
    private static func spokenSide(of word: VocabWord, flipped: Bool) -> String {
        var parts: [String] = []
        if flipped {
            parts.append("Definition: \(word.definition)")
            if let part = word.partOfSpeech, !part.isEmpty { parts.append(part) }
            if let example = word.example, !example.isEmpty { parts.append("Example: \(example)") }
            if !word.synonyms.isEmpty { parts.append("Synonyms: \(word.synonyms.joined(separator: ", "))") }
        } else {
            parts.append("Word: \(word.word)")
            if let part = word.partOfSpeech, !part.isEmpty { parts.append(part) }
        }
        return parts.joined(separator: ". ")
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 16)
            .updating($drag) { value, state, _ in
                state = onSwipe == nil ? 0 : Self.sideways(value.translation)
            }
            .onEnded { value in
                // Decided where the finger lifted, by the rule that draws the card. A drag the
                // system cancels never gets here, and the gesture state has already put the
                // card back.
                guard let onSwipe, let verdict = Self.verdict(at: Self.sideways(value.translation)) else { return }
                onSwipe(verdict)
            }
    }

    /// What letting go would do, once the card has gone far enough — the student's own verdict
    /// on themselves (flashcards are self-graded), never the app's.
    @ViewBuilder
    private var stamp: some View {
        if let leaning {
            Label(leaning ? "Correct" : "Still learning", systemImage: leaning ? "checkmark" : "arrow.counterclockwise")
                .appFont(14, weight: .heavy)
                .foregroundStyle(Self.stampInk)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Capsule().fill(leaning ? FlashcardTone.emerald.solid : FlashcardTone.amber.solid))
                .padding(.top, 16)
                .transition(.opacity)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private func face(back: Bool) -> some View {
        // Centred in the card while it fits (the kit's card centres its word); a long definition
        // grows past the card's height and scrolls from its top.
        GeometryReader { card in
        ScrollView {
            VStack(spacing: 12) {
                Text(back ? "Definition" : "Word").newLookCaps()
                if back {
                    Text(word.definition)
                        .appFont(21, weight: .bold)
                        .tracking(-0.2)
                        .foregroundStyle(NewLook.ink)
                        .multilineTextAlignment(.center)
                    if let part = word.partOfSpeech, !part.isEmpty { partChip(part) }
                    if let example = word.example, !example.isEmpty {
                        HStack(alignment: .top, spacing: 0) {
                            Rectangle().fill(NewLook.blue.opacity(0.4)).frame(width: 3)
                            Text("“\(example)”")
                                .appFont(13).italic()
                                .foregroundStyle(NewLook.ink4)
                                .multilineTextAlignment(.leading)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                            Spacer(minLength: 0)
                        }
                        .background(NewLook.sheet)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .padding(.top, 4)
                    }
                    if !word.synonyms.isEmpty {
                        WrappingChips(words: word.synonyms, tone: NewLook.blue, ink: NewLook.blueText)
                            .padding(.top, 4)
                    }
                } else {
                    Text(word.word)
                        // One word on an otherwise empty screen. It can afford to be big,
                        // and being big is the point.
                        .appDisplayFont(42)
                        .tracking(-1)
                        .foregroundStyle(NewLook.ink)
                        .multilineTextAlignment(.center)
                        .minimumScaleFactor(0.4)
                    if let part = word.partOfSpeech, !part.isEmpty { partChip(part) }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
            .padding(.vertical, 28)
            .frame(minHeight: card.size.height)
        }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(NewLook.card)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(alignment: .bottomTrailing) {
            HStack(spacing: 5) {
                Image(systemName: "arrow.triangle.2.circlepath").appFont(10, weight: .bold)
                    .accessibilityHidden(true)
                Text(back ? "Flip for word" : "Flip for definition").appFont(11, weight: .heavy)
            }
            .foregroundStyle(NewLook.ink4)
            .padding(.horizontal, 10)
            .frame(minHeight: 26)
            .background(Capsule().fill(NewLook.sheet))
            .padding(14)
            .allowsHitTesting(false)
        }
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(NewLook.card)
                .shadow(color: Color(RGB(hex: 0x0E2450)).opacity(0.05), radius: 1, y: 1)
                .shadow(color: Color(RGB(hex: 0x0E2450)).opacity(0.12), radius: 17, y: 14)
        }
    }

    private func partChip(_ part: String) -> some View {
        Text(part)
            .appFont(12, weight: .bold).italic()
            .foregroundStyle(NewLook.ink4)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(Capsule().fill(NewLook.sheet))
    }
}

/// Word chips that wrap onto as many lines as they need.
///
/// `LazyVGrid` with adaptive columns would give every chip the same width — a five-letter
/// word padded out to the width of a fifteen-letter one — so the rows are measured here.
struct WrappingChips: View {
    let words: [String]
    var tone: Color = Theme.accent
    /// The text's colour, when the tone itself is too light to read on its tint.
    var ink: Color?

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(Array(words.enumerated()), id: \.offset) { _, word in
                Text(word)
                    .appFont(13.5, weight: .bold)
                    .foregroundStyle(ink ?? tone)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 28)
                    .background(Capsule().fill(tone.opacity(0.13)))
            }
        }
    }
}

/// A minimal flow layout: place each subview on the current line, wrap when it will not fit.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = layout(subviews: subviews, width: width)
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in layout(subviews: subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func layout(subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if !row.indices.isEmpty, row.width + spacing + size.width > width {
                rows.append(row)
                row = Row()
            }
            row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}

/// The flashcards' two verdict colours — the student's own verdict on themselves, never the app's:
/// the vocabulary palette's emerald for "Correct" and amber for "Still learning".
enum FlashcardTone {
    static let emerald = VocabPalette.mastered
    static let amber = VocabPalette.section(.amber)
}
