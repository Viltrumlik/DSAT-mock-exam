import SwiftUI
import MasterSATKit

/// A study run in any of the four modes.
struct VocabStudyView: View {
    let mode: StudyMode
    let set: VocabSetDetail
    let onClose: @MainActor () -> Void

    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var runner: VocabStudyRunner?
    /// Matching and Speed decide for themselves when a run is over — they do not walk a
    /// queue, so `isComplete` on the runner means nothing to them.
    @State private var gameFinished = false

    var body: some View {
        Group {
            if let runner {
                if gameFinished || runner.isComplete || runner.isFinished {
                    VocabSummaryView(runner: runner, setTitle: set.title, mode: mode, onClose: onClose)
                } else {
                    switch mode {
                    case .flashcard:
                        FlashcardView(runner: runner, setTitle: set.title, onExit: exit)
                    case .test:
                        VocabTestView(runner: runner, setTitle: set.title, allWords: set.words, onExit: exit)
                    case .matching:
                        MatchingView(runner: runner, set: set, onExit: exit, onFinish: { gameFinished = true })
                    case .speed:
                        SpeedView(runner: runner, set: set, onExit: exit, onFinish: { gameFinished = true })
                    }
                }
            } else {
                ProgressView()
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

    @MainActor
    private func begin() async {
        guard runner == nil else { return }
        let runner = VocabStudyRunner(
            mode: mode.kitMode,
            words: set.words.shuffled(),
            setId: set.id,
            api: session.student
        )
        self.runner = runner
        await runner.begin()
    }

    @MainActor
    private func exit() {
        Task {
            await runner?.flush(isPartial: true)
            onClose()
        }
    }
}

/// See the word, try to recall it, turn it over.
struct FlashcardView: View {
    @Bindable var runner: VocabStudyRunner
    let setTitle: String
    let onExit: @MainActor () -> Void

    @State private var isRevealed = false

    var body: some View {
        StudyShell(
            title: "Flashcards",
            subtitle: setTitle,
            tone: Theme.accent,
            progress: runner.progress,
            trailing: AnyView(
                StudyPill(
                    text: "\(min(runner.answeredCount + 1, runner.words.count))/\(runner.words.count)",
                    tone: Theme.accent
                )
            ),
            onExit: onExit
        ) {
            VStack(spacing: 0) {
                Spacer()

                if let word = runner.currentWord {
                    VStack(spacing: 18) {
                        Text(word.word)
                            // The card is one word on an otherwise empty screen. It can
                            // afford to be big, and being big is the point.
                            .font(.system(size: 44, weight: .bold, design: .rounded))
                            .multilineTextAlignment(.center)
                            .minimumScaleFactor(0.5)

                        if isRevealed {
                            VStack(spacing: 12) {
                                Text(word.definition)
                                    .font(.system(size: 21, weight: .medium))
                                    .multilineTextAlignment(.center)
                                if let example = word.example, !example.isEmpty {
                                    Text(example)
                                        .font(.system(size: 16).italic())
                                        .foregroundStyle(Theme.textSecondary)
                                        .multilineTextAlignment(.center)
                                }
                                if !word.synonyms.isEmpty {
                                    Text(word.synonyms.joined(separator: " · "))
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(Theme.textLabel)
                                }
                            }
                            .transition(.opacity)
                        } else {
                            Text("Tap to see the meaning")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.textLabel)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(30)
                    .background(
                        RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous)
                            .fill(Theme.card)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous)
                            .stroke(Theme.separator, lineWidth: 1)
                    )
                    .padding(.horizontal, 18)
                    .contentShape(Rectangle())
                    .onTapGesture { withAnimation(.easeOut(duration: 0.15)) { isRevealed = true } }
                }

                Spacer()

                if isRevealed {
                    HStack(spacing: 12) {
                        Button {
                            // Missed: record it AND put it back in the queue. Seeing it
                            // once more is the whole point of a flashcard run.
                            runner.requeueCurrentWord()
                            advance(correct: false)
                        } label: {
                            Label("Still learning", systemImage: "arrow.counterclockwise")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(PrimaryButtonStyle(tone: Theme.warning, fullWidth: true))

                        Button {
                            advance(correct: true)
                        } label: {
                            Label("Got it", systemImage: "checkmark").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(PrimaryButtonStyle(tone: Theme.success, fullWidth: true))
                    }
                    .padding(18)
                } else {
                    Color.clear.frame(height: 84)
                }
            }
        }
    }

    private func advance(correct: Bool) {
        runner.answer(correct: correct)
        isRevealed = false
    }
}

/// Multiple choice: pick the definition.
struct VocabTestView: View {
    @Bindable var runner: VocabStudyRunner
    let setTitle: String
    let allWords: [VocabWord]
    let onExit: @MainActor () -> Void

    @State private var options: [VocabWord] = []
    @State private var chosenId: Int?

    var body: some View {
        StudyShell(
            title: "Test",
            subtitle: setTitle,
            tone: Theme.success,
            progress: runner.progress,
            trailing: AnyView(
                StudyPill(
                    text: "\(min(runner.answeredCount + 1, runner.words.count))/\(runner.words.count)",
                    tone: Theme.success
                )
            ),
            onExit: onExit
        ) {
            if let word = runner.currentWord {
                ScrollView {
                    VStack(spacing: 20) {
                        Text(word.word)
                            .font(.system(size: 38, weight: .bold, design: .rounded))
                            .multilineTextAlignment(.center)
                            .minimumScaleFactor(0.5)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 26)
                            .background(
                                RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous)
                                    .fill(Theme.successSoft)
                            )

                        ForEach(options) { option in
                            optionRow(option, correctId: word.id)
                        }
                    }
                    .padding(18)
                }
                // A fresh set of choices per word, and no answer carried over.
                .id(word.id)
                .onAppear { makeOptions(for: word) }
                .onChange(of: word.id) { _, _ in makeOptions(for: word) }
            }
        }
    }

    private func optionRow(_ option: VocabWord, correctId: Int) -> some View {
        let isChosen = chosenId == option.id
        let isCorrect = option.id == correctId
        let showsVerdict = chosenId != nil

        return Button {
            guard chosenId == nil else { return }
            chosenId = option.id
            runner.answer(correct: isCorrect)
            // A beat to see whether it was right before moving on. Answering is already
            // recorded, so leaving during this pause loses nothing.
            Task {
                try? await Task.sleep(for: .milliseconds(700))
                chosenId = nil
            }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Text(option.definition)
                    .font(.system(size: 18, weight: .medium))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if showsVerdict && isCorrect {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
                } else if showsVerdict && isChosen {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.danger)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .fill(background(isChosen: isChosen, isCorrect: isCorrect, showsVerdict: showsVerdict))
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.separator, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func background(isChosen: Bool, isCorrect: Bool, showsVerdict: Bool) -> Color {
        guard showsVerdict else { return Theme.card }
        if isCorrect { return Theme.successSoft }
        if isChosen { return Theme.dangerSoft }
        return Theme.card
    }

    /// The right definition plus three plausible wrong ones, in random order.
    ///
    /// Uses the same distractor rule as the games: never a word that means the same
    /// thing, because that is a second correct answer rather than a wrong one.
    private func makeOptions(for word: VocabWord) {
        let distractors = VocabGames.pickDistractors(from: allWords, excluding: word, count: 3)
        options = ([word] + distractors).shuffled()
        chosenId = nil
    }
}

struct VocabSummaryView: View {
    @Bindable var runner: VocabStudyRunner
    let setTitle: String
    let mode: StudyMode
    let onClose: @MainActor () -> Void

    @State private var isSaving = true

    var body: some View {
        VStack(spacing: 22) {
            Spacer()

            ZStack {
                Circle().fill(mode.tone.opacity(0.12)).frame(width: 96, height: 96)
                Image(systemName: runner.summary?.setCompleted == true ? "checkmark.seal.fill" : "sparkles")
                    .font(.system(size: 40))
                    .foregroundStyle(mode.tone)
            }

            VStack(spacing: 4) {
                Text(mode.title).font(.system(size: 15, weight: .bold)).foregroundStyle(mode.tone)
                Text(setTitle)
                    .font(.system(size: 22, weight: .bold))
                    .multilineTextAlignment(.center)
            }

            if isSaving {
                ProgressView()
            } else {
                Text("\(runner.correctCount) of \(runner.answeredCount) right")
                    .font(.system(size: 34, weight: .bold, design: .rounded).monospacedDigit())

                // No "you failed" anywhere: a study run is practice, and the number is
                // information, not a verdict.
                Text(runner.summary?.setCompleted == true
                     ? "Set complete. Come back tomorrow to keep it."
                     : "Progress saved. Every pass moves these words along.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }

            if let error = runner.lastError?.errorDescription {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(Theme.warning)
                    .multilineTextAlignment(.center)
            }

            Button("Done", action: onClose)
                .buttonStyle(PrimaryButtonStyle(tone: mode.tone, fullWidth: true))
                .disabled(isSaving)

            Spacer()
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.examBackground)
        .task {
            // The finishing call — this is what marks the set complete.
            await runner.flush(isPartial: false)
            isSaving = false
        }
    }
}
