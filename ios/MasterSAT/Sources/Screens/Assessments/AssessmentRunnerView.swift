import SwiftUI
import MasterSATKit

/// Working through one assessment.
///
/// Deliberately unlike the exam runner: no clock, no fullscreen plea, no off-screen
/// reporting. An assessment is homework — a student is allowed to put it down, look
/// something up, and come back. What it shares is the discipline about saving.
struct AssessmentRunnerView: View {
    let attemptId: Int
    let onClose: @MainActor () -> Void

    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var runner: AssessmentRunner?
    @State private var showSubmitConfirmation = false
    @State private var didSubmit = false

    var body: some View {
        NavigationStack {
            Group {
                if let runner {
                    if runner.isLoading {
                        ProgressView()
                    } else if didSubmit {
                        AssessmentSubmittedView(attemptId: attemptId, onClose: onClose)
                    } else if let question = runner.currentQuestion {
                        questionBody(runner, question)
                    } else if let error = runner.lastError {
                        RetryNotice(message: error.errorDescription ?? "Could not load this assessment.") {
                            await runner.load()
                        }
                    } else {
                        ContentUnavailableView(
                            "Nothing to answer",
                            systemImage: "questionmark.circle",
                            description: Text("This assessment has no questions yet.")
                        )
                    }
                } else {
                    ProgressView()
                }
            }
            .navigationTitle(runner?.bundle?.set?.title ?? "Assessment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    // Gone once it is handed in: there is nothing left to save, and
                    // "Save and exit" over a submitted paper reads like the work is
                    // still open.
                    if !didSubmit {
                        Button("Save and exit") {
                            Task {
                                // Never leave without writing. iOS can kill a backgrounded
                                // app outright, so "we'll send it later" is not a promise
                                // the app can keep.
                                await runner?.flush()
                                onClose()
                            }
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if let runner, !didSubmit {
                        Text("\(runner.answeredCount)/\(runner.questions.count)")
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .task {
            if runner == nil {
                let created = AssessmentRunner(attemptId: attemptId, api: session.assessments)
                runner = created
                await created.load()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard let runner, !didSubmit else { return }
            if phase == .background {
                Task { await runner.pauseForLeaving() }
            } else if phase == .active {
                Task { await runner.resume() }
            }
        }
        // An alert, not a confirmation dialog: iOS 26 renders a dialog's `.cancel` button
        // detached, and inside a fullScreenCover it does not render at all — which left
        // "Hand this in?" with one button and no visible way back.
        .alert("Hand this in?", isPresented: $showSubmitConfirmation) {
            Button("Keep working", role: .cancel) {}
            Button("Hand in") { submit() }
        } message: {
            if let runner, runner.answeredCount < runner.questions.count {
                let blank = runner.questions.count - runner.answeredCount
                Text("\(blank) question\(blank == 1 ? " is" : "s are") still blank.")
            } else {
                Text("Your teacher will see it once you do.")
            }
        }
    }

    @ViewBuilder
    private func questionBody(_ runner: AssessmentRunner, _ question: AssessmentQuestion) -> some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Text("Question \(runner.currentIndex + 1) of \(runner.questions.count)")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button {
                            runner.toggleFlag(question.id)
                        } label: {
                            Image(systemName: runner.flagged.contains(question.id) ? "flag.fill" : "flag")
                                .foregroundStyle(runner.flagged.contains(question.id) ? Theme.flagged : .secondary)
                        }
                    }

                    if let stimulus = question.questionPrompt, !stimulus.isEmpty {
                        RichText(html: stimulus)
                    }
                    RichText(html: question.prompt)

                    if let image = question.questionImage, !image.isEmpty, let url = URL(string: image) {
                        AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
                            .frame(maxWidth: .infinity)
                    }

                    answerControl(runner, question)

                    if !runner.unsaved.isEmpty {
                        // Say it rather than showing a silent tick. A student who loses
                        // signal mid-quiz deserves to know what has not landed.
                        Label("Some answers haven't saved yet — they'll retry.", systemImage: "arrow.clockwise")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
                .padding(16)
            }

            navigationBar(runner)
        }
    }

    @ViewBuilder
    private func answerControl(_ runner: AssessmentRunner, _ question: AssessmentQuestion) -> some View {
        switch question.questionType {
        case .multipleChoice:
            VStack(spacing: 10) {
                ForEach(question.choices) { choice in
                    AssessmentChoiceRow(
                        choice: choice,
                        imageURL: question.optionImages[choice.id],
                        isSelected: runner.answers[question.id] == .string(choice.id)
                    ) {
                        // Tapping the chosen answer again clears it — a student who
                        // changes their mind to "no answer" must be able to say so.
                        let current = runner.answers[question.id]
                        runner.setAnswer(current == .string(choice.id) ? .null : .string(choice.id), for: question.id)
                    }
                }
            }
        case .boolean:
            HStack(spacing: 10) {
                ForEach([true, false], id: \.self) { value in
                    Button {
                        runner.setAnswer(.bool(value), for: question.id)
                    } label: {
                        Text(value ? "True" : "False")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                    }
                    .buttonStyle(.bordered)
                    .tint(runner.answers[question.id] == .bool(value) ? Theme.accent : .secondary)
                }
            }
        case .numeric, .shortText, .unknown:
            TextField(
                question.questionType == .numeric ? "Your answer" : "Type your answer",
                text: Binding(
                    get: { runner.answers[question.id]?.displayText ?? "" },
                    // Typed input coalesces; the server takes strings for both, and its own
                    // grader parses the number, so there is no client-side parse to get
                    // wrong.
                    set: { runner.setAnswer($0.isEmpty ? .null : .string($0), for: question.id, immediate: false) }
                )
            )
            .textFieldStyle(.roundedBorder)
            .keyboardType(question.questionType == .numeric ? .numbersAndPunctuation : .default)
            .autocorrectionDisabled(question.questionType == .numeric)
        }
    }

    private func navigationBar(_ runner: AssessmentRunner) -> some View {
        HStack(spacing: 12) {
            Button {
                runner.previous()
            } label: {
                Label("Back", systemImage: "chevron.left")
            }
            .buttonStyle(.bordered)
            .disabled(runner.currentIndex == 0)

            Spacer()

            if runner.currentIndex == runner.questions.count - 1 {
                Button {
                    showSubmitConfirmation = true
                } label: {
                    if runner.isSubmitting {
                        ProgressView().tint(.white)
                    } else {
                        Text("Hand in").bold()
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(runner.isSubmitting)
            } else {
                Button {
                    runner.next()
                } label: {
                    Label("Next", systemImage: "chevron.right")
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
            }
        }
        .padding(16)
        .background(Theme.examChrome)
    }

    @MainActor
    private func submit() {
        guard let runner else { return }
        Task {
            if await runner.submit() { didSubmit = true }
        }
    }
}

struct AssessmentChoiceRow: View {
    let choice: AssessmentChoice
    let imageURL: String?
    let isSelected: Bool
    let onTap: @MainActor () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 12) {
                Text(choice.id)
                    .font(.subheadline.bold())
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(isSelected ? Theme.accent : Color(.tertiarySystemFill)))
                    .foregroundStyle(isSelected ? .white : Color.primary)
                VStack(alignment: .leading, spacing: 6) {
                    RichText(html: choice.text)
                    if let imageURL, !imageURL.isEmpty, let url = URL(string: imageURL) {
                        AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { EmptyView() }
                            .frame(maxHeight: 160)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(isSelected ? Theme.accent : Color(.separator), lineWidth: isSelected ? 2 : 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct AssessmentSubmittedView: View {
    let attemptId: Int
    let onClose: @MainActor () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(.green)
            Text("Handed in").font(.title2.bold())
            Text("Your teacher will see it. Marking may take a little while.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Done") { onClose() }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .controlSize(.large)
        }
        .padding(32)
    }
}
