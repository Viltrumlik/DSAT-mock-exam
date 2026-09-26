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
    /// A clean sweep by the mode's own measure — confetti, as the web fires it.
    var celebrate = false
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
    let onClose: @MainActor () -> Void

    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var runner: VocabStudyRunner?
    @State private var outcome: StudyOutcome?
    /// Bumped to replay the mode. Every mode holds its deck in `@State`, so a fresh
    /// identity is what re-deals it — resetting fields one by one would forget one.
    @State private var runKey = 0

    var body: some View {
        Group {
            if let runner {
                if let startError = runner.startError, !runner.isStarted {
                    // Nothing played without a session can be credited, so the round does
                    // not go on as if it could. The server's own sentence says why — "That
                    // homework is not assigned to you for this set." among them.
                    startFailed(startError)
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
                        celebrate: outcome.celebrate,
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

    /// The web's `ModeStartError`, inside the same frame so the way out never disappears.
    private func startFailed(_ error: APIError) -> some View {
        StudyShell(title: mode.title, subtitle: set.title, tone: mode.tone, onExit: onClose) {
            ScrollView {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 26))
                        .foregroundStyle(Theme.warning)
                        .frame(width: 56, height: 56)
                        .background(Circle().fill(Theme.warningSoft))
                    Text("Couldn't start this round")
                        .font(.system(size: 18, weight: .heavy))
                    Text(error.errorDescription ?? "Something went wrong on our end.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    VStack(spacing: 10) {
                        Button { Task { await restart() } } label: {
                            Label("Try again", systemImage: "arrow.counterclockwise").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(PrimaryButtonStyle(tone: mode.tone, fullWidth: true))
                        Button("Back to vocabulary", action: onClose)
                            .buttonStyle(SecondaryButtonStyle(fullWidth: true))
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
        outcome = nil
        runner = nil
        runKey += 1
        await begin()
    }

    @MainActor
    private func exit() {
        Task {
            await runner?.flush(isPartial: true)
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

    private var current: VocabWord? { index < deck.count ? deck[index] : nil }

    var body: some View {
        StudyShell(
            title: "Flashcards",
            subtitle: set.title,
            tone: StudyMode.flashcard.tone,
            progress: phase == .study && !deck.isEmpty ? Double(index) / Double(deck.count) : nil,
            trailing: phase == .study
                ? AnyView(StudyPill(text: "\(index + 1) / \(deck.count)", tone: StudyMode.flashcard.tone))
                : nil,
            onExit: onExit
        ) {
            switch phase {
            case .study: study
            case .checkpoint: checkpoint
            }
        }
        .task { if deck.isEmpty { deck = set.words } }
        // The mode is left by a button, not a navigation, so nothing else would stop the
        // hold: without this it keeps counting and deals a card in a screen that is gone.
        .onDisappear { holdTask?.cancel() }
    }

    @ViewBuilder
    private var study: some View {
        ScrollView {
            VStack(spacing: 14) {
                if round > 1 {
                    Chip(text: "Round \(ScoreText.string(round)) · still learning",
                         icon: "arrow.counterclockwise", tone: .warning)
                }

                if let word = current {
                    // Flipping stays live during the hold — the pause is a pause, not a freeze.
                    FlipCard(word: word, flipped: flipped) {
                        withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) { flipped.toggle() }
                    }
                    .padding(.horizontal, 16)
                }

                if let hold {
                    FlashcardHoldStrip(correct: hold.correct, secondsLeft: hold.secondsLeft, total: Self.holdSeconds)
                        .padding(.horizontal, 16)
                } else {
                    Text("Tap the card to flip it.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(minHeight: 20)
                }

                HStack(spacing: 12) {
                    verdict("Still learning", icon: "arrow.counterclockwise", tone: Theme.warning, isCorrect: false)
                    verdict("Correct", icon: "checkmark", tone: Theme.success, isCorrect: true)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
            .padding(.top, 12)
        }
    }

    private func verdict(_ label: String, icon: String, tone: Color, isCorrect: Bool) -> some View {
        let chosen = hold?.correct == isCorrect
        let held = hold != nil
        return Button { answer(isCorrect) } label: {
            HStack(spacing: 9) {
                Image(systemName: icon).font(.system(size: 17, weight: .bold))
                Text(label).font(.system(size: 16, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(tone)
            .frame(maxWidth: .infinity, minHeight: 60)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(tone.opacity(0.12))
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(tone.opacity(chosen ? 0.9 : 0.28), lineWidth: 2)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
                    CardHeading(
                        icon: "flag.fill",
                        title: "Round \(ScoreText.string(round)) done",
                        subtitle: "Keep going — the pile shrinks every round."
                    )
                    // Two segments, not a bar with a gap: what stuck and what is coming
                    // back are the whole story of the round.
                    GeometryReader { geometry in
                        HStack(spacing: 2) {
                            Rectangle().fill(Theme.success)
                                .frame(width: max(0, geometry.size.width * cleared))
                            Rectangle().fill(Theme.warning)
                        }
                    }
                    .frame(height: 10)
                    .clipShape(Capsule())
                    Text("\(ScoreText.string(learned.count)) of \(ScoreText.string(deck.count)) cards cleared this round")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .cardStyle(padding: 18)

                reviewColumn("You know these", words: learned, tone: Theme.success, icon: "sparkles",
                             emptyText: "Nothing landed this round — that's what the next one is for.")
                reviewColumn("Keep practising these", words: missed, tone: Theme.warning,
                             icon: "arrow.counterclockwise", emptyText: nil)

                Button {
                    practiseMissed()
                } label: {
                    Label("Practice \(ScoreText.string(missed.count)) word\(missed.count == 1 ? "" : "s") again",
                          systemImage: "arrow.counterclockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            }
            .padding(16)
        }
    }

    private func reviewColumn(
        _ title: String,
        words: [VocabWord],
        tone: Color,
        icon: String,
        emptyText: String?
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                IconTile(systemName: icon, tone: tone, size: 34)
                Text(title).font(.system(size: 15, weight: .heavy))
                Spacer(minLength: 0)
                Text(ScoreText.string(words.count))
                    .font(.system(size: 13, weight: .heavy).monospacedDigit())
                    .foregroundStyle(tone)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(tone.opacity(0.14)))
            }
            if words.isEmpty {
                if let emptyText {
                    Text(emptyText).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                }
            } else {
                WrappingChips(words: words.map(\.word), tone: tone)
            }
        }
        .cardStyle(padding: 16)
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
        withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) { flipped = true }
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
            return
        }
        if missed.isEmpty {
            onFinish(StudyOutcome(
                title: "Every word learned",
                description: "You cleared all \(ScoreText.string(set.words.count)) words in \(ScoreText.string(round)) round\(round == 1 ? "" : "s").",
                stats: [
                    ModeStat(label: "Words", value: ScoreText.string(set.words.count)),
                    ModeStat(label: "Cards reviewed", value: ScoreText.string(reviewed)),
                    ModeStat(
                        label: "Accuracy",
                        value: "\(ScoreText.string(VocabGames.accuracyPercent(correct: correct, of: reviewed)))%",
                        tone: .success
                    ),
                ],
                celebrate: correct == reviewed
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
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(correct ? Theme.successSoft : Theme.warningSoft)
                .frame(width: 36, height: 36)
                .overlay(
                    Image(systemName: correct ? "checkmark" : "arrow.counterclockwise")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(correct ? Theme.success : Theme.warning)
                )
            VStack(alignment: .leading, spacing: 8) {
                Text(correct
                     ? "Nice — sit with the definition for a beat."
                     : "Read it through — you'll see this one again.")
                    .font(.system(size: 13, weight: .bold))
                    .fixedSize(horizontal: false, vertical: true)
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.surface2)
                        Capsule()
                            .fill(Theme.accent)
                            .frame(width: geometry.size.width * CGFloat(secondsLeft) / CGFloat(max(total, 1)))
                            .animation(.linear(duration: 1), value: secondsLeft)
                    }
                }
                .frame(height: 6)
            }
            StudyPill(text: "\(secondsLeft)s", icon: "timer", tone: Theme.accent)
                .accessibilityHidden(true)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.card))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Theme.separator.opacity(0.6), lineWidth: 0.5)
        )
        .accessibilityElement(children: .combine)
    }
}

/// A two-sided card. The corner chip is the flip affordance — the whole face responds, but
/// nothing about a word on its own says there is a back.
struct FlipCard: View {
    let word: VocabWord
    let flipped: Bool
    let onFlip: @MainActor () -> Void

    var body: some View {
        ZStack {
            face(back: false).opacity(flipped ? 0 : 1)
            face(back: true)
                .opacity(flipped ? 1 : 0)
                .rotation3DEffect(.degrees(180), axis: (x: 0, y: 1, z: 0))
        }
        .rotation3DEffect(.degrees(flipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))
        .frame(maxWidth: .infinity)
        .frame(height: 360)
        .contentShape(Rectangle())
        .onTapGesture { onFlip() }
    }

    @ViewBuilder
    private func face(back: Bool) -> some View {
        ScrollView {
            VStack(spacing: 12) {
                Overline(back ? "Definition" : "Word")
                if back {
                    Text(word.definition)
                        .font(.system(size: 21, weight: .bold))
                        .multilineTextAlignment(.center)
                    if let part = word.partOfSpeech, !part.isEmpty { partChip(part) }
                    if let example = word.example, !example.isEmpty {
                        HStack(alignment: .top, spacing: 0) {
                            Rectangle().fill(Theme.accent.opacity(0.4)).frame(width: 3)
                            Text("“\(example)”")
                                .font(.system(size: 13).italic())
                                .foregroundStyle(Theme.textSecondary)
                                .multilineTextAlignment(.leading)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                        }
                        .background(Theme.background)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .padding(.top, 4)
                    }
                    if !word.synonyms.isEmpty {
                        WrappingChips(words: word.synonyms, tone: Theme.accent)
                            .padding(.top, 4)
                    }
                } else {
                    Text(word.word)
                        // One word on an otherwise empty screen. It can afford to be big,
                        // and being big is the point.
                        .font(.system(size: 42, weight: .heavy, design: .rounded))
                        .multilineTextAlignment(.center)
                        .minimumScaleFactor(0.4)
                    if let part = word.partOfSpeech, !part.isEmpty { partChip(part) }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
            .padding(.vertical, 28)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous)
                .stroke(Theme.separator.opacity(0.6), lineWidth: 1)
        )
        .overlay(alignment: .bottomTrailing) {
            HStack(spacing: 5) {
                Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 10, weight: .bold))
                Text(back ? "Flip for word" : "Flip for definition").font(.system(size: 11, weight: .heavy))
            }
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(Theme.background))
            .padding(14)
            .allowsHitTesting(false)
        }
        .shadow(color: .black.opacity(0.06), radius: 12, x: 0, y: 4)
    }

    private func partChip(_ part: String) -> some View {
        Text(part)
            .font(.system(size: 12, weight: .bold).italic())
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(Capsule().fill(Theme.background))
    }
}

/// Word chips that wrap onto as many lines as they need.
///
/// `LazyVGrid` with adaptive columns would give every chip the same width — a five-letter
/// word padded out to the width of a fifteen-letter one — so the rows are measured here.
struct WrappingChips: View {
    let words: [String]
    var tone: Color = Theme.accent

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(Array(words.enumerated()), id: \.offset) { _, word in
                Text(word)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(tone)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
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
