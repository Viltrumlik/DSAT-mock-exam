import SwiftUI
import MasterSATKit

/// Matching — words and definitions shuffled into one grid, dealt six at a time.
///
/// A round is a wall: it cannot be left until every pair is found, and the clock counts up
/// across the whole set, so the score is "how fast", not "how many".
struct MatchingView: View {
    @Bindable var runner: VocabStudyRunner
    let set: VocabSetDetail
    let onExit: @MainActor () -> Void
    let onFinish: @MainActor (StudyOutcome) -> Void

    @State private var rounds: [[VocabWord]] = []
    @State private var roundIndex = 0
    @State private var misses = 0
    /// Words touched by a wrong attempt anywhere in the run — they score as missed.
    @State private var missed: Set<Int> = []
    @State private var elapsed = 0
    @State private var ticker: Task<Void, Never>?

    var body: some View {
        StudyShell(
            title: "Matching",
            subtitle: set.title,
            tone: Theme.info,
            progress: rounds.isEmpty ? 0 : Double(roundIndex) / Double(rounds.count),
            trailing: AnyView(
                HStack(spacing: 6) {
                    if rounds.count > 1 {
                        StudyPill(text: "\(roundIndex + 1)/\(rounds.count)", icon: "square.stack", tone: Theme.info)
                    }
                    StudyPill(text: formatClock(elapsed), icon: "timer")
                }
            ),
            onExit: onExit
        ) {
            if roundIndex < rounds.count {
                MatchingRound(
                    words: rounds[roundIndex],
                    onMiss: { a, b in
                        missed.insert(a)
                        missed.insert(b)
                        misses += 1
                    },
                    onPairFound: { wordId in
                        // Graded the moment the pair is found — wrong-then-right still
                        // scores as missed — so an abandoned run keeps what was solved.
                        runner.record(wordId: wordId, correct: !missed.contains(wordId))
                    },
                    onRoundDone: {
                        if roundIndex + 1 < rounds.count {
                            roundIndex += 1
                        } else {
                            ticker?.cancel()
                            finish()
                        }
                    }
                )
                // A fresh identity per round, so the board deals again instead of
                // animating cards into new positions.
                .id(roundIndex)
            } else {
                ProgressView()
            }
        }
        .task {
            if rounds.isEmpty { rounds = VocabGames.chunkForMatching(VocabGames.shuffle(set.words)) }
            ticker?.cancel()
            ticker = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(1))
                    if Task.isCancelled { return }
                    elapsed += 1
                }
            }
        }
        .onDisappear { ticker?.cancel() }
    }

    /// The score is "how fast and how cleanly", not "how many" — every pair gets found
    /// eventually, so counting them would be counting to the same number every time.
    @MainActor
    private func finish() {
        let cleanFirstTry = set.words.count - missed.count
        onFinish(StudyOutcome(
            title: "All pairs matched",
            description: "\(ScoreText.string(set.words.count)) word\(set.words.count == 1 ? "" : "s") across \(ScoreText.string(rounds.count)) round\(rounds.count == 1 ? "" : "s").",
            stats: [
                ModeStat(label: "Total time", value: formatClock(elapsed)),
                // "Misses", and the same neutral tile whatever the count: a miss is how the pairs
                // got found, not a danger. There is no accuracy beside it by the owner's call.
                ModeStat(label: "Misses", value: ScoreText.string(misses)),
                ModeStat(
                    label: "Clean first try",
                    value: "\(ScoreText.string(cleanFirstTry))/\(ScoreText.string(set.words.count))"
                ),
            ]
        ))
    }
}

private struct MatchingRound: View {
    let words: [VocabWord]
    let onMiss: @MainActor (Int, Int) -> Void
    let onPairFound: @MainActor (Int) -> Void
    let onRoundDone: @MainActor () -> Void

    @State private var cards: [VocabGames.MatchCard] = []
    @State private var matched: Set<String> = []
    @State private var selected: String?
    @State private var wrongPair: Set<String> = []
    @State private var isLocked = false
    /// One tick per pick that is not a miss — the selection haptic. A miss buzzes a warning
    /// instead, never both at once.
    @State private var taps = 0
    /// Per card, how many wrong pairs it was part of — its shake's trigger.
    @State private var misses: [String: Int] = [:]
    /// Every wrong pair in the round — the warning haptic's trigger.
    @State private var missCount = 0

