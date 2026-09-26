import SwiftUI
import MasterSATKit

/// The student's live game — the web's `/live/<sessionId>` (`StudentGame.tsx`).
///
/// Mount as `LiveQuizGameView(sessionId:participantId:title:onClose:)`, presented
/// full-screen: it runs in the vocabulary games' focus shell — no tab bar, no status bar, the
/// screen kept awake — because it is played on a phone held up in class. `participantId` and
/// `title` come from `join/` (or a row of `mine/`) and may be left out: the room tells the
/// screen who the student is on connect. Needs `Session` from the environment.
struct LiveQuizGameView: View {
    let sessionId: Int
    var participantId: Int?
    var title: String?
    /// Called to leave. When nil the view dismisses itself.
    var onClose: (@MainActor () -> Void)?

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var model: LiveQuizModel?

    var body: some View {
        Group {
            if let model {
                LiveQuizGameScreen(model: model, onExit: close)
            } else {
                Theme.background.ignoresSafeArea()
            }
        }
        .task {
            if model == nil {
                model = LiveQuizModel(sessionId: sessionId, participantId: participantId, title: title, client: session.client)
            }
        }
    }

    private func close() {
        model?.leave()
        if let onClose {
            onClose()
        } else {
            dismiss()
        }
    }
}

private struct LiveQuizGameScreen: View {
    @Bindable var model: LiveQuizModel
    let onExit: @MainActor () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @State private var confirmingLeave = false

    private var game: LiveQuizGame { model.game }

    var body: some View {
        StudyShell(
            title: "Live quiz",
            subtitle: model.title.isEmpty ? game.joinCode : model.title,
            tone: Theme.accent,
            progress: nil,
            trailing: trailingPill,
            onExit: requestExit
        ) {
            ScrollView {
                VStack(spacing: 14) {
                    if let banner = bannerText {
                        LiveQuizConnectionBanner(text: banner)
                    }
                    content
                }
                .padding(16)
                // A readable column on an iPad; the whole width on a phone.
                .frame(maxWidth: 620)
                .frame(maxWidth: .infinity)
                .animation(.easeInOut(duration: 0.2), value: game.phase)
            }
        }
        .task(id: model.attempt) { await model.run() }
        .onChange(of: scenePhase) { _, phase in model.scenePhaseChanged(phase) }
        .sensoryFeedback(trigger: model.outcomeTick) { _, _ in
            if case .correct = model.game.outcome { return .success }
            return nil
        }
        .confirmationDialog("Leave the live quiz?", isPresented: $confirmingLeave, titleVisibility: .visible) {
            Button("Leave", role: .destructive) { onExit() }
            Button("Stay", role: .cancel) {}
        } message: {
            Text("Your place is kept while the quiz runs. You can come back from Running in your classes.")
        }
    }

    // MARK: - Chrome

    /// "3 / 10" once the game has a question to count.
    private var trailingPill: AnyView? {
        guard !game.phase.isFinal, model.denial == nil, game.currentIndex >= 0, game.questionTotal > 0 else { return nil }
        let number = min(game.currentIndex + 1, game.questionTotal)
        return AnyView(StudyPill(text: "\(ScoreText.string(number)) / \(ScoreText.string(game.questionTotal))", tone: Theme.accent))
    }

    /// The web's connection banner: only while the line is down, and never over a final screen.
    private var bannerText: String? {
        guard model.denial == nil, !model.diagnosing, !game.phase.isFinal else { return nil }
        switch model.link {
        case .open, .ended:
            return nil
        case .connecting:
            // Before the room has said anything, "Joining the quiz…" already says it.
            return game.status == nil ? nil : "Connecting to the quiz…"
        case .reconnecting:
            return "Lost contact — trying to reconnect."
        }
    }

