import SwiftUI
import MasterSATKit

/// Test mode — every word once, the question kind cycling multiple choice → true/false →
/// spelling.
///
/// **No feedback until the end.** That is the design, not an omission: the review screen is
/// where the learning happens, and a green flash after every answer turns a test into a
/// drill. Nothing is graded on screen while answering, so the mode's green accent cannot be
/// mistaken for "correct"; on the review, green and red go back to meaning right and wrong.
struct VocabTestView: View {
    @Bindable var runner: VocabStudyRunner
    let set: VocabSetDetail
    let onExit: @MainActor () -> Void
    let onFinish: @MainActor (StudyOutcome) -> Void

    @State private var questions: [VocabGames.TestQuestion] = []
    @State private var index = 0
    @State private var answers: [TestAnswer] = []
    @State private var typed = ""
    @FocusState private var spellingFocused: Bool

    private var current: VocabGames.TestQuestion? { index < questions.count ? questions[index] : nil }

    var body: some View {
        StudyShell(
            title: "Test",
            subtitle: set.title,
            tone: Theme.success,
            progress: questions.isEmpty ? 0 : Double(index) / Double(questions.count),
            trailing: AnyView(
                StudyPill(text: "\(index + 1) / \(max(questions.count, 1))", tone: Theme.success)
            ),
            onExit: onExit
        ) {
            ScrollView {
                if let question = current {
                    VStack(spacing: 16) {
                        switch question.kind {
                        case .mcq: multipleChoice(question)
                        case .trueFalse: trueFalse(question)
                        case .spelling: spelling(question)
                        }
                    }
                    .padding(16)
                    .id(question.id)
                }
            }
        }
        .task {
            if questions.isEmpty {
                questions = VocabGames.buildTestQuestions(for: set.words, pool: set.words)
            }
        }
    }

    // MARK: - Question kinds

    private func multipleChoice(_ question: VocabGames.TestQuestion) -> some View {
        QuestionShell(
            icon: "list.bullet",
            kicker: "Which word means…",
            prompt: question.definition,
            step: index + 1,
            total: questions.count
        ) {
            VStack(spacing: 10) {
                ForEach(Array(question.options.enumerated()), id: \.offset) { position, option in
                    Button {
                        submit(
                            question: question,
                            given: option,
                            expected: question.word,
                            correct: position == question.answerIndex
                        )
                    } label: {
                        HStack(spacing: 12) {
                            Text(Self.letters[min(position, Self.letters.count - 1)])
                                .font(.system(size: 13, weight: .heavy))
                                .frame(width: 32, height: 32)
                                .background(
                                    RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Theme.background)
                                )
                                .foregroundStyle(Theme.textSecondary)
                            Text(option)
                                .font(.system(size: 15, weight: .semibold))
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.card)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                                .stroke(Theme.separator.opacity(0.7), lineWidth: 1)
                        )
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func trueFalse(_ question: VocabGames.TestQuestion) -> some View {
        QuestionShell(
            icon: "scalemass",
            kicker: "True or false?",
            prompt: "“\(question.word)” means “\(question.shownDefinition)”",
            step: index + 1,
            total: questions.count
        ) {
            // Both choices rest on the same neutral surface. A filled green True beside a
            // filled red False would read as right-versus-wrong on a screen where nothing
            // has been graded yet; the glyph is what tells them apart.
            HStack(spacing: 12) {
                verdictButton("True", icon: "checkmark.circle.fill", tone: Theme.success) {
                    submit(
                        question: question,
                        given: "True",
                        expected: question.isGenuine ? "True" : "False",
                        correct: question.isGenuine
                    )
                }
                verdictButton("False", icon: "xmark.circle.fill", tone: Theme.danger) {
                    submit(
                        question: question,
                        given: "False",
                        expected: question.isGenuine ? "True" : "False",
                        correct: !question.isGenuine
                    )
                }
            }
        }
    }

    private func verdictButton(_ label: String, icon: String, tone: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 22)).foregroundStyle(tone)
                Text(label).font(.system(size: 15, weight: .heavy)).foregroundStyle(.primary)
            }
            .frame(maxWidth: .infinity, minHeight: 88)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.separator.opacity(0.7), lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func spelling(_ question: VocabGames.TestQuestion) -> some View {
        QuestionShell(
            icon: "textformat.abc",
            kicker: "Spell the word that means…",
            prompt: question.definition,
            step: index + 1,
            total: questions.count
        ) {
            VStack(spacing: 16) {
                // Letter tiles: the given letter is filled, the blanks are dashed wells,
                // punctuation is bare structure rather than something to guess.
                FlowLayout(spacing: 6) {
                    ForEach(Array(VocabGames.maskWord(question.word, revealing: question.revealIndex).enumerated()), id: \.offset) { _, character in
                        letterTile(character)
                    }
                }

                TextField("Type the word", text: $typed)
                    .font(.system(size: 20, weight: .bold))
                    .multilineTextAlignment(.center)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($spellingFocused)
                    .submitLabel(.done)
                    .onSubmit { submitSpelling(question) }
                    .padding(14)
                    .background(
                        RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.background)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                            .stroke(Theme.separator, lineWidth: 2)
                    )

                Button("Submit") { submitSpelling(question) }
                    .buttonStyle(PrimaryButtonStyle(tone: Theme.success, fullWidth: true))
                    .disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .onAppear { spellingFocused = true }
        }
    }

    private func letterTile(_ character: String) -> some View {
        let isBlank = character == "_"
        let isStructural = !isBlank && !(character.first?.isLetter ?? false)
        return Text(isStructural ? character : character.uppercased())
            .font(.system(size: 17, weight: .heavy))
            .foregroundStyle(isBlank ? Theme.textLabel : (isStructural ? Theme.textLabel : Theme.success))
            .frame(width: isStructural ? 12 : 34, height: 42)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(isStructural ? .clear : (isBlank ? Theme.background : Theme.successSoft))
            )
            .overlay(
                Group {
                    if isBlank {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Theme.separator, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    } else if !isStructural {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Theme.success.opacity(0.4), lineWidth: 1)
                    }
                }
            )
    }

    // MARK: - Answering

    private static let letters = ["A", "B", "C", "D"]

    @MainActor
    private func submitSpelling(_ question: VocabGames.TestQuestion) {
        let given = typed.trimmingCharacters(in: .whitespaces)
        guard !given.isEmpty else { return }
        submit(
            question: question,
            given: given,
            expected: question.word,
            correct: VocabGames.spellingIsCorrect(given, question.word)
        )
    }

    @MainActor
    private func submit(question: VocabGames.TestQuestion, given: String, expected: String, correct: Bool) {
        answers.append(TestAnswer(id: question.id, word: question.word, definition: question.definition,
                                  given: given, expected: expected, correct: correct))
        typed = ""
        // The student sees nothing until the end, but the server hears every answer as it
        // lands — an abandoned test still records what was answered.
        runner.record(wordId: question.wordId, correct: correct)

        if index + 1 < questions.count {
            index += 1
            return
        }

        let right = answers.filter(\.correct).count
        let wrong = answers.filter { !$0.correct }
        onFinish(StudyOutcome(
            title: wrong.isEmpty ? "Perfect test" : "Test complete",
            description: wrong.isEmpty
                ? "All \(ScoreText.string(answers.count)) questions right."
                : "\(ScoreText.string(wrong.count)) to look at again — they're listed below.",
            stats: [
                ModeStat(label: "Correct", value: "\(ScoreText.string(right))/\(ScoreText.string(answers.count))", tone: .success),
                ModeStat(label: "Accuracy", value: "\(ScoreText.string(VocabGames.accuracyPercent(correct: right, of: answers.count)))%"),
                ModeStat(label: "Missed", value: ScoreText.string(wrong.count), tone: wrong.isEmpty ? .neutral : .danger),
            ],
            restartLabel: "Take it again",
            extra: AnyView(TestReview(wrong: wrong))
        ))
    }
}

