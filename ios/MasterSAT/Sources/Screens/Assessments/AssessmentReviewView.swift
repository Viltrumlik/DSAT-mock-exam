import SwiftUI
import MasterSATKit

/// A marked assessment, question by question — the site's pedagogical review.
///
/// Its whole purpose is understanding a mistake, so it is built the way the site builds it:
/// a score hero, four filters that name outcomes without naming the student, and then ONE
/// question at a time in full. A scrolling list of thirty questions is a transcript; this is
/// meant to be read.
struct AssessmentReviewView: View {
    let attemptId: Int

    /// "To improve", never "Wrong". The filter a student uses most is the one about the
    /// work still to do, and it should not read as a verdict.
    enum Filter: String, CaseIterable, Identifiable {
        case all = "All"
        case toImprove = "To improve"
        case correct = "Correct"
        case skipped = "Skipped"

        var id: String { rawValue }
    }

    @Environment(Session.self) private var session
    @State private var review: AssessmentReview?
    @State private var filter: Filter = .all
    @State private var index = 0
    @State private var loadError: String?

    private var questions: [AssessmentReviewQuestion] { review?.questions ?? [] }

    private func matching(_ filter: Filter) -> [AssessmentReviewQuestion] {
        switch filter {
        case .all: return questions
        case .toImprove: return questions.filter { Outcome.of($0) == .incorrect }
        case .correct: return questions.filter { Outcome.of($0) == .correct }
        case .skipped: return questions.filter { Outcome.of($0) == .unanswered }
        }
    }

    private var shown: [AssessmentReviewQuestion] { matching(filter) }
    private var current: AssessmentReviewQuestion? {
        guard !shown.isEmpty else { return nil }
        return shown[min(index, shown.count - 1)]
    }

    private var tabs: [PillTabs<Filter>.Item] {
        [
            .init(tab: .all, title: "All", icon: "square.stack", count: questions.count),
            .init(tab: .toImprove, title: "To improve", icon: "arrow.up.forward", count: matching(.toImprove).count),
            .init(tab: .correct, title: "Correct", icon: "checkmark.circle", count: matching(.correct).count),
            .init(tab: .skipped, title: "Skipped", icon: "circle.dashed", count: matching(.skipped).count),
        ]
    }

    var body: some View {
        Group {
            if let review {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        ScoreHero(review: review, questions: questions)

                        if let feedback = review.teacherFeedback, !feedback.body.isEmpty {
                            teacherNote(feedback)
                        }

                        PillTabs(items: tabs, selection: $filter)

                        if let current {
                            ReviewQuestionCard(
                                question: current,
                                index: shown.firstIndex(where: { $0.id == current.id }) ?? 0,
                                total: shown.count
                            )
                            navigation
                        } else {
                            DashedEmpty(
                                title: emptyTitle,
                                hint: filter == .toImprove ? "Nothing to work on here." : nil
                            )
                        }
                    }
                    .padding(16)
                }
                .background(Theme.background)
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Review")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onChange(of: filter) { index = 0 }
    }

    private var emptyTitle: String {
        switch filter {
        case .toImprove: return "You got every question right."
        case .correct: return "None right this time — that is what the review is for."
        case .skipped: return "You answered everything."
        case .all: return "Nothing to show."
        }
    }

    private func teacherNote(_ feedback: TeacherFeedback) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("From your teacher", systemImage: "text.bubble.fill")
                .font(.system(size: 12, weight: .heavy))
                .foregroundStyle(Theme.warning)
            Text(feedback.body).font(.system(size: 15))
            if let name = feedback.teacherName, !name.isEmpty {
                Text(name).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.warningSoft)
        )
    }

    private var navigation: some View {
        HStack(spacing: 10) {
            Button { index = max(0, index - 1) } label: {
                Label("Previous", systemImage: "chevron.left").frame(maxWidth: .infinity)
            }
            .buttonStyle(SecondaryButtonStyle(fullWidth: true))
            .disabled(index == 0)
            .opacity(index == 0 ? 0.4 : 1)

            Button { index = min(shown.count - 1, index + 1) } label: {
                Label("Next", systemImage: "chevron.right").frame(maxWidth: .infinity)
            }
            .buttonStyle(SecondaryButtonStyle(fullWidth: true))
            .disabled(index >= shown.count - 1)
            .opacity(index >= shown.count - 1 ? 0.4 : 1)
        }
    }

    @MainActor
    private func load() async {
        loadError = nil
        do {
            review = try await session.assessments.review(attemptId: attemptId)
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }
}

// MARK: - Outcome