    /// Leaving a running game asks first: one stray tap would cost the question on screen.
    private func requestExit() {
        let running = model.denial == nil && !game.phase.isFinal && game.status?.isLive == true
        if running {
            confirmingLeave = true
        } else {
            onExit()
        }
    }

    // MARK: - Content

    @ViewBuilder private var content: some View {
        if game.phase.isFinal {
            finalScreen
        } else if let denial = model.denial {
            denialCard(denial)
        } else if model.diagnosing {
            joining
        } else {
            switch game.phase {
            case .connecting:
                joining
            case .lobby:
                lobby
            case .starting:
                LiveQuizStateCard(icon: "clock", title: "Get ready…")
            case .question:
                LiveQuizQuestionPanel(model: model)
            case .results:
                results
            case .waitingForNext:
                LiveQuizStateCard(icon: "hourglass", title: "Waiting for the next question")
            case .paused:
                LiveQuizStateCard(
                    icon: "pause.circle", title: "Paused",
                    message: "Your teacher has paused the quiz. The clock is stopped.", tone: Theme.warning
                )
            case .finished, .terminated, .removed:
                EmptyView()
            }
        }
    }

    private var joining: some View {
        VStack(spacing: 14) {
            ProgressView()
            Text("Joining the quiz…")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 64)
    }

    private var lobby: some View {
        LiveQuizStateCard(
            icon: "person.3.fill",
            title: "You are in.",
            message: "Waiting for your teacher to start — keep this page open."
        ) {
            Text("\(Text(ScoreText.string(game.participants.count)).fontWeight(.heavy)) in the room")
                .font(.system(size: 15, weight: .medium))
                .padding(.top, 2)
        }
    }

    // MARK: Results

    @ViewBuilder private var results: some View {
        if let outcome = game.outcome, let reveal = game.reveal {
            LiveQuizOutcomeCard(outcome: outcome, reveal: reveal)
        }
        if game.config.showLeaderboardBetween, !game.standings.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("Standings")
                    .font(.system(size: 16, weight: .heavy))
                LiveQuizStandingsList(rows: game.standings, isMe: game.isMe, limit: 10)
            }
            .cardStyle(padding: 16)
        }
    }

    // MARK: The end

    @ViewBuilder private var finalScreen: some View {
        switch game.phase {
        case .finished:
            finished
        case .terminated:
            LiveQuizStateCard(
                icon: "stop.circle", title: "The quiz was stopped",
                message: "Your teacher ended this session.", tone: Theme.textSecondary
            ) { doneButton }
        case .removed:
            removedCard
        default:
            EmptyView()
        }
    }

    private var finished: some View {
        VStack(spacing: 14) {
            LiveQuizStateCard(icon: "trophy.fill", title: "That is the quiz", tone: Theme.amber) {
                if let mine = game.myStanding {
                    HStack(spacing: 8) {
                        LiveQuizStatBox(label: "Place", value: ScoreText.string(game.myPlace))
                        LiveQuizStatBox(label: "Score", value: ScoreText.string(mine.score))
                        LiveQuizStatBox(
                            label: "Correct",
                            value: "\(ScoreText.string(mine.correctCount))/\(ScoreText.string(game.questionTotal))"
                        )
                    }
                    .padding(.top, 4)
                }
            }
            VStack(alignment: .leading, spacing: 12) {
                Text("Final standings")
                    .font(.system(size: 16, weight: .heavy))
                LiveQuizStandingsList(rows: game.standings, isMe: game.isMe)
            }
            .cardStyle(padding: 16)
            doneButton
        }
    }

    private var removedCard: some View {
        LiveQuizStateCard(
            icon: "person.crop.circle.badge.xmark", title: "You are no longer in this quiz",
            message: "Your teacher removed you from the room. Ask them if this was a mistake.", tone: Theme.textSecondary
        ) { doneButton }
    }

    private var doneButton: some View {
        Button("Done") { onExit() }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .padding(.top, 4)
    }

    // MARK: Refusals

    @ViewBuilder private func denialCard(_ denial: LiveQuizDenial) -> some View {
        switch denial {
        case .removed:
            removedCard
        case .noPlace:
            LiveQuizStateCard(
                icon: "person.crop.circle.badge.questionmark", title: "You do not have a place in this quiz.",
                message: "Enter the code your teacher is showing."
            ) {
                Button("Enter the code") { onExit() }
                    .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                    .padding(.top, 4)
            }
        case .unknown:
            LiveQuizStateCard(icon: "wifi.exclamationmark", title: "Lost contact with the quiz.", tone: Theme.warning) {
                VStack(spacing: 10) {
                    Button("Try again") { model.retry() }
                        .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                    Button("Leave") { onExit() }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                }
                .padding(.top, 4)
            }
        case .featureOff:
            LiveQuizStateCard(
                icon: "antenna.radiowaves.left.and.right.slash", title: "Live quizzes are not switched on yet.",
                tone: Theme.textSecondary
            ) { doneButton }
        case .notInClass:
            LiveQuizStateCard(
                icon: "person.2.slash", title: "This live quiz belongs to a class you are not in.", tone: Theme.textSecondary
            ) { doneButton }
        case .stopped:
            LiveQuizStateCard(
                icon: "stop.circle", title: "The quiz was stopped",
                message: "Your teacher ended this session.", tone: Theme.textSecondary
            ) { doneButton }
        case .over:
            LiveQuizStateCard(icon: "flag.checkered", title: "That quiz is no longer running.", tone: Theme.textSecondary) {
                doneButton
            }
        case .signedOut:
            LiveQuizStateCard(
                icon: "person.crop.circle.badge.exclamationmark", title: "Your session has expired. Sign in again to rejoin.",
                tone: Theme.textSecondary
            ) { doneButton }
        }
    }
}

