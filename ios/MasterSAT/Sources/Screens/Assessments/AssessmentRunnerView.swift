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
    /// Called once the hand-in is accepted; the presenter celebrates it (`CelebrationCenter`).
    var onSubmitted: (@MainActor () -> Void)? = nil
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Which way the last question change went — the arriving question comes in from that side.
    @State private var turn: FocusTurn = .forward
    /// One tick per choice picked, option crossed out or question flagged: the selection haptic.
    /// Every pick ticks alike — the runner never says whether an answer is right.
    @State private var picks = 0
    /// Bumped only by a tap that flags a question (not when the flag comes off, and not under
    /// Reduce Motion): the flag's bounce. It is the bounce's trigger and nothing else is, so
    /// switching Reduce Motion off later has no change to play.
    @State private var flagBounces = 0
    /// A question is arriving: until its turn is over a tap lands on nothing, so a second tap
    /// made while the page was still turning cannot answer the question that has just come in.
    @State private var turning = false
    /// One more per turn — restarts the wait that ends `turning`.
    @State private var turns = 0
    /// What the flag's capsule really measures (a 12 pt line and 5 pt above and below it, at
    /// today's text size), read from the layout rather than assumed: the row it sits in takes
    /// exactly that, whatever its 44 pt tap target adds around it.
    @State private var flagCapsuleHeight: CGFloat = 24
    /// The typed answer's field. Dropped as the question turns: the field belongs to the
    /// question that left, and must not carry its keyboard into the next one.
    @FocusState private var answerFocused: Bool

    /// The top of the scrolled page — a new question opens here.
    private static let top = "runner.top"

    /// Desmos is offered on Middle and Senior maths sets only — the web runner's rule, read
    /// from the set's raw subject and level. A Junior or Foundation set is meant to be worked
    /// by hand, and a calculator on a grammar set is not a tool, it is a distraction.
    private var offersCalculator: Bool {
        runner?.bundle?.set?.offersCalculator ?? false
    }

    var body: some View {
        // A ZStack, not a Group: a Group hands its modifiers to each branch and rebuilds them with
        // every branch that replaces another, so a fade watching `didSubmit` never played. One
        // full-size view keeps one set, and the runner leaving and "Handed in" arriving crossfade
        // in place.
        ZStack {
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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
        .sensoryFeedback(.selection, trigger: picks)
        // The turn is over once the new question is in (`Motion.focus` and a frame). Each turn
        // restarts the wait; leaving the screen cancels it.
        .task(id: turns) {
            guard turning else { return }
            try? await Task.sleep(for: .seconds(Motion.focusTurnSeconds))
            if !Task.isCancelled { turning = false }
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

    // MARK: - Layout

    @ViewBuilder
    private func runnerBody(_ runner: AssessmentRunner, _ question: AssessmentQuestion) -> some View {
        VStack(spacing: 0) {
            toolbar(runner)
            Divider()

            ScrollViewReader { scroller in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        // The page's true top, above the padding below: scrolling here leaves
                        // the 14 pt margin in view, and a page already at the top does not move.
                        Color.clear
                            .frame(height: 0)
                            .id(Self.top)
                            .accessibilityHidden(true)

                        VStack(alignment: .leading, spacing: 12) {
                            setHeader(runner)
                            // A ZStack, so the question leaving and the one arriving overlap for
                            // their 200 ms instead of stacking and pushing the page down.
                            ZStack {
                                questionCard(runner, question)
                                    .id(question.id)
                                    .transition(.focusTurn(turn, reduceMotion: reduceMotion))
                            }
                            .allowsHitTesting(!turning)

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
                }
                .onChange(of: runner.currentIndex) { _, _ in
                    // A new question opens at its top, not where the last one was left.
                    scroller.scrollTo(Self.top, anchor: .top)
                }
            }

            footer(runner)
        }
        .sheet(isPresented: $showMap) {
            QuestionMapSheet(runner: runner) { index in
                move(to: index, runner)
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
            Button {
                Task {
                    // Never leave without writing. iOS can kill a backgrounded app
                    // outright, so "we'll send it later" is not a promise the app can keep.
                    await runner.flush()
                    onClose()
                }
            } label: {
                Text("Save and exit")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.accent)
                    .frame(minHeight: Self.minTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Spacer(minLength: 0)

            if offersCalculator {
                Button { showCalculator = true } label: {
                    Image(systemName: "function")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(showCalculator ? Theme.accent : Theme.textSecondary)
                        .frame(width: Self.minTarget, height: Self.minTarget)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Calculator")
            }

            HStack(spacing: 2) {
                zoomButton("textformat.size.smaller", label: "Smaller text", enabled: zoom > 0.7) {
                    zoom = max(0.7, (zoom - 0.1).rounded(toPlaces: 2))
                }
                Text("\(Int(zoom * 100))%")
                    .font(.system(size: 11, weight: .bold).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 40)
                zoomButton("textformat.size.larger", label: "Larger text", enabled: zoom < 1.5) {
                    zoom = min(1.5, (zoom + 0.1).rounded(toPlaces: 2))
                }
            }
        }
        .padding(.horizontal, 16)
        // The buttons are 44 pt tall themselves, so the bar needs little around them: the same
        // 50 pt it had when its glyphs were 30 pt tall inside 10 pt of padding.
        .padding(.vertical, 3)
        .background(Theme.card)
    }

    private func zoomButton(_ icon: String, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: Self.minTarget, height: Self.minTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .foregroundStyle(enabled ? Theme.textSecondary : Theme.textLabel.opacity(0.5))
        .accessibilityLabel(label)
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
            VStack(alignment: .trailing, spacing: 3) {
                // The count is the progress: it rolls when it moves, and no bar restates it.
                Text("\(ScoreText.string(runner.answeredCount))/\(ScoreText.string(runner.questions.count))")
                    .font(.system(size: 14, weight: .bold).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
                    .contentTransition(reduceMotion ? .identity : .numericText(value: Double(runner.answeredCount)))
                    .animation(Motion.focus, value: runner.answeredCount)
                    .accessibilityLabel("\(runner.answeredCount) of \(runner.questions.count) answered")
                SavedMark(runner: runner)
            }
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
        let isFlagged = runner.flagged.contains(question.id)
        return Button {
            runner.toggleFlag(question.id)
            picks += 1
            // The bounce is for the flag going on — read after the toggle, not from the render —
            // and not under Reduce Motion: the setting decides here whether there is a change to
            // play, so the symbol's trigger is the flag alone.
            if !reduceMotion, runner.flagged.contains(question.id) { flagBounces += 1 }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: isFlagged ? "flag.fill" : "flag")
                    .font(.system(size: 12, weight: .bold))
                    // Chrome beside the question, never over it — the one spring the runner
                    // allows.
                    .symbolEffect(.bounce, value: flagBounces)
                    // The word beside it says it; the glyph would read "flag, Flag".
                    .accessibilityHidden(true)
                Text(isFlagged ? "Flagged" : "Flag")
                    .font(.system(size: 12, weight: .bold))
            }
            .foregroundStyle(isFlagged ? Theme.flagged : Theme.textSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(isFlagged ? Theme.flagged.opacity(0.14) : Theme.background))
            .animation(Motion.focus, value: isFlagged)
            // Measured before the target is built around it. A no-op write is skipped: this runs
            // again for every question card.
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                if abs(height - flagCapsuleHeight) > 0.5 { flagCapsuleHeight = height }
            }
            // The capsule is drawn at its own size, inside a 44 pt target.
            .frame(minHeight: Self.minTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isFlagged ? .isSelected : [])
        // The target is 44 pt tall but takes the capsule's room in the row: the extra falls
        // above and below it, in the card's padding, so "QUESTION n OF m" does not grow.
        .frame(height: flagCapsuleHeight)
    }

    /// The smallest tappable height the app allows a control.
    private static let minTarget: CGFloat = 44

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
                            picks += 1
                        },
                        onEliminate: {
                            toggleElimination(choice.id, on: question, runner: runner)
                            picks += 1
                        }
                    )
                }
            }
        case .boolean:
            HStack(spacing: 10) {
                ForEach([true, false], id: \.self) { value in
                    let chosen = runner.answers[question.id] == .bool(value)
                    Button {
                        runner.setAnswer(.bool(value), for: question.id)
                        picks += 1
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
                            .animation(Motion.focus, value: chosen)
                    }
                    .buttonStyle(FocusPress())
                    // Which one is picked is heard, not only seen. It says nothing of right.
                    .accessibilityAddTraits(chosen ? .isSelected : [])
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
            .focused($answerFocused)
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
                move(to: runner.currentIndex - 1, runner)
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .bold))
                    .frame(width: 46, height: 44)
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityLabel("Previous question")
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
                // An ink pill with its own text colour: a dark pill and white text in light mode,
                // a light pill and dark text in dark mode — never white on white.
                .foregroundStyle(Theme.onInk)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .fill(Theme.ink.opacity(0.85))
                )
                // Drawn ~41 pt, tappable 44: the pill keeps its look, centred in the taller target.
                .frame(minHeight: Self.minTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Question \(runner.currentIndex + 1) of \(runner.questions.count)")
            .accessibilityHint("Opens the question map")

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
                // The spinner has no words; without this the button goes nameless mid-hand-in.
                .accessibilityLabel(runner.isSubmitting ? "Handing in" : "Hand in")
            } else {
                Button {
                    move(to: runner.currentIndex + 1, runner)
                } label: {
                    HStack(spacing: 6) {
                        Text("Next")
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold))
                            .accessibilityHidden(true)
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

    /// Another question: the arriving one comes in from the side it is on. The turn is set
    /// before the change, in the same update, so the arriving view reads it.
    @MainActor
    private func move(to index: Int, _ runner: AssessmentRunner) {
        guard index != runner.currentIndex, runner.questions.indices.contains(index) else { return }
        turn = FocusTurn.from(runner.currentIndex, to: index)
        answerFocused = false
        // Raised with the change itself, so there is no frame in which the arriving question can
        // be tapped; `.task(id: turns)` lowers it when the turn is over.
        turning = true
        turns += 1
        withAnimation(Motion.focus) { runner.go(to: index) }
    }

    @MainActor
    private func submit() {
        // `didSubmit` is the one-shot: the hand-in is announced to the presenter exactly once.
        guard let runner, !didSubmit else { return }
        Task {
            if await runner.submit(), !didSubmit {
                // The hand-in screen fades in rather than cutting — a crossfade, so the same under
                // Reduce Motion. Animated at the write, so nothing else in this update fades with it.
                withAnimation(Motion.focus) { didSubmit = true }
                onSubmitted?()
            }
        }
    }
}