    private var remaining: Int { (cards.count - matched.count) / 2 }
    private var total: Int { cards.count / 2 }

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                Text("Tap a word, then its meaning.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                StudyPill(
                    text: "\(remaining) of \(total) pair\(total == 1 ? "" : "s") left",
                    tone: remaining == 0 ? Theme.success : Theme.info
                )
            }
            .padding(.horizontal, 16)

            ScrollView {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(cards) { card in
                        MatchCardTile(
                            card: card,
                            isMatched: matched.contains(card.id),
                            isSelected: selected == card.id,
                            isWrong: wrongPair.contains(card.id),
                            misses: misses[card.id] ?? 0
                        ) {
                            pick(card)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
        }
        .task { if cards.isEmpty { cards = VocabGames.matchCards(for: words) } }
        .sensoryFeedback(.selection, trigger: taps)
        .sensoryFeedback(.warning, trigger: missCount)
    }

    @MainActor
    private func pick(_ card: VocabGames.MatchCard) {
        guard !isLocked, !matched.contains(card.id) else { return }
        guard let firstId = selected else {
            selected = card.id
            taps += 1
            return
        }
        if firstId == card.id {
            selected = nil
            taps += 1
            return
        }
        guard let first = cards.first(where: { $0.id == firstId }) else {
            selected = card.id
            taps += 1
            return
        }

        if VocabGames.isPair(first, card) {
            taps += 1
            onPairFound(card.wordId)
            matched.insert(first.id)
            matched.insert(card.id)
            selected = nil
            if matched.count == cards.count {
                // A beat between the last pair fading and the next round dealing.
                Task {
                    try? await Task.sleep(for: .milliseconds(550))
                    onRoundDone()
                }
            }
            return
        }

        onMiss(first.wordId, card.wordId)
        misses[first.id, default: 0] += 1
        misses[card.id, default: 0] += 1
        missCount += 1
        // The shake and the red edge are for the eyes; say it in words too, kindly.
        AccessibilityNotification.Announcement("Not a pair — try another").post()
        wrongPair = [first.id, card.id]
        isLocked = true
        Task {
            try? await Task.sleep(for: .milliseconds(650))
            wrongPair = []
            selected = nil
            isLocked = false
        }
    }
}

private struct MatchCardTile: View {
    let card: VocabGames.MatchCard
    let isMatched: Bool
    let isSelected: Bool
    let isWrong: Bool
    /// How many wrong pairs this card was part of — each one shakes it.
    let misses: Int
    let onTap: @MainActor () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var border: Color {
        if isWrong { return Theme.danger }
        if isSelected { return Theme.info }
        return Theme.separator
    }

    private var fill: Color {
        if isWrong { return Theme.dangerSoft }
        if isSelected { return Theme.infoSoft }
        return Theme.card
    }

    var body: some View {
        // Read here: the animator's content closure is Sendable and may not touch the environment.
        let calm = reduceMotion
        return Button(action: onTap) {
            Text(card.text)
                // A word is the thing being learned, so it gets the big type; a
                // definition is a sentence and has to fit.
                .font(.system(size: card.face == .word ? 21 : 15, weight: card.face == .word ? .bold : .medium))
                .multilineTextAlignment(.center)
                .lineLimit(4)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, minHeight: 112)
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(fill)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                        .stroke(border, lineWidth: isSelected || isWrong ? 2 : 1)
                )
                // A button's label is only hit-testable where it draws.
                .contentShape(Rectangle())
        }
        .buttonStyle(FocusPress())
        .disabled(isMatched)
        // A found pair pops — up 4% and back in 220 ms, never as far as a neighbour 10 pt away —
        // then fades to make room. The pop is off under Reduce Motion (the track exists either
        // way, so toggling the setting mid-round rebuilds nothing).
        .keyframeAnimator(initialValue: 1.0, trigger: isMatched) { tile, pop in
            tile.scaleEffect(calm ? 1 : pop)
        } keyframes: { _ in
            KeyframeTrack {
                CubicKeyframe(1.04, duration: 0.1)
                CubicKeyframe(1.0, duration: 0.12)
            }
        }
        .opacity(isMatched ? 0.25 : 1)
        .scaleEffect(isMatched ? 0.94 : (isSelected ? 1.02 : 1))
        // A pair that is not one shakes with its red edge (a red pulse under Reduce Motion).
        .focusShake(misses, cornerRadius: Theme.Radius.card)
        // Innermost, so it wins when a pair is found: the card that was selected stops being
        // selected in the same update, and both cards of the pair fade together, after the pop.
        .animation(.easeOut(duration: 0.2).delay(calm ? 0 : 0.22), value: isMatched)
        .animation(Motion.focusTap, value: isSelected)
        .animation(Motion.focusTap, value: isWrong)
    }
}