// MARK: - The question

/// An open question: the clock, the prompt, four big options and the one button.
///
/// Redrawn four times a second from the server's deadline on this phone's clock
/// (`LiveQuizGame.secondsLeft`) — never a counter decremented locally, which a phone that was
/// locked for a moment would come back from believing it had time it does not have.
private struct LiveQuizQuestionPanel: View {
    let model: LiveQuizModel

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { context in
            panel(now: context.date)
        }
    }

    @ViewBuilder private func panel(now: Date) -> some View {
        let game = model.game
        if let question = game.question {
            let canSubmit = game.canSubmit(at: now)
            let outOfTime = game.isOutOfTime(at: now)
            VStack(spacing: 14) {
                if let left = game.secondsLeft(at: now) {
                    countdown(left: left, warning: game.isWarning(at: now))
                }
                prompt(question, total: max(game.questionTotal, question.total))
                VStack(spacing: 10) {
                    ForEach(question.choices) { choice in
                        LiveQuizChoiceRow(
                            choice: choice,
                            isSelected: model.shownChoice == choice.id,
                            isDisabled: !canSubmit
                        ) { model.pick(choice.id) }
                    }
                }
                .sensoryFeedback(.selection, trigger: model.draft)
                footer(game: game, canSubmit: canSubmit, outOfTime: outOfTime)
            }
        }
    }

    /// The web's `CountdownBar` without the bar: the number is the information, and it turns
    /// red at the five-second warning.
    private func countdown(left: TimeInterval, warning: Bool) -> some View {
        let seconds = Int(left.rounded(.up))
        return HStack(alignment: .firstTextBaseline) {
            Text("Time left")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(ScoreText.string(seconds) + "s")
                .font(.system(size: 32, weight: .heavy).monospacedDigit())
                .foregroundStyle(warning ? Theme.danger : Color.primary)
                .contentTransition(.numericText(countsDown: true))
                .animation(.default, value: seconds)
        }
        .cardStyle(padding: 14)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(ScoreText.string(seconds)) seconds left")
    }

    private func prompt(_ question: LiveQuizQuestion, total: Int) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Overline("Question \(ScoreText.string(question.number)) of \(ScoreText.string(total))")
            if !question.questionPrompt.isEmpty {
                Text(question.questionPrompt)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.surface2))
            }
            // A single word is the thing to read at arm's length; a definition is a sentence.
            Text(question.prompt)
                .font(question.form == "word_to_definition"
                      ? .system(size: 30, weight: .heavy)
                      : .system(size: 20, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
        }
        .cardStyle(padding: 18)
    }

    @ViewBuilder private func footer(game: LiveQuizGame, canSubmit: Bool, outOfTime: Bool) -> some View {
        let answer = game.currentAnswer
        let counted = answer?.state == .accepted
        // A pick that would say something new: not the answer that already counted.
        let sendable = model.draft.map(game.isChange) ?? false
        // The web hides the button once the answer is locked; it stays while the answer can
        // still be changed, and while it is on its way (with a spinner).
        if !(counted && !game.config.allowAnswerChange) {
            Button {
                model.submit()
            } label: {
                HStack(spacing: 8) {
                    if model.isSending { ProgressView().tint(.white) }
                    Text(counted ? "Change my answer" : "Submit")
                }
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(!sendable || !canSubmit)
            .sensoryFeedback(.impact(weight: .medium), trigger: model.isSending) { _, sending in sending }
        }

        if outOfTime {
            // The clock is the server's, but the timer that closes the question runs in the
            // teacher's connection: if that has dropped, the question waits for them.
            Text("Waiting for your teacher…")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
        } else if counted {
            Text("Answer locked in. Waiting for the others…")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
        }

        if let notice = game.notice {
            Text(notice.detail)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.danger)
                .multilineTextAlignment(.center)
        }
    }
}