/// Three outcomes, not two. A blank is not a wrong answer — they call for different next
/// steps, and lumping them together tells a student the wrong thing about their own work.
enum Outcome {
    case correct, incorrect, unanswered

    static func of(_ question: AssessmentReviewQuestion) -> Outcome {
        if !question.wasAnswered { return .unanswered }
        return question.isCorrect == true ? .correct : .incorrect
    }

    var label: String {
        switch self {
        case .correct: return "Correct"
        case .incorrect: return "To improve"
        case .unanswered: return "Skipped"
        }
    }

    var icon: String {
        switch self {
        case .correct: return "checkmark.circle.fill"
        case .incorrect: return "xmark.circle.fill"
        case .unanswered: return "book.closed.fill"
        }
    }

    var tone: Color {
        switch self {
        case .correct: return Theme.success
        case .incorrect: return Theme.danger
        case .unanswered: return Theme.amber
        }
    }
}

// MARK: - Hero

/// The site's score banner: the percentage, big, on the brand gradient, with the three
/// counts under it.
struct ScoreHero: View {
    let review: AssessmentReview
    let questions: [AssessmentReviewQuestion]

    private var title: String {
        review.meta?.setTitle?.nilIfBlank
            ?? review.meta?.assignmentTitle?.nilIfBlank
            ?? "Assessment"
    }

    var body: some View {
        VStack(spacing: 0) {
            if let classroom = review.meta?.classroomName?.nilIfBlank {
                Text(classroom.uppercased())
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(1.6)
                    .foregroundStyle(.white.opacity(0.7))
                    .padding(.bottom, 6)
            }
            Text(title.uppercased())
                .font(.system(size: 14, weight: .heavy))
                .tracking(1.2)
                .foregroundStyle(.white.opacity(0.9))
                .multilineTextAlignment(.center)

            if let result = review.result {
                Text("\(ScoreText.string(result.percent))%")
                    .font(.system(size: 56, weight: .black).monospacedDigit())
                    .tracking(-2)
                    .foregroundStyle(.white)
                    .padding(.top, 12)
                Text("\(ScoreText.string(result.correctCount)) of \(ScoreText.string(result.totalQuestions)) correct · \(ScoreText.string(result.scorePoints)) of \(ScoreText.string(result.maxPoints)) pts")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.8))
                    .multilineTextAlignment(.center)
                    .padding(.top, 4)
            } else {
                // Submitted but not yet marked. Naming that beats an absent score, which
                // reads as a zero.
                Text("Grading in progress — check back shortly.")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white.opacity(0.9))
                    .multilineTextAlignment(.center)
                    .padding(.top, 14)
            }

            HStack(spacing: 12) {
                stat(count(.correct), "Correct")
                stat(count(.incorrect), "To improve")
                stat(count(.unanswered), "Skipped")
            }
            .padding(.top, 24)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(
                colors: [Theme.accent, Theme.accentHover],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .background(Theme.accent)
        .overlay(alignment: .topTrailing) {
            Circle().fill(.white.opacity(0.06))
                .frame(width: 200, height: 200)
                .offset(x: 60, y: -60)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
    }

    private func count(_ outcome: Outcome) -> Int {
        questions.filter { Outcome.of($0) == outcome }.count
    }

    private func stat(_ value: Int, _ label: String) -> some View {
        VStack(spacing: 3) {
            Text(ScoreText.string(value))
                .font(.system(size: 26, weight: .heavy).monospacedDigit())
                .foregroundStyle(.white)
            Text(label)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white.opacity(0.75))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.white.opacity(0.12)))
    }
}

// MARK: - Question deep dive

/// One question in full: what was asked, what every option was, which one was right, and
/// why. Green for the right answer, red only for a wrong one the student actually chose —
/// the other two options stay neutral rather than being painted as failures.
struct ReviewQuestionCard: View {
    let question: AssessmentReviewQuestion
    let index: Int
    let total: Int

