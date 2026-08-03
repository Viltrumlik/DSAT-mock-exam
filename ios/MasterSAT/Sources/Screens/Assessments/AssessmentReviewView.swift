import SwiftUI
import MasterSATKit

/// A marked assessment, question by question.
///
/// The point of this screen is the ones that were missed, so it opens on them — but every
/// question stays reachable, because "why was my right answer right" is a real question.
struct AssessmentReviewView: View {
    let attemptId: Int

    enum Filter: String, CaseIterable, Identifiable {
        case missed = "To revisit"
        case all = "All"

        var id: String { rawValue }
    }

    @Environment(Session.self) private var session
    @State private var review: AssessmentReview?
    @State private var filter: Filter = .missed
    @State private var loadError: String?

    private var shown: [AssessmentReviewQuestion] {
        guard let review else { return [] }
        return filter == .missed ? review.missed : review.questions
    }

    var body: some View {
        Group {
            if let review {
                List {
                    if let result = review.result {
                        Section {
                            HStack(spacing: 12) {
                                Text("\(ScoreText.string(result.percent))%")
                                    .font(.largeTitle.bold().monospacedDigit())
                                    .foregroundStyle(Theme.accent)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(result.correctCount) of \(result.totalQuestions) correct")
                                        .font(.subheadline)
                                    if result.maxPoints > 0 {
                                        Text("\(ScoreText.string(result.scorePoints)) / \(ScoreText.string(result.maxPoints)) points")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }

                    if let feedback = review.teacherFeedback, !feedback.body.isEmpty {
                        Section("From your teacher") {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(feedback.body).font(.subheadline)
                                if let name = feedback.teacherName, !name.isEmpty {
                                    Text(name).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }

                    Section {
                        Picker("Filter", selection: $filter) {
                            ForEach(Filter.allCases) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)

                        if shown.isEmpty {
                            Text(
                                filter == .missed
                                    ? "You got every question right."
                                    : "Nothing to show."
                            )
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        } else {
                            ForEach(shown) { question in
                                NavigationLink {
                                    ReviewQuestionView(question: question)
                                } label: {
                                    ReviewRow(question: question)
                                }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Review")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
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

struct ReviewRow: View {
    let question: AssessmentReviewQuestion

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(tint)
                .font(.subheadline)
            VStack(alignment: .leading, spacing: 2) {
                Text(question.prompt.strippedHTML).font(.subheadline).lineLimit(2)
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
    }

    private var icon: String {
        guard let correct = question.isCorrect else { return "minus.circle" }
        return correct ? "checkmark.circle.fill" : "xmark.circle.fill"
    }

    private var tint: Color {
        guard let correct = question.isCorrect else { return .secondary }
        return correct ? .green : Theme.flagged
    }

    private var subtitle: String {
        // A blank is a blank, not a wrong answer — they call for different next steps.
        guard question.wasAnswered else { return "Left blank" }
        return "You answered \(question.studentAnswer.displayText)"
    }
}

struct ReviewQuestionView: View {
    let question: AssessmentReviewQuestion

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let stimulus = question.questionPrompt, !stimulus.isEmpty {
                    RichText(html: stimulus)
                }
                RichText(html: question.prompt)

                if let image = question.questionImage, !image.isEmpty, let url = URL(string: image) {
                    AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
                        .frame(maxWidth: .infinity)
                }

                if !question.choices.isEmpty {
                    VStack(spacing: 10) {
                        ForEach(question.choices) { choice in
                            ReviewChoiceRow(
                                choice: choice,
                                isCorrectAnswer: question.correctAnswer.displayText == choice.id,
                                isStudentAnswer: question.studentAnswer.displayText == choice.id
                            )
                        }
                    }
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        LabeledContent("Your answer", value: question.wasAnswered ? question.studentAnswer.displayText : "—")
                        LabeledContent("Correct answer", value: question.correctAnswer.displayText)
                    }
                    .font(.subheadline)
                    .cardStyle()
                }

                if let explanation = question.explanation, !explanation.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Why").font(.subheadline.weight(.semibold))
                        RichText(html: explanation)
                    }
                    .cardStyle()
                }
            }
            .padding(16)
        }
        .navigationTitle("Question \(question.order + 1)")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct ReviewChoiceRow: View {
    let choice: AssessmentChoice
    let isCorrectAnswer: Bool
    let isStudentAnswer: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(choice.id)
                .font(.subheadline.bold())
                .frame(width: 30, height: 30)
                .background(Circle().fill(fill))
                .foregroundStyle(isCorrectAnswer || (isStudentAnswer && !isCorrectAnswer) ? .white : Color.primary)
            RichText(html: choice.text)
            Spacer(minLength: 0)
            if isStudentAnswer {
                Text("You").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(border, lineWidth: isCorrectAnswer || isStudentAnswer ? 2 : 1)
        )
    }

    private var fill: Color {
        if isCorrectAnswer { return .green }
        if isStudentAnswer { return Theme.flagged }
        return Color(.tertiarySystemFill)
    }

    private var border: Color {
        if isCorrectAnswer { return .green }
        if isStudentAnswer { return Theme.flagged }
        return Color(.separator)
    }
}
