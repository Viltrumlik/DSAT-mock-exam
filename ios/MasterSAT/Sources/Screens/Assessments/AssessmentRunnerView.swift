import SwiftUI
import MasterSATKit

/// Working through one assessment — the site's runner, at phone width.
///
/// Deliberately unlike the exam runner: no clock, no off-screen reporting. An assessment is
/// homework, and a student is allowed to put it down, look something up, and come back.
///
/// The interior is the web's: a header strip naming the class and the set, a question card
/// that runs stem → figure → instruction → choices in that order, SAT letter-circle options
/// with the cross-out tool, and a bottom bar. Plus the three things a phone needs and a
/// laptop does not — zoom, a flag, and a map of the whole set.
struct AssessmentRunnerView: View {
    let attemptId: Int
    let onClose: @MainActor () -> Void

    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var runner: AssessmentRunner?
    @State private var showSubmitConfirmation = false
    @State private var showMap = false
    @State private var showCalculator = false
    @State private var didSubmit = false
    /// Crossed-out choices, per question. Scratch work, not an answer: the site keeps this
    /// client-side too, and a student who eliminates B has not told the server anything.
    @State private var eliminated: [Int: Set<String>] = [:]
    /// Text scale. Matches the web's 70%–150% range and its 10-point steps.
    @AppStorage("assessmentZoom") private var zoom: Double = 1.0

    /// Desmos is offered on maths assessments only — the same rule the platform applies
    /// everywhere else. A calculator on a grammar set is not a tool, it is a distraction.
    private var offersCalculator: Bool {
        (runner?.bundle?.set?.subject ?? "").uppercased().contains("MATH")
    }