    private var outcome: Outcome { Outcome.of(question) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()

            VStack(alignment: .leading, spacing: 18) {
                // Stem first — in Reading that is the passage; in Maths it is the question.
                RichText(text: question.prompt, serif: true, weight: .medium)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                            .fill(Theme.background)
                    )

                if let image = question.questionImage, !image.isEmpty, let url = URL(string: image) {
                    AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
                        .frame(maxWidth: .infinity)
                        .frame(maxHeight: 380)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }

                // The instruction comes AFTER the stem — in Reading it is the actual
                // question being asked about the passage above.
                if let instruction = question.questionPrompt, !instruction.isEmpty {
                    HStack(alignment: .top, spacing: 0) {
                        Rectangle().fill(Theme.accent.opacity(0.5)).frame(width: 4)
                        RichText(text: instruction, serif: true, weight: .medium)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                    }
                    .background(Theme.background)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }

                VStack(alignment: .leading, spacing: 10) {
                    Overline("Answer analysis")
                    if question.choices.isEmpty {
                        typedAnswers
                    } else {
                        ForEach(question.choices) { choice in
                            ReviewChoiceRow(
                                choice: choice,
                                isCorrectAnswer: matches(question.correctAnswer, choice.id),
                                isStudentAnswer: matches(question.studentAnswer, choice.id)
                            )
                        }
                    }
                }

                if let explanation = question.explanation, !explanation.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Why this answer works", systemImage: "lightbulb.fill")
                            .font(.system(size: 11, weight: .heavy))
                            .tracking(1.2)
                            .foregroundStyle(Theme.accent)
                        RichText(text: explanation, serif: true)
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                            .fill(Theme.accentSoft)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                            .stroke(Theme.accent.opacity(0.15), lineWidth: 1)
                    )
                }
            }
            .padding(18)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: outcome.icon)
                .font(.system(size: 18))
                .foregroundStyle(outcome.tone)
            Text("Question \(ScoreText.string(index + 1))")
                .font(.system(size: 14, weight: .heavy))
            Text("of \(ScoreText.string(total))")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
            Text(outcome.label.uppercased())
                .font(.system(size: 10, weight: .heavy))
                .tracking(0.8)
                .foregroundStyle(outcome.tone)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Capsule().fill(outcome.tone.opacity(0.12)))
                .overlay(Capsule().stroke(outcome.tone.opacity(0.3), lineWidth: 1))
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
    }

    /// Grid-ins and short text: the two answers side by side, the correct one in the
    /// inverted panel the site uses so it reads as the fact, not as an opinion.
    private var typedAnswers: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("YOUR ANSWER")
                    .font(.system(size: 10, weight: .heavy)).tracking(0.9)
                    .foregroundStyle(Theme.textSecondary)
                if question.wasAnswered {
                    Text(question.studentAnswer.displayText)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(outcome == .correct ? Theme.success : Theme.danger)
                } else {
                    Text("Omitted").font(.system(size: 18, weight: .bold).italic())
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(outcome == .correct ? Theme.successSoft : (question.wasAnswered ? Theme.dangerSoft : Theme.background))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(outcome == .correct ? Theme.success : (question.wasAnswered ? Theme.danger : Theme.separator), lineWidth: 2)
            )

            VStack(alignment: .leading, spacing: 6) {
                Text("CORRECT ANSWER")
                    .font(.system(size: 10, weight: .heavy)).tracking(0.9)
                    .foregroundStyle(.white.opacity(0.7))
                Text(question.correctAnswer.displayText.isEmpty ? "—" : question.correctAnswer.displayText)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.primary)
            )
        }
    }

    /// The server may send a choice id ("B"), a zero-based index ("1"), or a number. Match
    /// on any of them, or a whole question renders with nothing marked correct.
    private func matches(_ value: JSONValue, _ choiceId: String) -> Bool {
        let raw = value.displayText.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return false }
        if raw.caseInsensitiveCompare(choiceId) == .orderedSame { return true }
        if let position = question.choices.firstIndex(where: { $0.id == choiceId }), raw == String(position) {
            return true
        }
        return false
    }
}

struct ReviewChoiceRow: View {
    let choice: AssessmentChoice
    let isCorrectAnswer: Bool
    let isStudentAnswer: Bool

    private var tone: Color? {
        if isCorrectAnswer { return Theme.success }
        if isStudentAnswer { return Theme.danger }
        return nil
    }

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Text(choice.id)
                .font(.system(size: 12, weight: .heavy))
                .frame(width: 28, height: 28)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(tone ?? Theme.card)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(tone ?? Theme.separator, lineWidth: 2)
                )
                .foregroundStyle(tone == nil ? Color.primary : .white)

            RichText(text: choice.text, serif: true)

            Spacer(minLength: 0)

            if isCorrectAnswer {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 16)).foregroundStyle(Theme.success)
            } else if isStudentAnswer {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 16)).foregroundStyle(Theme.danger)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(tone.map { $0.opacity(0.10) } ?? Theme.background)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(tone ?? Theme.separator.opacity(0.7), lineWidth: 2)
        )
    }
}

extension String {
    /// `nil` for a string that is empty or only whitespace — so `??` chains can fall
    /// through a blank title the way an absent one does.
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
