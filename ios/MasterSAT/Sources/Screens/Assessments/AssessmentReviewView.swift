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
    /// The assessment homework this attempt belongs to. When the caller knows it, the page
    /// offers "Retry assessment" — a fresh attempt, as the web's result page does. The old
    /// attempt and its review are kept.
    var homeworkId: Int?
    /// Called once a retry's runner closes, so the page that opened this one can reload
    /// before the student lands back on it.
    var onRetryClosed: (@MainActor () -> Void)?

    /// "To improve", never "Wrong". The filter a student uses most is the one about the
    /// work still to do, and it should not read as a verdict.
    enum Filter: String, CaseIterable, Identifiable {
        case all = "All"
        case toImprove = "To improve"
        case correct = "Correct"
        case skipped = "Skipped"

        var id: String { rawValue }

        /// The chips, left to right — the one order the bar is drawn in and the card turns by. Spelt
        /// out rather than read from the declaration order above, which is free to change for any
        /// other reason without moving the chips.
        static let chipOrder: [Filter] = [.all, .toImprove, .correct, .skipped]
    }

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var review: AssessmentReview?
    @State private var filter: Filter = .all
    @State private var index = 0
    @State private var loadError: String?
    @State private var isRetrying = false
    @State private var retryAttemptId: Int?
    @State private var retryError: String?
    @Environment(CelebrationCenter.self) private var celebrations
    @State private var xpAtRetry: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Which way the card last turned — the arriving one comes in from that side.
    @State private var turn: FocusTurn = .forward
    /// The score this attempt beat, when it beat the attempt before it on the same set.
    @State private var improvedFrom: Double?
    /// Bumped once, the first time a beaten score is shown: the confetti and the success haptic.
    @State private var outcomeTicks = 0

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

    /// In `Filter.chipOrder`: the chips are built from it, so the order the student sees and the
    /// order the card turns by cannot differ.
    private var chips: [NewLookFilterChips<Filter>.Option] {
        Filter.chipOrder.map { filter in
            NewLookFilterChips<Filter>.Option(value: filter, title: filter.rawValue, count: matching(filter).count)
        }
    }

    private var setTitle: String? {
        review?.meta?.setTitle?.nilIfBlank ?? review?.meta?.assignmentTitle?.nilIfBlank
    }

    var body: some View {
        // A ZStack, not a Group: a Group hands its modifiers to each branch, so the confetti
        // overlay would live on the 20 pt spinner and be rebuilt — already past its trigger —
        // on the content that replaces it in the same update. One full-size view keeps one
        // overlay, sized to the page, from the first frame.
        ZStack {
            if let review {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 14) {
                            NewLookPageTitle(title: "Review", subtitle: setTitle)
                            NewLookFilterChips(options: chips, selection: filterSelection)
                        }

                        ScoreHero(review: review, questions: questions, improvedFrom: improvedFrom)

                        // Offered once the attempt is marked, as the web's result page offers
                        // it — a submission still waiting for its mark has nothing to retry yet.
                        if homeworkId != nil, review.result != nil { retryButton }

                        if let feedback = review.teacherFeedback, !feedback.body.isEmpty {
                            teacherNote(feedback)
                        }

                        if let current {
                            // A ZStack, so the card leaving and the one arriving overlap for their
                            // 200 ms. Keyed by the filter too: the same question under another
                            // filter is another card.
                            ZStack {
                                ReviewQuestionCard(
                                    question: current,
                                    index: shown.firstIndex(where: { $0.id == current.id }) ?? 0,
                                    total: shown.count
                                )
                                .id("\(filter.rawValue).\(current.id)")
                                .transition(.focusTurn(turn, reduceMotion: reduceMotion))
                            }
                            navigation
                        } else {
                            DashedEmpty(
                                title: emptyTitle,
                                hint: filter == .toImprove ? "Nothing to work on here." : nil
                            )
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .padding(.bottom, 16)
                }
                .background(NewLook.page)
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
            } else {
                // The score card, then the question under it. A focus zone: the blocks hold still.
                LoadingSkeleton(rows: 2, height: 160, style: .cards, pulse: false).skeletonPage()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(NewLook.page.ignoresSafeArea())
        // An outcome's confetti, drawn by the page itself so it is seen wherever the page is.
        .overlay { OutcomeConfetti(trigger: outcomeTicks) }
        .sensoryFeedback(.success, trigger: outcomeTicks)
        // The page's own title is in the page (`.h-page`); the bar keeps only the back button.
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .fullScreenCover(item: $retryAttemptId) { id in
            AssessmentRunnerView(attemptId: id, onSubmitted: {
                celebrations.celebrate(.assessment, xpBefore: xpAtRetry)
            }) {
                retryAttemptId = nil
                onRetryClosed?()
                // This review is of the attempt before; the new one lives on the board.
                dismiss()
            }
            .coversCelebrations(celebrations)
            .noBarClearance()
        }
        .alert(
            "Couldn't start this assessment",
            isPresented: Binding(get: { retryError != nil }, set: { if !$0 { retryError = nil } })
        ) {
            Button("OK", role: .cancel) { retryError = nil }
        } message: {
            Text(verbatim: retryError ?? "")
        }
    }

    private var retryButton: some View {
        Button { Task { await retry() } } label: {
            HStack(spacing: 8) {
                if isRetrying {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "arrow.counterclockwise")
                        .accessibilityHidden(true)
                }
                Text(isRetrying ? "Starting…" : "Retry assessment")
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(NewLookButtonStyle(kind: .light, size: .block))
        .disabled(isRetrying)
    }

    @MainActor
    private func retry() async {
        guard let homeworkId, !isRetrying else { return }
        isRetrying = true
        defer { isRetrying = false }
        do {
            let attempt = try await session.assessments.start(homeworkId: homeworkId)
            xpAtRetry = celebrations.xpNow
            retryAttemptId = attempt.id
        } catch let error as APIError {
            retryError = error.errorDescription
        } catch {
            retryError = error.localizedDescription
        }
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
            HStack(spacing: 6) {
                Image(systemName: "text.bubble.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(NewLook.orange)
                    .accessibilityHidden(true)
                Text("From your teacher").newLookCaps(NewLook.orangeInk)
            }
            Text(feedback.body)
                .appFont(16, weight: .medium)
                .foregroundStyle(NewLook.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let name = feedback.teacherName, !name.isEmpty {
                Text(name).appFont(13, weight: .semibold).foregroundStyle(NewLook.ink4)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NewLook.orange50, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    /// The filter, turning the card the way the chips run: a chip to the right brings its first
    /// question in from the right. The question resets to the first in the same update, so the
    /// card turns once. The chip already chosen changes nothing (the place in its list is kept).
    private var filterSelection: Binding<Filter> {
        Binding(
            get: { filter },
            set: { next in
                guard next != filter else { return }
                let order = Filter.chipOrder
                turn = FocusTurn.from(order.firstIndex(of: filter) ?? 0, to: order.firstIndex(of: next) ?? 0)
                index = 0
                filter = next
            }
        )
    }

    private var navigation: some View {
        HStack(spacing: 10) {
            Button {
                turn = .back
                withAnimation(Motion.focus) { index = max(0, index - 1) }
            } label: {
                Label("Previous", systemImage: "chevron.left").frame(maxWidth: .infinity)
            }
            .buttonStyle(NewLookButtonStyle(kind: .light, size: .block))
            .disabled(index == 0)

            Button {
                turn = .forward
                withAnimation(Motion.focus) { index = min(shown.count - 1, index + 1) }
            } label: {
                Label("Next", systemImage: "chevron.right")
                    .labelStyle(TrailingIconLabelStyle())
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(NewLookButtonStyle(kind: .light, size: .block))
            .disabled(index >= shown.count - 1)
        }
    }

    @MainActor
    private func load() async {
        loadError = nil
        do {
            let loaded = try await session.assessments.review(attemptId: attemptId)
            review = loaded
            // The page left while the answer was on its way: keep the review for its return, but
            // weigh nothing — remembering now would mark the outcome celebrated with no page to
            // show it. The load the return restarts weighs it, on screen.
            guard !Task.isCancelled else { return }
            remember(loaded)
        } catch let error as APIError {
            // A cancelled load is not a failure (`APIClient` reports a cancellation as transport).
            guard !Task.isCancelled else { return }
            loadError = error.errorDescription
        } catch {
            guard !Task.isCancelled else { return }
            loadError = error.localizedDescription
        }
    }

    /// The outcome rule (`CelebrationRule.assessment`, by way of `OutcomeMemory`): a marked attempt
    /// that beat the newest earlier attempt this phone knew of the same set says so every time it
    /// is shown, and is celebrated once — confetti, a success haptic, one sentence for VoiceOver.
    /// Only a marked attempt (`result`) is weighed, and one whose set the server did not name
    /// (`setKey` nil) is compared with nothing and remembered nowhere.
    @MainActor
    private func remember(_ review: AssessmentReview) {
        guard let result = review.result, case .signedIn(let user) = session.phase else { return }
        let book = OutcomeBook()
        var memory = book.read(userID: user.id)
        let before = memory
        let beaten = memory.showAssessment(setKey: review.setKey, attemptId: attemptId, percent: result.percent)
        let fresh = memory.celebrate(OutcomeMemory.assessmentKey(attemptId), if: beaten != nil)
        if memory != before { book.write(memory, userID: user.id) }
        if improvedFrom != beaten { improvedFrom = beaten }
        guard fresh, let beaten else { return }
        outcomeTicks += 1
        AccessibilityNotification.Announcement(
            "Better than last time — up from \(ScoreText.wholePercent(beaten)) percent."
        ).post()
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

/// The score card in the band's blue (mockup 33): class, set, the percentage, the counts.
struct ScoreHero: View {
    let review: AssessmentReview
    let questions: [AssessmentReviewQuestion]
    /// The score this attempt beat, when it beat the attempt before it on the same set.
    var improvedFrom: Double? = nil

    private var title: String {
        review.meta?.setTitle?.nilIfBlank
            ?? review.meta?.assignmentTitle?.nilIfBlank
            ?? "Assessment"
    }

    var body: some View {
        VStack(spacing: 0) {
            if let classroom = review.meta?.classroomName?.nilIfBlank {
                Text(classroom.uppercased())
                    .appFont(10.5, weight: .heavy)
                    .tracking(1.5)
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 4)
            }
            Text(title.uppercased())
                .appFont(13, weight: .heavy)
                .tracking(1.3)
                .foregroundStyle(.white.opacity(0.92))
                .multilineTextAlignment(.center)

            if let result = review.result {
                // The whole percent "Up from X%" below is weighed in, so the two never disagree at x.5.
                HStack(alignment: .lastTextBaseline, spacing: 2) {
                    RollingNumber(value: Double(CelebrationRule.wholePercent(result.percent)))
                        .appDisplayFont(60, monospacedDigits: true)
                        .tracking(-2)
                    Text("%")
                        .appDisplayFont(30)
                        .tracking(-1)
                        .accessibilityHidden(true)
                }
                .foregroundStyle(.white)
                .padding(.top, 10)
                .accessibilityElement(children: .combine)
                Text("\(ScoreText.string(result.correctCount)) of \(ScoreText.string(result.totalQuestions)) correct · \(ScoreText.string(result.scorePoints)) of \(ScoreText.string(result.maxPoints)) pts")
                    .appFont(13.5, weight: .semibold)
                    .foregroundStyle(.white.opacity(0.82))
                    .multilineTextAlignment(.center)
                    .padding(.top, 2)
                if let improvedFrom {
                    NewLookBlueChip(text: "Up from \(ScoreText.wholePercent(improvedFrom))%", systemImage: "chart.line.uptrend.xyaxis")
                        .padding(.top, 10)
                }
            } else {
                // Submitted but not yet marked. Naming that beats an absent score, which
                // reads as a zero.
                Text("Grading in progress — check back shortly.")
                    .appFont(15, weight: .bold)
                    .foregroundStyle(.white.opacity(0.9))
                    .multilineTextAlignment(.center)
                    .padding(.top, 14)
            }

            HStack(spacing: 8) {
                NewLookBlueTile(value: ScoreText.string(count(.correct)), label: "Correct").focusEntrance(0)
                NewLookBlueTile(value: ScoreText.string(count(.incorrect)), label: "To improve").focusEntrance(1)
                NewLookBlueTile(value: ScoreText.string(count(.unanswered)), label: "Skipped").focusEntrance(2)
            }
            .padding(.top, 18)
        }
        .newLookBlueCard()
    }

    private func count(_ outcome: Outcome) -> Int {
        questions.filter { Outcome.of($0) == outcome }.count
    }
}

// MARK: - Question deep dive

/// One question in full: what was asked, what every option was, which one was right, and
/// why. Green for the right answer, red only for a wrong one the student actually chose —
/// the other options fade rather than being painted as failures. The only place right and
/// wrong colours appear.
struct ReviewQuestionCard: View {
    let question: AssessmentReviewQuestion
    let index: Int
    let total: Int

    private var outcome: Outcome { Outcome.of(question) }

    /// The report being written about this card's question, if any. Per card: every card owns
    /// its own, so the one on screen is always the one reported.
    @State private var reporting: ReportedQuestion?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Rectangle().fill(NewLook.line).frame(height: 1)

            VStack(alignment: .leading, spacing: 16) {
                // Stem first — in Reading that is the passage; in Maths it is the question.
                RichText(text: question.prompt, serif: true, weight: .medium)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(NewLook.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

                if let image = question.questionImage, !image.isEmpty, let url = URL(string: image) {
                    AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
                        .frame(maxWidth: .infinity)
                        .frame(maxHeight: 380)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                // The instruction comes AFTER the stem — in Reading it is the actual
                // question being asked about the passage above.
                if let instruction = question.questionPrompt, !instruction.isEmpty {
                    HStack(alignment: .top, spacing: 0) {
                        Rectangle().fill(NewLook.blue.opacity(0.45)).frame(width: 4)
                        RichText(text: instruction, serif: true, weight: .medium)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                    }
                    .background(NewLook.sheet)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Answer analysis").newLookCaps()
                    // The pair heads every question now — on a choice question too, so the
                    // student reads the two answers before finding the green and red rows.
                    answerPair.focusEntrance(0)
                    ForEach(Array(question.choices.enumerated()), id: \.element.id) { position, choice in
                        ReviewChoiceRow(
                            choice: choice,
                            isCorrectAnswer: matches(question.correctAnswer, choice.id),
                            isStudentAnswer: matches(question.studentAnswer, choice.id)
                        )
                        .focusEntrance(position + 1)
                    }
                }

                if let explanation = question.explanation, !explanation.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 6) {
                            Image(systemName: "lightbulb.fill")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(NewLook.blueText)
                                .accessibilityHidden(true)
                            Text("Why this answer works").newLookCaps(NewLook.blueText)
                        }
                        RichText(text: explanation, serif: true)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(NewLook.blue50, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(NewLook.blue.opacity(0.15), lineWidth: 1)
                    )
                    // Open, as the web has it — it settles in last, after the answers.
                    .focusEntrance(max(question.choices.count, 1) + 1)
                }
            }
            .padding(16)
        }
        // Plain, as a focus zone's card is: the header and the body keep their own padding.
        .newLookCard(padding: 0, radius: 24)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        // No attempt id, exactly as the website's review page sends none: this report is about
        // the question itself, not about the sitting it was last seen in.
        .sheet(item: $reporting) { target in
            ReportProblemSheet(
                system: .assessment,
                questionId: target.questionId,
                questionNumber: target.number
            )
        }
    }

    private var tone: (fill: Color, ink: Color, glyph: Color) {
        switch outcome {
        case .correct: (NewLook.green50, NewLook.greenInk, NewLook.green)
        case .incorrect: (NewLook.red50, NewLook.redInk, NewLook.red)
        case .unanswered: (NewLook.orange50, NewLook.orangeInk, NewLook.orange)
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: outcome.icon)
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(tone.glyph)
                .accessibilityHidden(true)
            Text("Question \(ScoreText.string(index + 1))")
                .appFont(16, weight: .heavy)
                .foregroundStyle(NewLook.ink)
            Text("of \(ScoreText.string(total))")
                .appFont(13, weight: .semibold)
                .foregroundStyle(NewLook.muted)
            Spacer(minLength: 0)
            Text(outcome.label)
                .appFont(10.5, weight: .heavy)
                .tracking(1.05)
                .textCase(.uppercase)
                .foregroundStyle(tone.ink)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 10)
                .frame(minHeight: 24)
                .background(tone.fill, in: Capsule())
            reportButton
        }
        .padding(.leading, 16)
        .padding(.trailing, 10)
        .padding(.vertical, 10)
    }

    /// One per question, as the website puts one on every review card: the student is reading
    /// the marked paper and this is the moment a wrong key is noticed.
    private var reportButton: some View {
        Button {
            reporting = ReportedQuestion(questionId: question.id, number: index + 1)
        } label: {
            Image(systemName: "exclamationmark.bubble")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NewLook.ink4)
                .frame(width: 34, height: 34)
                .background(NewLook.line, in: Circle())
                .hitTarget(44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Report a problem with this question")
        // Chrome in a header row that already carries six things: it holds still while the text
        // around it grows, and the large content viewer names it on a press and hold.
        .capDynamicType(label: "Report a problem", systemImage: "exclamationmark.bubble")
    }

    /// The student's answer beside the correct one, the correct one in the ink panel so it
    /// reads as the fact, not an opinion. A choice question names the letter (and the words,
    /// when they are plain and short); a typed one, what was typed.
    private var answerPair: some View {
        let studentText: String
        let correctText: String
        if question.choices.isEmpty {
            studentText = question.studentAnswer.displayText
            correctText = question.correctAnswer.displayText.isEmpty ? "—" : question.correctAnswer.displayText
        } else {
            let mine = question.choices.first { matches(question.studentAnswer, $0.id) }
            let key = question.choices.first { matches(question.correctAnswer, $0.id) }
            studentText = mine.map { ReviewAnswerLabel.text(letter: $0.id, choiceText: $0.text) }
                ?? question.studentAnswer.displayText
            correctText = key.map { ReviewAnswerLabel.text(letter: $0.id, choiceText: $0.text) }
                ?? (question.correctAnswer.displayText.isEmpty ? "—" : question.correctAnswer.displayText)
        }
        let mineTone: (fill: Color, ring: Color, ink: Color, label: Color) = switch outcome {
        case .correct: (NewLook.green50, NewLook.green, NewLook.green, NewLook.greenInk)
        case .incorrect: (NewLook.red50, NewLook.red, NewLook.red, NewLook.redInk)
        case .unanswered: (NewLook.sheet, NewLook.field, NewLook.muted, NewLook.muted)
        }

        return HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Your answer").appFont(10, weight: .heavy).tracking(1).textCase(.uppercase)
                    .foregroundStyle(mineTone.label)
                if question.wasAnswered {
                    Text(studentText)
                        .appFont(17, weight: .bold)
                        .foregroundStyle(mineTone.ink)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("Omitted").appFont(17, weight: .bold).italic()
                        .foregroundStyle(NewLook.muted)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(mineTone.fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(mineTone.ring, lineWidth: 2)
            )
            .accessibilityElement(children: .combine)

            // The ink panel keeps its own text colour: white on ink by day, navy on the light
            // ink at night — never white on white.
            VStack(alignment: .leading, spacing: 4) {
                Text("Correct answer").appFont(10, weight: .heavy).tracking(1).textCase(.uppercase)
                    .foregroundStyle(NewLook.card.opacity(0.65))
                Text(correctText)
                    .appFont(17, weight: .bold)
                    .foregroundStyle(NewLook.card)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(NewLook.ink, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .accessibilityElement(children: .combine)
        }
        .fixedSize(horizontal: false, vertical: true)
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

/// One marked option, the kit's `.opt.right` / `.opt.wrong` / faded.
struct ReviewChoiceRow: View {
    let choice: AssessmentChoice
    let isCorrectAnswer: Bool
    let isStudentAnswer: Bool

    private var state: NewLookOptionState {
        if isCorrectAnswer { return .right }
        if isStudentAnswer { return .wrong }
        return .faded
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            NewLookOptionMark(letter: choice.id, state: state)
                .capDynamicType()

            RichText(text: choice.text, serif: true)
                .opacity(state == .faded ? 0.62 : 1)

            Spacer(minLength: 0)

            // The mark is the only thing that tells these two rows from the others, so VoiceOver
            // gets it in words — "Your answer", never a verdict on the student.
            if isCorrectAnswer {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 20)).foregroundStyle(NewLook.green)
                    .accessibilityLabel("Correct answer")
            } else if isStudentAnswer {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 20)).foregroundStyle(NewLook.red)
                    .accessibilityLabel("Your answer")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
        .newLookOptionSurface(state)
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

// MARK: - What the phone knows of the student's scores

extension ScoreText {
    /// A percent written as the whole number the outcome rule weighed (`CelebrationRule.wholePercent`).
    /// `string(_:)` rounds half away from zero, so it must not name a percent the rule compared.
    static func wholePercent(_ value: Double) -> String { String(CelebrationRule.wholePercent(value)) }
}
