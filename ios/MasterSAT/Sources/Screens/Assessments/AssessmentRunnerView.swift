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
    /// The one sheet the runner may have up. One host, one `.sheet(item:)`: a second
    /// `.sheet` on the same view cannot present while the first is up, which is how the
    /// Report button went dead behind the calculator — and, because `ReportedQuestion.id`
    /// is the question id, a second tap handed `.sheet(item:)` an equal item and it saw no
    /// change at all. As one item, asking for another sheet swaps the one on screen.
    @State private var sheet: RunnerSheet?
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

    /// The runner's three sheets, as one value: the map, the calculator and a report about
    /// one question. One `.sheet(item:)` hosts all three, so there is never a second one
    /// waiting behind the first for its turn that never comes.
    private enum RunnerSheet: Identifiable, Hashable {
        case map
        case calculator
        case report(ReportedQuestion)

        var id: String {
            switch self {
            case .map: "map"
            case .calculator: "calculator"
            case .report(let target): "report.\(target.questionId)"
            }
        }
    }

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
                    AssessmentSubmittedView(
                        setTitle: runner.bundle?.set?.title,
                        subject: runner.bundle?.set?.subject,
                        onClose: onClose
                    )
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
        .background(NewLook.page.ignoresSafeArea())
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
        // "Hand this in?" as the kit's floating window (mockup 32), not the system alert: the same
        // words, the runner's own three counts, and the same two answers. A window drawn by the
        // runner itself, so it shows inside the full-screen cover on every iOS (a confirmation
        // dialog's `.cancel` went missing in one there).
        .newLookWindow(isPresented: showSubmitConfirmation) {
            if let runner {
                HandInWindow(
                    summary: HandInSummary(
                        answered: runner.answeredCount,
                        total: runner.questions.count,
                        flagged: runner.flagged.count
                    ),
                    onKeepWorking: { showSubmitConfirmation = false },
                    onHandIn: {
                        showSubmitConfirmation = false
                        submit()
                    }
                )
            }
        }
    }

    // MARK: - Layout

    @ViewBuilder
    private func runnerBody(_ runner: AssessmentRunner, _ question: AssessmentQuestion) -> some View {
        ScrollViewReader { scroller in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // The page's true top, above the padding below: scrolling here leaves
                    // the margin in view, and a page already at the top does not move.
                    Color.clear
                        .frame(height: 0)
                        .id(Self.top)
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 14) {
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
                                .appFont(12, weight: .semibold)
                                .foregroundStyle(NewLook.orangeInk)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 16)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: runner.currentIndex) { _, _ in
                // A new question opens at its top, not where the last one was left.
                scroller.scrollTo(Self.top, anchor: .top)
            }
        }
        // The focus screen's chrome floats over the page, as the tab bar does elsewhere: the
        // two glass pills above, the glass bar below. The page scrolls under both.
        .safeAreaInset(edge: .top, spacing: 0) { toolbar(runner) }
        .safeAreaInset(edge: .bottom, spacing: 0) { footer(runner) }
        // Each case keeps its own presentation configuration; the host is shared.
        .sheet(item: $sheet) { which in
            switch which {
            case .map:
                QuestionMapSheet(
                    runner: runner,
                    onJump: { index in
                        move(to: index, runner)
                        sheet = nil
                    },
                    onHandIn: {
                        // The same window the last question's Hand in opens, once the map is down.
                        sheet = nil
                        showSubmitConfirmation = true
                    },
                    onClose: { sheet = nil }
                )
                .presentationDetents([.medium, .large])
                .presentationBackground(NewLook.sheet)
            case .calculator:
                CalculatorPanel { sheet = nil }
                    // Resizable rather than full-screen: a graph is only useful next to the
                    // question it belongs to, and Desmos needs real height to be usable.
                    .presentationDetents([.medium, .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
            case .report(let target):
                // Which question is reported is fixed by the tap, not read while the sheet is
                // up: a page that turns behind it must not move the report on to the next
                // question.
                ReportProblemSheet(
                    system: .assessment,
                    questionId: target.questionId,
                    attemptId: attemptId,
                    questionNumber: target.number
                )
            }
        }
    }

    /// "Save and exit" in its glass pill, and one tools pill: report, the calculator, and the
    /// zoom. Chrome only — the set's own identity lives in the card below, where the site puts it.
    private func toolbar(_ runner: AssessmentRunner) -> some View {
        // One row; two at the accessibility sizes — "Save and exit" above, the tools below —
        // since a 40-pt label and three 44-pt buttons are wider than the phone once the words grow.
        AdaptiveStack(spacing: 8, columnSpacing: 8) {
            Button {
                Task {
                    // Never leave without writing. iOS can kill a backgrounded app
                    // outright, so "we'll send it later" is not a promise the app can keep.
                    await runner.flush()
                    onClose()
                }
            } label: {
                NewLookPillLabel(title: "Save and exit", systemImage: "xmark")
            }
            .buttonStyle(PressBounce())

            AdaptiveSpacer()

            HStack(spacing: 0) {
                reportButton(runner)

                if offersCalculator {
                    Button { sheet = .calculator } label: {
                        Image(systemName: "function")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(sheet == .calculator ? NewLook.blueText : NewLook.ink4)
                            .frame(width: 38, height: Self.minTarget)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Calculator")
                    .capDynamicType()
                }

                Rectangle()
                    .fill(NewLook.field)
                    .frame(width: 1, height: 20)
                    .padding(.horizontal, 3)
                    .accessibilityHidden(true)

                zoomButton("A−", label: "Smaller text", enabled: zoom > 0.7) {
                    zoom = max(0.7, (zoom - 0.1).rounded(toPlaces: 2))
                }
                Text("\(Int(zoom * 100))%")
                    .appFont(12, weight: .heavy, monospacedDigits: true)
                    .foregroundStyle(NewLook.ink4)
                    // At least 40 pt, as it was; "100%" set large needs more, not an ellipsis.
                    .frame(minWidth: 40)
                    .fixedSize()
                zoomButton("A+", label: "Larger text", enabled: zoom < 1.5) {
                    zoom = min(1.5, (zoom + 0.1).rounded(toPlaces: 2))
                }
            }
            .padding(.horizontal, 4)
            .newLookGlassCapsule()
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 6)
    }

    /// "Report a problem with this question", as the web runner carries it in its own tool row.
    ///
    /// Beside the flag in purpose, not in glyph: flagging is the student's private bookmark and
    /// this is a message to the school, and two flags in one runner would be read as one control.
    /// Nothing here touches the answer behind it — the sheet opens over the page and the page
    /// carries on as it was.
    @ViewBuilder
    private func reportButton(_ runner: AssessmentRunner) -> some View {
        if let question = runner.currentQuestion {
            Button {
                sheet = .report(ReportedQuestion(questionId: question.id, number: runner.currentIndex + 1))
            } label: {
                Image(systemName: "exclamationmark.bubble")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(NewLook.ink4)
                    .frame(width: 38, height: Self.minTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Report a problem with this question")
            // A glyph in a fixed 44-pt frame spills out of it at the accessibility sizes, and a
            // speech bubble between a calculator and a zoom stepper does not say what it does.
            // The cap holds the frame; the large content viewer names it on a press and hold.
            .capDynamicType(label: "Report a problem", systemImage: "exclamationmark.bubble")
        }
    }

    private func zoomButton(_ title: String, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .appFont(15, weight: .heavy)
                .frame(width: 38, height: Self.minTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .foregroundStyle(enabled ? NewLook.ink4 : NewLook.chevron)
        .accessibilityLabel(label)
        .capDynamicType()
    }

    /// The site's runner header: subject, set title, and how far along you are.
    private func setHeader(_ runner: AssessmentRunner) -> some View {
        let subject = runner.bundle?.set?.subject ?? ""
        return AdaptiveStack(spacing: 12, columnSpacing: 8) {
            HStack(spacing: 12) {
                NewLookTile(systemName: Self.subjectGlyph(subject), tone: Self.subjectTone(subject))
                VStack(alignment: .leading, spacing: 2) {
                    // The site also shows the classroom above the subject; the attempt bundle
                    // does not carry it, and one extra request per question screen to print a
                    // line of chrome is not a trade worth making.
                    if !subject.isEmpty {
                        Text(subject.humanisedSubject)
                            .newLookCaps(NewLook.blueText)
                            .titleLineLimit(1)
                    }
                    Text(runner.bundle?.set?.title ?? "Assessment")
                        .appDisplayFont(17)
                        .tracking(-0.2)
                        .foregroundStyle(NewLook.ink)
                        .titleLineLimit(2)
                }
            }
            AdaptiveSpacer()
            VStack(alignment: .trailing, spacing: 2) {
                // The count is the progress: it rolls when it moves, and no bar restates it.
                HStack(spacing: 0) {
                    Text(ScoreText.string(runner.answeredCount))
                        .foregroundStyle(NewLook.ink)
                        .contentTransition(reduceMotion ? .identity : .numericText(value: Double(runner.answeredCount)))
                        .animation(Motion.focus, value: runner.answeredCount)
                    Text("/\(ScoreText.string(runner.questions.count))")
                        .foregroundStyle(NewLook.muted)
                }
                .appDisplayFont(21, monospacedDigits: true)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(runner.answeredCount) of \(runner.questions.count) answered")
                SavedMark(runner: runner)
            }
        }
        .newLookCard()
    }

    /// The set's glyph: a function for maths, a book for reading and writing.
    static func subjectGlyph(_ raw: String) -> String {
        raw.lowercased().contains("math") ? "function" : "text.book.closed.fill"
    }

    static func subjectTone(_ raw: String) -> NewLook.Tone {
        raw.lowercased().contains("math") ? .blue : .violet
    }

    /// The question itself. Order is the site's and it is not arbitrary: the stem comes
    /// first (in Reading that is the passage), then the figure, then the instruction (in
    /// Reading that is the actual question), then the options.
    private func questionCard(_ runner: AssessmentRunner, _ question: AssessmentQuestion) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Question \(ScoreText.string(runner.currentIndex + 1)) of \(ScoreText.string(runner.questions.count))")
                    .newLookCaps()
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
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(NewLook.line, lineWidth: 1)
                )
            }

            if let instruction = question.questionPrompt, !instruction.isEmpty {
                // The site sets this in Georgia italic behind a left rule — it is the
                // instruction, not the passage, and it has to read as a different voice.
                HStack(alignment: .top, spacing: 0) {
                    Rectangle().fill(NewLook.blue.opacity(0.45)).frame(width: 4)
                    RichText(text: instruction, scale: zoom, serif: true, italic: true)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                }
                .background(NewLook.sheet)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }

            answerControl(runner, question)
        }
        .newLookCard(padding: 18, radius: 24)
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
            HStack(spacing: 4) {
                Image(systemName: isFlagged ? "flag.fill" : "flag")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(isFlagged ? NewLook.orange : NewLook.muted)
                    // Chrome beside the question, never over it — the one spring the runner
                    // allows.
                    .symbolEffect(.bounce, value: flagBounces)
                    // The word beside it says it; the glyph would read "flag, Flag".
                    .accessibilityHidden(true)
                Text(isFlagged ? "Flagged" : "Flag")
                    .appFont(12, weight: .heavy)
            }
            .foregroundStyle(isFlagged ? NewLook.orangeInk : NewLook.ink4)
            .padding(.leading, 8)
            .padding(.trailing, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(isFlagged ? NewLook.orange50 : NewLook.line))
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
            VStack(spacing: 10) {
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
                            .foregroundStyle(chosen ? NewLook.blueDeep : NewLook.ink)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 18)
                            .newLookOptionSurface(chosen ? .picked : .idle)
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
            .foregroundStyle(NewLook.ink)
            .padding(16)
            .newLookOptionSurface(answerFocused ? .picked : .idle)
            .animation(Motion.focus, value: answerFocused)
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

    /// Previous · question map · next — the web's bottom bar, in the tab bar's glass capsule so
    /// the focus screen still feels like the same app.
    private func footer(_ runner: AssessmentRunner) -> some View {
        // Three controls in a row; in a column at the accessibility sizes, each as wide as it needs.
        AdaptiveStack(spacing: 6) {
            Button {
                move(to: runner.currentIndex - 1, runner)
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 19, weight: .bold))
                    .foregroundStyle(NewLook.blueDeep)
                    .frame(width: 52, height: 52)
                    .background(NewLook.blue50, in: Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(PressBounce())
            .accessibilityLabel("Previous question")
            .capDynamicType(label: "Previous question", systemImage: "chevron.left")
            .disabled(runner.currentIndex == 0)
            .opacity(runner.currentIndex == 0 ? 0.45 : 1)

            Button {
                sheet = .map
            } label: {
                HStack(spacing: 5) {
                    Text("\(ScoreText.string(runner.currentIndex + 1)) / \(ScoreText.string(runner.questions.count))")
                        .appFont(16, weight: .heavy, monospacedDigits: true)
                    Image(systemName: "chevron.up").font(.system(size: 12, weight: .heavy))
                        .accessibilityHidden(true)
                }
                // The ink pill keeps its own text colour: white on ink by day, navy on the light
                // ink at night — never white on white.
                .foregroundStyle(NewLook.card)
                .padding(.horizontal, 18)
                .frame(minHeight: 52)
                .background(NewLook.ink, in: Capsule())
                .contentShape(Capsule())
            }
            .buttonStyle(PressBounce())
            .accessibilityLabel("Question \(runner.currentIndex + 1) of \(runner.questions.count)")
            .accessibilityHint("Opens the question map")

            if runner.currentIndex == runner.questions.count - 1 {
                Button {
                    showSubmitConfirmation = true
                } label: {
                    ZStack {
                        // The title keeps its width while the spinner shows.
                        Text("Hand in").opacity(runner.isSubmitting ? 0 : 1)
                        if runner.isSubmitting { ProgressView().tint(.white) }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(NewLookButtonStyle(size: .large))
                .disabled(runner.isSubmitting)
                // The spinner has no words; without this the button goes nameless mid-hand-in.
                .accessibilityLabel(runner.isSubmitting ? "Handing in" : "Hand in")
            } else {
                Button {
                    move(to: runner.currentIndex + 1, runner)
                } label: {
                    HStack(spacing: 6) {
                        Text("Next")
                        Image(systemName: "chevron.right").font(.system(size: 14, weight: .heavy))
                            .accessibilityHidden(true)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(NewLookButtonStyle(size: .large))
            }
        }
        .padding(6)
        .background {
            RoundedRectangle(cornerRadius: 32, style: .continuous)
                .fill(.regularMaterial)
                .overlay(RoundedRectangle(cornerRadius: 32, style: .continuous).fill(NewLook.card.opacity(0.55)))
                .overlay(
                    RoundedRectangle(cornerRadius: 32, style: .continuous)
                        .strokeBorder(NewLook.ink.opacity(0.08), lineWidth: 0.5)
                )
                .shadow(color: Color(.sRGB, red: 14 / 255, green: 36 / 255, blue: 80 / 255, opacity: 0.14), radius: 15, y: 10)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
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
        HStack(spacing: 2) {
            Image(systemName: "checkmark")
                .font(.system(size: 11, weight: .heavy))
                .foregroundStyle(NewLook.green)
            Text("Saved")
                .appFont(11.5, weight: .bold)
                .foregroundStyle(NewLook.muted)
        }
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

/// The question map: every question at a glance, answered / flagged / blank (mockup 31).
///
/// Answered is soft blue, blank is white, the open one is solid blue; a small orange flag marks
/// a flagged one. Never green — green means "correct" on the review, and the runner never says so.
/// A Hand in button at its foot opens the same "Hand this in?" window as the last question's.
struct QuestionMapSheet: View {
    let runner: AssessmentRunner
    let onJump: @MainActor (Int) -> Void
    let onHandIn: @MainActor () -> Void
    let onClose: @MainActor () -> Void

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 5)
    /// The cells have arrived — they settle in row by row, within 250 ms.
    @State private var shown = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                NewLookSheetHeader(
                    title: "Question navigation",
                    subtitle: QuestionMapSubtitle.text(
                        answered: runner.answeredCount,
                        total: runner.questions.count,
                        flagged: runner.flagged.count
                    ),
                    onClose: { onClose() }
                ) {
                    NewLookTile(systemName: "square.grid.2x2.fill")
                }

                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(Array(runner.questions.enumerated()), id: \.element.id) { index, question in
                        let isAnswered = runner.answers[question.id].map { !$0.isEmpty } ?? false
                        let isFlagged = runner.flagged.contains(question.id)
                        let state = QuestionMapCellState.of(isCurrent: index == runner.currentIndex, isAnswered: isAnswered)

                        Button { onJump(index) } label: {
                            cell(number: index + 1, state: state, flagged: isFlagged)
                        }
                        .buttonStyle(PressBounce())
                        .focusReveal(index / columns.count, shown: shown)
                        .accessibilityLabel("Question \(index + 1), \(isAnswered ? "answered" : "blank")\(isFlagged ? ", flagged" : "")")
                        .accessibilityAddTraits(state == .current ? .isSelected : [])
                    }
                }

                HStack(spacing: 14) {
                    legend("Current", fill: NewLook.blue, ring: nil)
                    legend("Answered", fill: NewLook.blue50, ring: nil)
                    legend("Blank", fill: NewLook.card, ring: NewLook.field)
                    HStack(spacing: 5) {
                        Image(systemName: "flag.fill").font(.system(size: 11, weight: .bold))
                            .foregroundStyle(NewLook.orange)
                            .accessibilityHidden(true)
                        Text("Flagged").appFont(13, weight: .semibold)
                            .foregroundStyle(NewLook.ink4)
                    }
                }
                .accessibilityElement(children: .combine)

                Button("Hand in") { onHandIn() }
                    .buttonStyle(NewLookButtonStyle(size: .large))
                    .disabled(runner.isSubmitting)
                    .padding(.top, 4)
            }
            .padding(.horizontal, 16)
            .padding(.top, 22)
            .padding(.bottom, 16)
        }
        .background(NewLook.sheet)
        .onAppear { shown = true }
    }

    private func cell(number: Int, state: QuestionMapCellState, flagged: Bool) -> some View {
        let fill: Color
        let ink: Color
        switch state {
        case .current: (fill, ink) = (NewLook.blue, .white)
        case .answered: (fill, ink) = (NewLook.blue50, NewLook.blueDeep)
        case .blank: (fill, ink) = (NewLook.card, NewLook.ink)
        }
        return Text(ScoreText.string(number))
            .appDisplayFont(18, monospacedDigits: true)
            .foregroundStyle(ink)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(fill)
                    .overlay {
                        if state == .blank {
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .strokeBorder(NewLook.field, lineWidth: 1)
                        }
                    }
                    .shadow(color: state == .current ? NewLook.blue.opacity(0.3) : .clear, radius: 6, y: 4)
            }
            .overlay(alignment: .topTrailing) {
                if flagged {
                    Image(systemName: "flag.fill")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(state == .current ? NewLook.orangeRing : NewLook.orange)
                        .padding(7)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private func legend(_ label: String, fill: Color, ring: Color?) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(fill)
                .overlay {
                    if let ring {
                        RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(ring, lineWidth: 1)
                    }
                }
                .frame(width: 14, height: 14)
            Text(label).appFont(13, weight: .semibold).foregroundStyle(NewLook.ink4)
        }
    }
}

/// One answer choice, in the site's shape and the kit's `.opt`: a lettered disc, the text, and
/// a cross-out button beside it.
///
/// The disc is not decoration. Students are drilled on "the answer is B", and a list
/// without visible letters forces them to count rows before they can even hold the thought.
/// Picked is the blue ring and the filled letter — the only state while answering.
struct AssessmentChoiceRow: View {
    let choice: AssessmentChoice
    let imageURL: String?
    let isSelected: Bool
    var isEliminated = false
    var scale: Double = 1.0
    let onTap: @MainActor () -> Void
    var onEliminate: (@MainActor () -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 4) {
            Button(action: onTap) {
                HStack(alignment: .center, spacing: 12) {
                    NewLookOptionMark(letter: choice.id, state: isSelected ? .picked : .idle, scale: scale)

                    VStack(alignment: .leading, spacing: 8) {
                        // Not struck through in the text: toggling that re-rendered a rich
                        // option's web view. The line is drawn over the option instead (below).
                        RichText(text: choice.text, scale: scale)
                        if let imageURL, !imageURL.isEmpty, let url = URL(string: imageURL) {
                            AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { EmptyView() }
                                .frame(maxHeight: 220)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                .newLookOptionSurface(isSelected ? .picked : .idle)
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
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(isEliminated ? NewLook.ink4 : NewLook.chevron)
                        .frame(minWidth: 40, maxWidth: 40, minHeight: 56)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isEliminated ? "Bring back option \(choice.id)" : "Cross out option \(choice.id)")
            }
        }
        .opacity(isEliminated ? 0.5 : 1)
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
            .stroke(NewLook.ink4, style: StrokeStyle(lineWidth: 2, lineCap: .round))
            .opacity(isEliminated ? 1 : 0)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// "Hand this in?" (mockup 32): the alert's words, the runner's own three counts, and the same
/// two answers. Nothing is graded here.
private struct HandInWindow: View {
    let summary: HandInSummary
    let onKeepWorking: @MainActor () -> Void
    let onHandIn: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                NewLookTile(systemName: "checkmark.rectangle.stack.fill")
                VStack(alignment: .leading, spacing: 1) {
                    Text("Hand this in?")
                        .appDisplayFont(22)
                        .tracking(-0.4)
                        .foregroundStyle(NewLook.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(summary.message)
                        .appFont(14, weight: .medium)
                        .foregroundStyle(NewLook.ink4)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }

            HStack(spacing: 8) {
                NewLookCountBox(value: ScoreText.string(summary.answered), label: "Answered")
                NewLookCountBox(value: ScoreText.string(summary.blank), label: "Blank")
                NewLookCountBox(value: ScoreText.string(summary.flagged), label: "Flagged")
            }

            if let reassurance = summary.reassurance {
                Text(reassurance)
                    .appFont(13.5, weight: .medium)
                    .foregroundStyle(NewLook.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            AdaptiveStack(spacing: 10, columnSpacing: 10) {
                Button("Keep working") { onKeepWorking() }
                    .buttonStyle(NewLookButtonStyle(kind: .tint, size: .block))
                Button("Hand in") { onHandIn() }
                    .buttonStyle(NewLookButtonStyle(size: .block))
            }
        }
    }
}

/// "Handed in": the runner crossfades into this. Nothing is graded on it, and no XP is printed —
/// the app's celebration flies XP only if the server's really went up.
struct AssessmentSubmittedView: View {
    var setTitle: String?
    var subject: String?
    let onClose: @MainActor () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Circle()
                .fill(NewLook.green50)
                .frame(width: 104, height: 104)
                .overlay {
                    Circle()
                        .fill(NewLook.green)
                        .overlay(Circle().strokeBorder(Color(RGB(hex: 0x5CC58C)), lineWidth: 3))
                        .frame(width: 72, height: 72)
                        .shadow(color: NewLook.green.opacity(0.3), radius: 8, y: 6)
                        .overlay {
                            Image(systemName: "checkmark")
                                .font(.system(size: 32, weight: .heavy))
                                .foregroundStyle(.white)
                        }
                }
                .padding(.bottom, 6)
                .accessibilityHidden(true)
            Text("Handed in")
                .appDisplayFont(30)
                .tracking(-0.6)
                .foregroundStyle(NewLook.ink)
                .accessibilityAddTraits(.isHeader)
            Text("Your teacher will see it. Marking may take a little while.")
                .appFont(16, weight: .medium)
                .foregroundStyle(NewLook.ink4)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            if let setTitle = setTitle?.nilIfBlank {
                HStack(spacing: 12) {
                    NewLookTile(
                        systemName: AssessmentRunnerView.subjectGlyph(subject ?? ""),
                        tone: AssessmentRunnerView.subjectTone(subject ?? "")
                    )
                    VStack(alignment: .leading, spacing: 2) {
                        Text(setTitle)
                            .appFont(16, weight: .bold)
                            .foregroundStyle(NewLook.ink)
                            .lineLimit(2)
                        if let subject = subject?.nilIfBlank {
                            Text(subject.humanisedSubject)
                                .appFont(14, weight: .medium)
                                .foregroundStyle(NewLook.ink4)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(NewLook.green)
                        .accessibilityHidden(true)
                }
                .newLookCard()
                .padding(.top, 16)
                .accessibilityElement(children: .combine)
            }

            Button("Done") { onClose() }
                .buttonStyle(NewLookButtonStyle(size: .large))
                .padding(.top, 16)
        }
        .padding(.horizontal, 36)
        .frame(maxWidth: 520)
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
