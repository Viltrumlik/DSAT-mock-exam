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
    let onFinish: @MainActor () -> Void

    @State private var rounds: [[VocabWord]] = []
    @State private var roundIndex = 0
    @State private var mistakes = 0
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
                    onMistake: { a, b in
                        missed.insert(a)
                        missed.insert(b)
                        mistakes += 1
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
                            onFinish()
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
}

private struct MatchingRound: View {
    let words: [VocabWord]
    let onMistake: @MainActor (Int, Int) -> Void
    let onPairFound: @MainActor (Int) -> Void
    let onRoundDone: @MainActor () -> Void

    @State private var cards: [VocabGames.MatchCard] = []
    @State private var matched: Set<String> = []
    @State private var selected: String?
    @State private var wrongPair: Set<String> = []
    @State private var isLocked = false

    private var remaining: Int { (cards.count - matched.count) / 2 }

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                Text("Tap a word, then its meaning.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                StudyPill(
                    text: "\(remaining) left",
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
                            isWrong: wrongPair.contains(card.id)
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
    }

    @MainActor
    private func pick(_ card: VocabGames.MatchCard) {
        guard !isLocked, !matched.contains(card.id) else { return }
        guard let firstId = selected else {
            selected = card.id
            return
        }
        if firstId == card.id {
            selected = nil
            return
        }
        guard let first = cards.first(where: { $0.id == firstId }) else {
            selected = card.id
            return
        }

        if VocabGames.isPair(first, card) {
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

        onMistake(first.wordId, card.wordId)
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
    let onTap: @MainActor () -> Void

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
        Button(action: onTap) {
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
        .buttonStyle(.plain)
        .disabled(isMatched)
        .opacity(isMatched ? 0.25 : 1)
        .scaleEffect(isMatched ? 0.94 : (isSelected ? 1.02 : 1))
        .offset(x: isWrong ? -4 : 0)
        .animation(.spring(response: 0.28, dampingFraction: 0.6), value: isSelected)
        .animation(.easeOut(duration: 0.2), value: isMatched)
        .animation(.default.repeatCount(3, autoreverses: true).speed(6), value: isWrong)
    }
}