    var body: some View {
        Group {
            if let runner {
                if runner.isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if didSubmit {
                    AssessmentSubmittedView(onClose: onClose)
                } else if let question = runner.currentQuestion {
                    runnerBody(runner, question)
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
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
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

    // MARK: - Layout

    @ViewBuilder
    private func runnerBody(_ runner: AssessmentRunner, _ question: AssessmentQuestion) -> some View {
        VStack(spacing: 0) {
            toolbar(runner)
            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    setHeader(runner)
                    questionCard(runner, question)

                    if !runner.unsaved.isEmpty {
                        // Say it rather than showing a silent tick. A student who loses
                        // signal mid-quiz deserves to know what has not landed.
                        Label("Some answers haven't saved yet — they'll retry.", systemImage: "arrow.clockwise")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.warning)
                    }
                }
                .padding(14)
            }

            footer(runner)
        }
        .sheet(isPresented: $showMap) {
            QuestionMapSheet(runner: runner) { index in
                runner.go(to: index)
                showMap = false
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showCalculator) {
            CalculatorPanel { showCalculator = false }
                // Resizable rather than full-screen: a graph is only useful next to the
                // question it belongs to, and Desmos needs real height to be usable.
                .presentationDetents([.medium, .large])
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        }
    }

    /// Save-and-exit, the calculator, and the zoom control. Chrome only — the set's own
    /// identity lives in the card below, where the site puts it.
    private func toolbar(_ runner: AssessmentRunner) -> some View {
        HStack(spacing: 12) {
            Button("Save and exit") {
                Task {
                    // Never leave without writing. iOS can kill a backgrounded app
                    // outright, so "we'll send it later" is not a promise the app can keep.
                    await runner.flush()
                    onClose()
                }
            }
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(Theme.accent)

            Spacer(minLength: 0)

            if offersCalculator {
                Button { showCalculator = true } label: {
                    Image(systemName: "function")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(showCalculator ? Theme.accent : Theme.textSecondary)
                        .frame(width: 34, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 2) {
                zoomButton("textformat.size.smaller", enabled: zoom > 0.7) {
                    zoom = max(0.7, (zoom - 0.1).rounded(toPlaces: 2))
                }
                Text("\(Int(zoom * 100))%")
                    .font(.system(size: 11, weight: .bold).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 40)
                zoomButton("textformat.size.larger", enabled: zoom < 1.5) {
                    zoom = min(1.5, (zoom + 0.1).rounded(toPlaces: 2))
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.card)
    }

    private func zoomButton(_ icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 34, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .foregroundStyle(enabled ? Theme.textSecondary : Theme.textLabel.opacity(0.5))
    }

    /// The site's runner header: class, subject, set title, and how far along you are.
    private func setHeader(_ runner: AssessmentRunner) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                // The site also shows the classroom above the subject; the attempt bundle
                // does not carry it, and one extra request per question screen to print a
                // line of chrome is not a trade worth making.
                if let subject = runner.bundle?.set?.subject, !subject.isEmpty {
                    Text(subject.humanisedSubject.uppercased())
                        .font(.system(size: 11, weight: .heavy))
                        .tracking(1.8)
                        .foregroundStyle(Theme.accent)
                        .lineLimit(1)
                }
                Text(runner.bundle?.set?.title ?? "Assessment")
                    .font(.system(size: 16, weight: .heavy))
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            Text("\(ScoreText.string(runner.answeredCount))/\(ScoreText.string(runner.questions.count))")
                .font(.system(size: 14, weight: .bold).monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
    }

    /// The question itself. Order is the site's and it is not arbitrary: the stem comes
    /// first (in Reading that is the passage), then the figure, then the instruction (in
    /// Reading that is the actual question), then the options.
    private func questionCard(_ runner: AssessmentRunner, _ question: AssessmentQuestion) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("QUESTION \(ScoreText.string(runner.currentIndex + 1)) OF \(ScoreText.string(runner.questions.count))")
                    .font(.system(size: 10, weight: .bold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                flagButton(runner, question)
            }

            RichText(text: question.prompt, scale: zoom, weight: .semibold)

            if let image = question.questionImage, !image.isEmpty, let url = URL(string: image) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    ProgressView().frame(height: 120)
                }
                .frame(maxWidth: .infinity)
                .frame(maxHeight: 360)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Theme.separator.opacity(0.6), lineWidth: 0.5)
                )
            }

            if let instruction = question.questionPrompt, !instruction.isEmpty {
                // The site sets this in Georgia italic behind a left rule — it is the
                // instruction, not the passage, and it has to read as a different voice.
                HStack(alignment: .top, spacing: 0) {
                    Rectangle().fill(Theme.accent.opacity(0.4)).frame(width: 4)
                    RichText(text: instruction, scale: zoom, serif: true, italic: true)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                }
                .background(Theme.background)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

            answerControl(runner, question)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }

    private func flagButton(_ runner: AssessmentRunner, _ question: AssessmentQuestion) -> some View {
        Button {
            runner.toggleFlag(question.id)
        } label: {
            let isFlagged = runner.flagged.contains(question.id)
            HStack(spacing: 5) {
                Image(systemName: isFlagged ? "flag.fill" : "flag")
                    .font(.system(size: 12, weight: .bold))
                Text(isFlagged ? "Flagged" : "Flag")
                    .font(.system(size: 12, weight: .bold))
            }
            .foregroundStyle(isFlagged ? Theme.flagged : Theme.textSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(isFlagged ? Theme.flagged.opacity(0.14) : Theme.background))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func answerControl(_ runner: AssessmentRunner, _ question: AssessmentQuestion) -> some View {
        switch question.questionType {
        case .multipleChoice:
            VStack(spacing: 12) {
                ForEach(question.choices) { choice in
                    AssessmentChoiceRow(
                        choice: choice,
                        imageURL: question.optionImages[choice.id],
                        isSelected: runner.answers[question.id] == .string(choice.id),
                        isEliminated: eliminated[question.id]?.contains(choice.id) ?? false,
                        scale: zoom,
                        onTap: {
                            // Tapping the chosen answer again clears it — a student who
                            // changes their mind to "no answer" must be able to say so.
                            let current = runner.answers[question.id]
                            runner.setAnswer(current == .string(choice.id) ? .null : .string(choice.id), for: question.id)
                        },
                        onEliminate: { toggleElimination(choice.id, on: question, runner: runner) }
                    )
                }
            }
        case .boolean:
            HStack(spacing: 10) {
                ForEach([true, false], id: \.self) { value in
                    let chosen = runner.answers[question.id] == .bool(value)
                    Button {
                        runner.setAnswer(.bool(value), for: question.id)
                    } label: {
                        Text(value ? "True" : "False")
                            .font(.system(size: 16 * zoom, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 18)
                            .background(
                                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                                    .fill(chosen ? Theme.accentSoft : Theme.background)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                                    .stroke(chosen ? Theme.accent : Theme.separator, lineWidth: 2)
                            )
                            .foregroundStyle(chosen ? Theme.accent : Color.primary)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
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
            .font(.system(size: 18 * zoom, weight: .semibold))
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.background)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.separator, lineWidth: 2)
            )
            .keyboardType(question.questionType == .numeric ? .numbersAndPunctuation : .default)
            .autocorrectionDisabled(question.questionType == .numeric)
        }
    }

    /// Crossing out a choice is a thinking aid, so it also clears that choice if it happened
    /// to be the current answer — leaving an answer selected under a struck-through option
    /// would submit the very thing the student just ruled out.
    @MainActor
    private func toggleElimination(_ choiceId: String, on question: AssessmentQuestion, runner: AssessmentRunner) {
        var set = eliminated[question.id] ?? []
        if set.contains(choiceId) {
            set.remove(choiceId)
        } else {
            set.insert(choiceId)
            if runner.answers[question.id] == .string(choiceId) {
                runner.setAnswer(.null, for: question.id)
            }
        }
        eliminated[question.id] = set
    }

    /// Previous · question map · next — the web's bottom bar.
    private func footer(_ runner: AssessmentRunner) -> some View {
        HStack(spacing: 10) {
            Button {
                runner.previous()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .bold))
                    .frame(width: 46, height: 44)
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(runner.currentIndex == 0)
            .opacity(runner.currentIndex == 0 ? 0.4 : 1)

            Button {
                showMap = true
            } label: {
                HStack(spacing: 6) {
                    Text("\(ScoreText.string(runner.currentIndex + 1)) / \(ScoreText.string(runner.questions.count))")
                        .font(.system(size: 14, weight: .bold).monospacedDigit())
                    Image(systemName: "chevron.up").font(.system(size: 10, weight: .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .fill(Color.primary.opacity(0.85))
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if runner.currentIndex == runner.questions.count - 1 {
                Button {
                    showSubmitConfirmation = true
                } label: {
                    if runner.isSubmitting {
                        ProgressView().tint(.white).frame(maxWidth: .infinity)
                    } else {
                        Text("Hand in").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                .disabled(runner.isSubmitting)
            } else {
                Button {
                    runner.next()
                } label: {
                    HStack(spacing: 6) {
                        Text("Next")
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold))
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Theme.card)
    }

    @MainActor
    private func submit() {
        guard let runner else { return }
        Task {
            if await runner.submit() { didSubmit = true }
        }
    }
}

/// The question map: every question at a glance, answered / flagged / blank.
struct QuestionMapSheet: View {
    let runner: AssessmentRunner
    let onJump: @MainActor (Int) -> Void

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 5)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(Array(runner.questions.enumerated()), id: \.element.id) { index, question in
                            let isAnswered = runner.answers[question.id].map { !$0.isEmpty } ?? false
                            let isFlagged = runner.flagged.contains(question.id)
                            let isCurrent = index == runner.currentIndex

                            Button { onJump(index) } label: {
                                ZStack(alignment: .topTrailing) {
                                    Text(ScoreText.string(index + 1))
                                        .font(.system(size: 15, weight: .bold).monospacedDigit())
                                        .foregroundStyle(isCurrent ? .white : (isAnswered ? Theme.success : Color.primary))
                                        .frame(maxWidth: .infinity, minHeight: 48)
                                        .background(
                                            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                                                .fill(isCurrent ? Theme.accent : (isAnswered ? Theme.successSoft : Theme.surface2))
                                        )
                                        .overlay(
                                            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                                                .stroke(isCurrent ? Theme.accent : Theme.separator, lineWidth: 1)
                                        )
                                    if isFlagged {
                                        Image(systemName: "flag.fill")
                                            .font(.system(size: 9))
                                            .foregroundStyle(Theme.flagged)
                                            .padding(5)
                                    }
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    HStack(spacing: 14) {
                        legend("Current", Theme.accent)
                        legend("Answered", Theme.successSoft)
                        legend("Blank", Theme.surface2)
                        HStack(spacing: 5) {
                            Image(systemName: "flag.fill").font(.system(size: 9)).foregroundStyle(Theme.flagged)
                            Text("Flagged").font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
                .padding(18)
            }
            .background(Theme.background)
            .navigationTitle("Question navigation")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func legend(_ label: String, _ colour: Color) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 3).fill(colour).frame(width: 11, height: 11)
            Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
        }
    }
}

/// One answer choice, in the site's shape: a lettered circle, the text, and a cross-out
/// button beside it.
///
/// The circle is not decoration. Students are drilled on "the answer is B", and a list
/// without visible letters forces them to count rows before they can even hold the thought.
struct AssessmentChoiceRow: View {
    let choice: AssessmentChoice
    let imageURL: String?
    let isSelected: Bool
    var isEliminated = false
    var scale: Double = 1.0
    let onTap: @MainActor () -> Void
    var onEliminate: (@MainActor () -> Void)?

    private var borderColour: Color {
        isSelected ? Theme.accent : Theme.separator.opacity(0.9)
    }

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onTap) {
                HStack(alignment: .center, spacing: 14) {
                    Text(choice.id)
                        .font(.system(size: 15 * scale, weight: .heavy))
                        .frame(width: 36 * scale, height: 36 * scale)
                        .background(Circle().fill(isSelected ? Theme.accent : Theme.card))
                        .overlay(
                            Circle().stroke(isSelected ? Theme.accent : Theme.separator, lineWidth: 2)
                        )
                        .foregroundStyle(isSelected ? .white : Color.primary)

                    VStack(alignment: .leading, spacing: 8) {
                        RichText(text: choice.text, scale: scale, struckThrough: isEliminated)
                        if let imageURL, !imageURL.isEmpty, let url = URL(string: imageURL) {
                            AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { EmptyView() }
                                .frame(maxHeight: 220)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                        .fill(isSelected ? Theme.accentSoft : Theme.background)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                        .stroke(borderColour, lineWidth: 2)
                )
                // A button's label is only hit-testable where it DRAWS, so without this only
                // the glyphs themselves respond to a tap.
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isEliminated)

            if let onEliminate {
                Button(action: onEliminate) {
                    Image(systemName: isEliminated ? "arrow.uturn.backward" : "minus.circle")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(isEliminated ? Theme.textSecondary : Theme.textLabel)
                        .frame(minWidth: 44, maxWidth: 44, minHeight: 64)
                        .background(
                            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                                .stroke(isEliminated ? Theme.separator : .clear, lineWidth: 2)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isEliminated ? "Bring back option \(choice.id)" : "Cross out option \(choice.id)")
            }
        }
        .opacity(isEliminated ? 0.55 : 1)
    }
}

struct AssessmentSubmittedView: View {
    let onClose: @MainActor () -> Void

    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle().fill(Theme.successSoft).frame(width: 96, height: 96)
                Image(systemName: "checkmark")
                    .font(.system(size: 40, weight: .bold))
                    .foregroundStyle(Theme.success)
            }
            Text("Handed in").font(.system(size: 24, weight: .heavy))
            Text("Your teacher will see it. Marking may take a little while.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            Button("Done") { onClose() }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                .padding(.horizontal, 40)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension Double {
    /// Keeps the zoom readout off floating-point dust like 0.7999999999.
    func rounded(toPlaces places: Int) -> Double {
        let divisor = pow(10.0, Double(places))
        return (self * divisor).rounded() / divisor
    }
}