/// A quiet "Saved" under the answered count, for a moment after the server confirmed a write.
///
/// It says a write landed — not that everything has, and not that the answer on screen has — so
/// it appears only when `savedCount` rises while it is on screen (never for the value it finds on
/// coming on screen, never on a tap), and not while a write is failing: the warning under the
/// question says what has not landed. Its own view, and the only one reading `savedCount`, so a
/// landing redraws only this word. Another confirmation keeps it up; the task is cancelled with
/// the view. VoiceOver is not told: a student who needs to know is told what has not saved, in
/// words.
private struct SavedMark: View {
    let runner: AssessmentRunner
    /// The confirmations already counted when this came on screen — those are not news. Nil while
    /// it is off screen: the task's first run reads it. Never read in an `init` — that runs inside
    /// the runner's body, which then redrew on every save.
    @State private var opened: Int?
    @State private var shown = false

    var body: some View {
        Label("Saved", systemImage: "checkmark")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Theme.textLabel)
            .opacity(shown && runner.unsaved.isEmpty ? 1 : 0)
            .animation(Motion.focus, value: shown)
            .accessibilityHidden(true)
            .task(id: runner.savedCount) {
                let saved = runner.savedCount
                // Coming on screen — the first time, or back after confirmations it never saw:
                // what it finds is the baseline, not news.
                guard let baseline = opened else {
                    opened = saved
                    return
                }
                guard saved > baseline else { return }
                shown = true
                try? await Task.sleep(for: .seconds(1.2))
                guard !Task.isCancelled else { return }
                shown = false
            }
            .onDisappear {
                shown = false
                opened = nil
            }
    }
}