// MARK: - The result

/// The web's results card: how it went for this student, the answer, the example sentence.
private struct LiveQuizOutcomeCard: View {
    let outcome: LiveQuizOutcome
    let reveal: LiveQuizReveal

    var body: some View {
        VStack(spacing: 10) {
            switch outcome {
            case .correct(let points):
                symbol("checkmark.circle.fill", Theme.success)
                Text("Correct")
                    .font(.system(size: 21, weight: .heavy))
                    .foregroundStyle(Theme.success)
                if let points {
                    Text("+" + ScoreText.string(points))
                        .font(.system(size: 30, weight: .heavy).monospacedDigit())
                }
            case .notThisTime(let answer):
                symbol("xmark.circle", Theme.textSecondary)
                Text("Not this time")
                    .font(.system(size: 21, weight: .heavy))
                answerLine(answer)
            case .timeRanOut(let answer):
                symbol("clock", Theme.textSecondary)
                Text("Time ran out")
                    .font(.system(size: 21, weight: .heavy))
                answerLine(answer)
            case .answerIn:
                symbol("checkmark.seal", Theme.accent)
                Text("Answer locked in")
                    .font(.system(size: 21, weight: .heavy))
            }

            if !reveal.explanation.isEmpty {
                Text(reveal.explanation)
                    .font(.system(size: 14, weight: .medium))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.surface2))
                    .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .cardStyle(padding: 20)
    }

    private func symbol(_ name: String, _ tone: Color) -> some View {
        Image(systemName: name)
            .font(.system(size: 42, weight: .semibold))
            .foregroundStyle(tone)
            .accessibilityHidden(true)
    }

    /// "The answer was B" — and, unlike the web, what B said: the options have left the
    /// screen by now, and a letter alone makes the student remember which word it was.
    private func answerLine(_ answer: String) -> some View {
        VStack(spacing: 4) {
            Text("The answer was \(Text(answer).fontWeight(.heavy).foregroundStyle(Color.primary))")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
            if let text = reveal.correctChoiceText, !text.isEmpty {
                Text(text)
                    .font(.system(size: 16, weight: .bold))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
