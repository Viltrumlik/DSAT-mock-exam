import SwiftUI
import MasterSATKit

/// A study run: flashcards or a multiple-choice test over one set.
struct VocabStudyView: View {
    let mode: StudyMode
    let set: VocabSetDetail
    let onClose: @MainActor () -> Void

    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var runner: VocabStudyRunner?

    var body: some View {
        Group {
            if let runner {
                if runner.isComplete || runner.isFinished {
                    VocabSummaryView(runner: runner, setTitle: set.title, onClose: onClose)
                } else {
                    switch mode {
                    case .flashcard: FlashcardView(runner: runner, onExit: exit)
                    case .test: VocabTestView(runner: runner, allWords: set.words, onExit: exit)
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
        let words = mode == .flashcard ? set.words.shuffled() : set.words.shuffled()
        let runner = VocabStudyRunner(mode: mode.kitMode, words: words, setId: set.id, api: session.student)
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
    let onExit: @MainActor () -> Void

    @State private var isRevealed = false

    var body: some View {
        VStack(spacing: 0) {
            StudyHeader(
                title: "\(min(runner.answeredCount + 1, runner.words.count)) of \(runner.words.count)",
                progress: runner.progress,
                onExit: onExit
            )

            Spacer()

            if let word = runner.currentWord {
                VStack(spacing: 16) {
                    Text(word.word)
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .multilineTextAlignment(.center)

                    if isRevealed {
                        VStack(spacing: 10) {
                            Text(word.definition)
                                .font(.title3)
                                .multilineTextAlignment(.center)
                            if let example = word.example, !example.isEmpty {
                                Text(example)
                                    .font(.subheadline.italic())
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                            }
                            if !word.synonyms.isEmpty {
                                Text(word.synonyms.joined(separator: " · "))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .transition(.opacity)
                    } else {
                        Text("Tap to see the meaning")
                            .font(.footnote)
                            .foregroundStyle(.tertiary)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(28)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .padding(.horizontal, 20)
                .contentShape(Rectangle())
                .onTapGesture { withAnimation(.easeOut(duration: 0.15)) { isRevealed = true } }
            }

            Spacer()

            if isRevealed {
                HStack(spacing: 12) {
                    Button {
                        // Missed: record it AND put it back in the queue. Seeing it once
                        // more is the whole point of a flashcard run.
                        runner.requeueCurrentWord()
                        advance(correct: false)
                    } label: {
                        Label("Still learning", systemImage: "arrow.counterclockwise")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .tint(.orange)

                    Button {
                        advance(correct: true)
                    } label: {
                        Label("Got it", systemImage: "checkmark")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .tint(.green)
                }
                .padding(20)
            } else {
                Color.clear.frame(height: 84)
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
    let allWords: [VocabWord]
    let onExit: @MainActor () -> Void

    @State private var options: [VocabWord] = []
    @State private var chosenId: Int?

    var body: some View {
        VStack(spacing: 0) {
            StudyHeader(
                title: "\(min(runner.answeredCount + 1, runner.words.count)) of \(runner.words.count)",
                progress: runner.progress,
                onExit: onExit
            )

            if let word = runner.currentWord {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        Text(word.word)
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 20)

                        ForEach(options) { option in
                            optionRow(option, correctId: word.id)
                        }
                    }
                    .padding(20)
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
                    .font(.subheadline)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if showsVerdict && isCorrect {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                } else if showsVerdict && isChosen {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(background(isChosen: isChosen, isCorrect: isCorrect, showsVerdict: showsVerdict))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func background(isChosen: Bool, isCorrect: Bool, showsVerdict: Bool) -> Color {
        guard showsVerdict else { return Color(.secondarySystemBackground) }
        if isCorrect { return .green.opacity(0.15) }
        if isChosen { return .red.opacity(0.12) }
        return Color(.secondarySystemBackground)
    }

    /// The right definition plus three plausible wrong ones, in random order.
    private func makeOptions(for word: VocabWord) {
        let distractors = allWords
            .filter { $0.id != word.id && !$0.definition.isEmpty }
            .shuffled()
            .prefix(3)
        options = ([word] + distractors).shuffled()
        chosenId = nil
    }
}

struct StudyHeader: View {
    let title: String
    let progress: Double
    let onExit: @MainActor () -> Void

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Button(action: onExit) {
                    Image(systemName: "xmark").font(.subheadline.weight(.semibold))
                }
                .tint(.secondary)
                Spacer()
                Text(title).font(.subheadline.weight(.medium).monospacedDigit())
                Spacer()
                Image(systemName: "xmark").font(.subheadline).opacity(0)
            }
            ProgressView(value: progress).tint(Theme.accent)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.examChrome)
    }
}

struct VocabSummaryView: View {
    @Bindable var runner: VocabStudyRunner
    let setTitle: String
    let onClose: @MainActor () -> Void

    @State private var isSaving = true

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: runner.summary?.setCompleted == true ? "checkmark.seal.fill" : "sparkles")
                .font(.system(size: 44))
                .foregroundStyle(Theme.accent)

            Text(setTitle).font(.title3.bold()).multilineTextAlignment(.center)

            if isSaving {
                ProgressView()
            } else {
                Text("\(runner.correctCount) of \(runner.answeredCount) right")
                    .font(.system(size: 30, weight: .bold, design: .rounded).monospacedDigit())

                // No "you failed" anywhere: a study run is practice, and the number is
                // information, not a verdict.
                Text(runner.summary?.setCompleted == true
                     ? "Set complete. Come back tomorrow to keep it."
                     : "Progress saved. Every pass moves these words along.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            if let error = runner.lastError?.errorDescription {
                Text(error).font(.footnote).foregroundStyle(.orange).multilineTextAlignment(.center)
            }

            Button("Done", action: onClose)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(Theme.accent)
                .disabled(isSaving)

            Spacer()
        }
        .padding(28)
        .task {
            // The finishing call — this is what marks the set complete.
            await runner.flush(isPartial: false)
            isSaving = false
        }
    }
}