/// The question map: every question at a glance, answered / flagged / blank.
struct QuestionMapSheet: View {
    let runner: AssessmentRunner
    let onJump: @MainActor (Int) -> Void

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 5)
    /// The cells have arrived — they settle in row by row, within 250 ms.
    @State private var shown = false

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
                                    // Answered is the runner's selection blue: green means
                                    // "correct" on the review, and the runner never says so.
                                    Text(ScoreText.string(index + 1))
                                        .font(.system(size: 15, weight: .bold).monospacedDigit())
                                        .foregroundStyle(isCurrent ? .white : (isAnswered ? Theme.accent : Color.primary))
                                        .frame(maxWidth: .infinity, minHeight: 48)
                                        .background(
                                            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                                                .fill(isCurrent ? Theme.accent : (isAnswered ? Theme.accentSoft : Theme.surface2))
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
                            .focusReveal(index / columns.count, shown: shown)
                            .accessibilityLabel("Question \(index + 1), \(isAnswered ? "answered" : "blank")\(isFlagged ? ", flagged" : "")")
                            .accessibilityAddTraits(isCurrent ? .isSelected : [])
                        }
                    }

                    HStack(spacing: 14) {
                        legend("Current", Theme.accent)
                        legend("Answered", Theme.accentSoft)
                        legend("Blank", Theme.surface2)
                        HStack(spacing: 5) {
                            Image(systemName: "flag.fill").font(.system(size: 9)).foregroundStyle(Theme.flagged)
                                .accessibilityHidden(true)
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
        .onAppear { shown = true }
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

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
                        // Not struck through in the text: toggling that re-rendered a rich
                        // option's web view. The line is drawn over the option instead (below).
                        RichText(text: choice.text, scale: scale)
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
                .overlay { crossOut }
                .animation(Motion.focus, value: isSelected)
            }
            .buttonStyle(FocusPress())
            .disabled(isEliminated)
            // The line is drawn, not read: VoiceOver hears the state instead. And which option
            // is picked is heard, not only seen — it says nothing of right.
            .accessibilityValue(isEliminated ? "Crossed out" : "")
            .accessibilityAddTraits(isSelected ? .isSelected : [])

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
        .animation(Motion.focus, value: isEliminated)
    }

    /// The line through a ruled-out option, drawn left to right — Bluebook's cross-out. Under
    /// Reduce Motion it is not drawn, it simply appears.
    private var crossOut: some View {
        GeometryReader { box in
            Path { line in
                line.move(to: CGPoint(x: 12, y: box.size.height / 2))
                line.addLine(to: CGPoint(x: max(12, box.size.width - 12), y: box.size.height / 2))
            }
            .trim(from: 0, to: isEliminated || reduceMotion ? 1 : 0)
            .stroke(Theme.textSecondary, style: StrokeStyle(lineWidth: 2, lineCap: .round))
            .opacity(isEliminated ? 1 : 0)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
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
                    .accessibilityHidden(true)
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