/// One answered question, kept so the review can show what was given beside what was right.
struct TestAnswer: Identifiable {
    let id: Int
    let word: String
    let definition: String
    let given: String
    let expected: String
    let correct: Bool
}

/// The review that follows a test — only the ones that went wrong.
///
/// Listing the right answers too would bury the four that matter under twenty that do not.
struct TestReview: View {
    let wrong: [TestAnswer]

    var body: some View {
        if !wrong.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                DotHeading(title: "Look at these again", count: wrong.count, tone: Theme.danger)
                ForEach(wrong) { answer in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(answer.word).font(.system(size: 16, weight: .heavy))
                        Text(answer.definition)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                            .multilineTextAlignment(.leading)
                        HStack(spacing: 10) {
                            answerBox("You said", answer.given.isEmpty ? "—" : answer.given, tone: Theme.danger)
                            answerBox("Answer", answer.expected, tone: Theme.success)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .cardStyle(padding: 14)
                }
            }
        }
    }

    private func answerBox(_ label: String, _ value: String, tone: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .heavy))
                .tracking(0.8)
                .foregroundStyle(Theme.textSecondary)
            Text(value)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(tone)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(tone.opacity(0.10)))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(tone.opacity(0.3), lineWidth: 1)
        )
    }
}

/// The one shell every test question wears: icon and kicker over the prompt on a tinted
/// band, the answer area under it. Only the icon and the wording change as the mode cycles.
struct QuestionShell<Content: View>: View {
    let icon: String
    let kicker: String
    let prompt: String
    let step: Int
    let total: Int
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Image(systemName: icon)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.success)
                        .frame(width: 26, height: 26)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.card))
                    Text(kicker.uppercased())
                        .font(.system(size: 11, weight: .heavy))
                        .tracking(1.1)
                        .foregroundStyle(Theme.textSecondary)
                }
                Text(prompt)
                    .font(.system(size: 19, weight: .bold))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
                Text("QUESTION \(ScoreText.string(step)) OF \(ScoreText.string(total))")
                    .font(.system(size: 10, weight: .heavy))
                    .tracking(0.9)
                    .foregroundStyle(Theme.textLabel)
                    .padding(.top, 12)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 20)
            .padding(.vertical, 22)
            .background(Theme.successSoft)

            Divider()

            content().padding(16)
        }
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 3)
    }
}
