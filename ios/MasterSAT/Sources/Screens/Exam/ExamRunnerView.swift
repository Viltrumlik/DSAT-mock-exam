import SwiftUI
import MasterSATKit

/// The exam itself: one question at a time, a server-anchored clock, and a navigator.
///
/// Deliberately plain. Nothing on this screen should compete with the question, and the
/// layout mirrors the web runner so a student trained on one is not re-learning the other
/// mid-exam.
struct ExamRunnerView: View {
    @Bindable var runner: ExamRunner
    let onClose: () -> Void

    @State private var isShowingNavigator = false
    @State private var isConfirmingSubmit = false
    @State private var isShowingExitHint = false

    private var question: ExamQuestion? { runner.currentQuestion }
    private var total: Int { runner.questions.count }

    var body: some View {
        VStack(spacing: 0) {
            ExamHeaderView(
                runner: runner,
                onExit: { isShowingExitHint = true }
            )

            Divider()

            if let question {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        questionHeader(question)
                        RichText(html: question.questionText)
                        if let prompt = question.questionPrompt, !prompt.isEmpty {
                            RichText(html: prompt)
                        }
                        answerArea(question)
                    }
                    .padding(20)
                }
                // Re-anchor the scroll position on every question so a long passage does
                // not leave the next question scrolled halfway down.
                .id(question.id)
            } else {
                ContentUnavailableView("No questions in this module", systemImage: "questionmark.circle")
            }

            Divider()

            ExamFooterView(
                index: runner.currentIndex,
                total: total,
                answered: runner.answeredCount,
                canGoBack: runner.currentIndex > 0,
                isLast: runner.currentIndex >= total - 1,
                isSubmitting: runner.isSubmitting,
                onPrevious: runner.previous,
                onNext: runner.next,
                onOpenNavigator: { isShowingNavigator = true },
                onFinish: { isConfirmingSubmit = true }
            )
        }
        .background(Theme.examBackground)
        .overlay(alignment: .top) {
            if let tally = runner.offscreen, tally.violations > 0, !tally.terminated {
                OffscreenWarningView(tally: tally)
            }
        }
        .sheet(isPresented: $isShowingNavigator) {
            QuestionNavigatorView(runner: runner) { index in
                runner.goTo(index)
                isShowingNavigator = false
            }
        }
        .confirmationDialog(
            "Submit this module?",
            isPresented: $isConfirmingSubmit,
            titleVisibility: .visible
        ) {
            Button("Submit") { Task { await runner.submitModule() } }
            Button("Keep working", role: .cancel) {}
        } message: {
            let unanswered = total - runner.answeredCount
            Text(unanswered > 0
                 ? "\(unanswered) question\(unanswered == 1 ? "" : "s") still open. You cannot come back to this module."
                 : "You cannot come back to this module.")
        }
        .confirmationDialog(
            "Leave the exam?",
            isPresented: $isShowingExitHint,
            titleVisibility: .visible
        ) {
            Button("Leave", role: .destructive) {
                Task {
                    await runner.flushOnLeaving()
                    onClose()
                }
            }
            Button("Stay", role: .cancel) {}
        } message: {
            // The truth, plainly: the clock is the server's and it does not stop. Saying
            // otherwise would be the one lie that costs a student their score.
            Text("The timer keeps running while you are away. Your answers are saved.")
        }
    }

    private func questionHeader(_ question: ExamQuestion) -> some View {
        HStack {
            Text("Question \(runner.currentIndex + 1) of \(total)")
                .font(.subheadline.weight(.semibold))
            Spacer()
            Button {
                runner.toggleFlag(questionId: question.id)
            } label: {
                Label(
                    runner.flagged.contains(question.id) ? "Flagged" : "Flag",
                    systemImage: runner.flagged.contains(question.id) ? "flag.fill" : "flag"
                )
                .font(.subheadline)
            }
            .tint(runner.flagged.contains(question.id) ? Theme.flagged : .secondary)
        }
    }

    @ViewBuilder
    private func answerArea(_ question: ExamQuestion) -> some View {
        if question.isMathInput {
            SprInputView(
                value: runner.answers[String(question.id)] ?? "",
                onChange: { runner.selectAnswer(questionId: question.id, value: $0) }
            )
        } else {
            ChoiceListView(
                question: question,
                selected: runner.answers[String(question.id)],
                eliminated: runner.eliminated[String(question.id)] ?? [],
                onSelect: { runner.selectAnswer(questionId: question.id, value: $0) },
                onEliminate: { runner.toggleEliminate(questionId: question.id, optionKey: $0) }
            )
        }
    }
}

struct ExamHeaderView: View {
    @Bindable var runner: ExamRunner
    let onExit: () -> Void

    /// Ticks the displayed countdown. The value itself always comes from the clock, which
    /// is anchored to the server — this only decides how often to re-read it.
    @State private var now = ExamClock.monotonicNow()
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var remaining: TimeInterval? {
        runner.clock?.remaining(at: now)
    }

    var body: some View {
        HStack {
            Button(action: onExit) {
                Image(systemName: "xmark").font(.subheadline.weight(.semibold))
            }
            .tint(.secondary)

            Spacer()

            VStack(spacing: 2) {
                if let remaining {
                    Text(ExamClock.format(remaining))
                        .font(.title3.bold().monospacedDigit())
                        .foregroundStyle(remaining <= Theme.timerUrgentThreshold ? Theme.timerUrgent : .primary)
                        .contentTransition(.numericText())
                }
                Text(runner.attempt?.practiceTestDetails.subject.replacingOccurrences(of: "_", with: " ").capitalized ?? "")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            // Balances the layout so the timer stays centred.
            Image(systemName: "xmark").font(.subheadline).opacity(0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.examChrome)
        .onReceive(tick) { _ in now = ExamClock.monotonicNow() }
    }
}

struct ExamFooterView: View {
    let index: Int
    let total: Int
    let answered: Int
    let canGoBack: Bool
    let isLast: Bool
    let isSubmitting: Bool
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onOpenNavigator: () -> Void
    let onFinish: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onPrevious) {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.bordered)
            .disabled(!canGoBack)

            Button(action: onOpenNavigator) {
                Text("\(answered) of \(total) answered")
                    .font(.footnote.weight(.medium))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)

            if isLast {
                Button(action: onFinish) {
                    if isSubmitting {
                        ProgressView().controlSize(.small).tint(.white)
                    } else {
                        Text("Finish").bold()
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(isSubmitting)
            } else {
                Button(action: onNext) {
                    Image(systemName: "chevron.right")
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.examChrome)
    }
}

struct OffscreenWarningView: View {
    let tally: OffscreenTally

    private var remainingChances: Int { max(0, tally.limit - tally.violations) }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
            VStack(alignment: .leading, spacing: 2) {
                Text("Stay in the exam").font(.subheadline.weight(.semibold))
                // States the rule and what is left, without scolding. The student still
                // has chances; say how many.
                Text(remainingChances == 1
                     ? "Leaving again will end your sitting."
                     : "\(remainingChances) more times will end your sitting.")
                    .font(.caption)
            }
            Spacer()
        }
        .padding(12)
        .background(.orange.opacity(0.95), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}
