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
struct VocabStudyView: View {
    let mode: StudyMode
    let set: VocabSetDetail
    let onClose: @MainActor () -> Void

    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var runner: VocabStudyRunner?
    @State private var outcome: StudyOutcome?
    @State private var isSaving = false
    /// Bumped to replay the mode. Every mode holds its deck in `@State`, so a fresh
    /// identity is what re-deals it — resetting fields one by one would forget one.
    @State private var runKey = 0

    var body: some View {
        Group {
            if let runner {
                if let outcome {
                    ModeOutcomeView(
                        mode: mode,
                        title: outcome.title,
                        description: outcome.description,
                        stats: outcome.stats,
                        summary: runner.summary,
                        errorText: runner.lastError?.errorDescription,
                        isSaving: isSaving,
                        restartLabel: outcome.restartLabel,
                        onRestart: { Task { await restart() } },
                        onExit: onClose,
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

    @MainActor
    private func finish(_ result: StudyOutcome) {
        outcome = result
        isSaving = true
        Task {
            // The finishing call — this is what marks the set complete.
            await runner?.flush(isPartial: false)
            isSaving = false
        }
    }

    @MainActor
    private func begin() async {
        guard runner == nil else { return }
        let created = VocabStudyRunner(
            mode: mode.kitMode,
            words: VocabGames.shuffle(set.words),
            setId: set.id,
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
/// records both, and the streak model sees the real history.
struct FlashcardView: View {
    @Bindable var runner: VocabStudyRunner
    let set: VocabSetDetail
    let onExit: @MainActor () -> Void
    let onFinish: @MainActor (StudyOutcome) -> Void

    private enum Phase { case study, checkpoint }

    @State private var deck: [VocabWord] = []
    @State private var index = 0
    @State private var flipped = false
    @State private var missed: [VocabWord] = []
    @State private var round = 1
    @State private var reviewed = 0
    @State private var correct = 0
    @State private var phase: Phase = .study

    private var current: VocabWord? { index < deck.count ? deck[index] : nil }

    var body: some View {
        StudyShell(
            title: "Flashcards",
            subtitle: set.title,
            tone: Theme.accent,
            progress: deck.isEmpty ? 0 : Double(index) / Double(deck.count),
            trailing: phase == .study
                ? AnyView(StudyPill(text: "\(index + 1) / \(deck.count)", tone: Theme.accent))
                : nil,
            onExit: onExit
        ) {
            switch phase {
            case .study: study
            case .checkpoint: checkpoint
            }
        }
        .task { if deck.isEmpty { deck = set.words } }
    }

    @ViewBuilder
    private var study: some View {
        VStack(spacing: 14) {
            if round > 1 {
                Chip(text: "Round \(ScoreText.string(round)) · still learning",
                     icon: "arrow.counterclockwise", tone: .warning)
            }

            if let word = current {
                FlipCard(word: word, flipped: flipped) {
                    withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) { flipped.toggle() }
                }
                .padding(.horizontal, 16)
            }

            Text("Tap the card to flip it.")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)

            HStack(spacing: 12) {
                verdict("Wrong", icon: "xmark", tone: Theme.danger) { answer(false) }
                verdict("Correct", icon: "checkmark", tone: Theme.success) { answer(true) }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .padding(.top, 12)
    }

    private func verdict(_ label: String, icon: String, tone: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Image(systemName: icon).font(.system(size: 17, weight: .bold))
                Text(label).font(.system(size: 16, weight: .heavy))
            }
            .foregroundStyle(tone)
            .frame(maxWidth: .infinity, minHeight: 60)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(tone.opacity(0.12))
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(tone.opacity(0.28), lineWidth: 2)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
                            Rectangle().fill(Theme.amber)
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
                reviewColumn("Keep practising these", words: missed, tone: Theme.amber,
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
        guard let word = current else { return }
        // Reported here, not at the end: a student who quits after 20 of 25 cards keeps
        // those 20 verdicts.
        runner.record(wordId: word.id, correct: isCorrect)
        reviewed += 1
        if isCorrect { correct += 1 } else { missed.append(word) }
        flipped = false

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
