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
    /// A question is arriving: until its turn (`Motion.focus`) is over, a tap lands on nothing —
    /// the finger that answered the last question is still on its way down, and must not answer
    /// this one.
    @State private var turning = false
    /// The last answer's outcome, held for one `focusTap` beat so its tick is felt before the end
    /// screen replaces this view.
    @State private var closing: StudyOutcome?
    @FocusState private var spellingFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The spelling field's UIKit side, filled in by `PlainTyping` once it finds the field.
    @State private var field = SpellingField()

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
                // A ZStack, so the question leaving and the next one overlap for their 200 ms
                // instead of stacking.
                ZStack {
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
                        .transition(.focusTurn(.forward, reduceMotion: reduceMotion))
                    }
                }
                .allowsHitTesting(!turning)
            }
            // One tick per answer, the same for every answer: nothing is graded until the end.
            .sensoryFeedback(.selection, trigger: answers.count)
        }
        .task {
            if questions.isEmpty {
                questions = VocabGames.buildTestQuestions(for: set.words, pool: set.words)
            }
        }
        // The turn is over once the new question is in: a new `index` restarts the wait, and
        // leaving the screen cancels it. `turning` is raised where the answer is written, so there
        // is no frame between the answer and the block.
        .task(id: index) {
            guard turning else { return }
            try? await Task.sleep(for: .seconds(Motion.focusTurnSeconds))
            if !Task.isCancelled { turning = false }
        }
        // Handing the outcome over a beat late keeps the last tick: the view that plays it is the
        // one the end screen replaces. Leaving inside that beat cuts the wait short but still
        // hands it over — the test is finished, and handing it over is what grades the run.
        .task(id: closing != nil) {
            guard let outcome = closing else { return }
            try? await Task.sleep(for: .seconds(Motion.focusTapSeconds))
            onFinish(outcome)
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
                    .buttonStyle(FocusPress())
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
        .buttonStyle(FocusPress())
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
                // Letter tiles: the given letter is filled, the blanks are dashed wells that
                // take the typed letters as they come, punctuation is bare structure rather
                // than something to guess. A typed letter looks the same right or wrong: the
                // well is built from what was typed and the shape of the word, never from a
                // comparison of the two.
                let tiles = VocabGames.spellingTiles(
                    word: question.word,
                    revealing: question.revealIndex,
                    typed: Self.entry(typed, for: question.word)
                )
                let slots = Array(question.word)
                FlowLayout(spacing: 6) {
                    ForEach(Array(tiles.enumerated()), id: \.offset) { position, tile in
                        letterTile(tile, isStructure: slots.indices.contains(position) && !slots[position].isLetter)
                    }
                }
                .animation(Motion.focusTap, value: typed)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(VocabGames.spoken(tiles))

                TextField("Type the word", text: $typed)
                    .font(.system(size: 20, weight: .bold))
                    .multilineTextAlignment(.center)
                    // The grader compares the text exactly, so the keyboard may change nothing
                    // of it: no capitals, no autocorrect, and (below) no smart quotes or dashes.
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($spellingFocused)
                    .submitLabel(.done)
                    .onSubmit { submitSpelling(question) }
                    // Never longer than the word, and no leading spaces: what the field holds is
                    // what the well shows. Not written back while the keyboard is composing (an
                    // IME's marked text): replacing it would cut the composition off. The well and
                    // the answer apply the same cap themselves, so nothing waits on this.
                    .onChange(of: typed) { _, _ in
                        guard !field.isComposing else { return }
                        clampTyped(to: question.word)
                    }
                    // The composition's commit is not always a change of the text: committing the
                    // letters as they stand (a hardware return, say) leaves the string as it was,
                    // so `onChange` never sees it and the tail would stay past the cap. While one
                    // is open, look again until it closes. A keystroke restarts the look; leaving
                    // the question cancels it.
                    .task(id: typed) {
                        guard field.isComposing else { return }
                        while field.isComposing {
                            try? await Task.sleep(for: .milliseconds(100))
                            if Task.isCancelled { return }
                        }
                        clampTyped(to: question.word)
                    }
                    .background { PlainTyping(field: field) }
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
                    .disabled(Self.answer(typed, for: question.word).isEmpty)
            }
            .onAppear { spellingFocused = true }
        }
    }

    /// One slot of the well. `isStructure` is a fact about the word's shape (a space, hyphen or
    /// apostrophe sits there), known before anything is typed — so a slot keeps its size and its
    /// kind of view whatever is typed over it, and typing never reflows the row. Nothing here
    /// looks at whether a typed character is the right one.
    @ViewBuilder
    private func letterTile(_ tile: VocabGames.SpellingTile, isStructure: Bool) -> some View {
        if isStructure {
            // Bare: a faint placeholder until typed over, then what was typed — in the same slot,
            // shrunk to fit if it is a wide letter.
            glyph(tile, tone: tile.kind == .typed ? Color.primary : Theme.textLabel)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(width: 16, height: 42)
        } else {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(tile.kind == .given ? Theme.successSoft : (tile.kind == .typed ? Theme.card : Theme.background))
                .overlay {
                    switch tile.kind {
                    case .blank:
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Theme.separator, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    case .given:
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Theme.success.opacity(0.4), lineWidth: 1)
                    case .typed, .structure:
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Theme.separator, lineWidth: 1)
                    }
                }
                .overlay {
                    if !tile.character.isEmpty {
                        glyph(tile, tone: tile.kind == .given ? Theme.success : Color.primary)
                    }
                }
                .frame(width: 34, height: 42)
        }
    }

    /// The character in a slot. A new character is a new view, so it drops into its slot — a
    /// small scale-up that settles without overshoot, a plain fade under Reduce Motion.
    private func glyph(_ tile: VocabGames.SpellingTile, tone: Color) -> some View {
        Text(verbatim: tile.kind == .typed || tile.kind == .given ? tile.character.uppercased() : tile.character)
            .font(.system(size: 17, weight: .heavy))
            .foregroundStyle(tone)
            .id("\(tile.kind)-\(tile.character)")
            .transition(reduceMotion ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
    }

    /// What the student has entered, as the well shows it and the field holds it: exactly what
    /// was typed, minus leading spaces (the grader trims them), and never longer than the word.
    /// A letter past the end of the word would not be shown, and an overflow such as "briskly"
    /// for "brisk" would leave a full-looking well that the grader refuses.
    private static func entry(_ raw: String, for word: String) -> String {
        String(raw.drop(while: \.isWhitespace).prefix(word.count))
    }

    /// The entry as it is handed in — and shown in the review as "You said": the grader trims
    /// both ends, so trailing spaces go too. Still what the student typed, character for character.
    private static func answer(_ raw: String, for word: String) -> String {
        entry(raw, for: word).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The field cut back to what the well shows, once the keyboard is no longer composing.
    @MainActor
    private func clampTyped(to word: String) {
        let entry = Self.entry(typed, for: word)
        if entry != typed { typed = entry }
    }

    // MARK: - Answering

    private static let letters = ["A", "B", "C", "D"]

    @MainActor
    private func submitSpelling(_ question: VocabGames.TestQuestion) {
        let given = Self.answer(typed, for: question.word)
        guard !given.isEmpty else { return }
        submit(
            question: question,
            given: given,
            expected: question.word,
            correct: VocabGames.spellingIsCorrect(
                VocabGames.foldTypography(given), VocabGames.foldTypography(question.word)
            )
        )
    }

    @MainActor
    private func submit(question: VocabGames.TestQuestion, given: String, expected: String, correct: Bool) {
        // A question is answered once. The one leaving lingers for its 100 ms fade, and a second
        // tap on it (or on Submit and Return together) must not append a duplicate, tell the server
        // twice, or skip the next question.
        guard !answers.contains(where: { $0.id == question.id }) else { return }
        answers.append(TestAnswer(id: question.id, word: question.word, definition: question.definition,
                                  given: given, expected: expected, correct: correct))
        typed = ""
        // The student sees nothing until the end, but the server hears every answer as it
        // lands — an abandoned test still records what was answered.
        runner.record(wordId: question.wordId, correct: correct)

        if index + 1 < questions.count {
            turning = true
            withAnimation(Motion.focus) { index += 1 }
            return
        }

        let right = answers.filter(\.correct).count
        let wrong = answers.filter { !$0.correct }
        closing = StudyOutcome(
            title: wrong.isEmpty ? "Perfect test" : "Test complete",
            description: wrong.isEmpty
                ? "All \(ScoreText.string(answers.count)) questions right."
                : "\(ScoreText.string(wrong.count)) to look at again — they're listed below.",
            stats: [
                ModeStat(label: "Correct", value: "\(ScoreText.string(right))/\(ScoreText.string(answers.count))", tone: .success),
                .accuracy(VocabGames.accuracyPercent(correct: right, of: answers.count)),
                // "To review", not "Missed": the count is the next thing to do, not a verdict.
                ModeStat(label: "To review", value: ScoreText.string(wrong.count), tone: wrong.isEmpty ? .neutral : .danger),
            ],
            restartLabel: "Take it again",
            extra: AnyView(TestReview(wrong: wrong))
        )
    }
}

/// Switches the keyboard's text substitutions off on the field it sits behind.
///
/// The spelling question is graded on the exact text, and SwiftUI has no modifier for smart
/// punctuation: left on, the keyboard turns a typed ' into ’ and -- into —, and the grader
/// would refuse them. This looks for the `UITextField` beside it and sets its traits (smart
/// quotes, dashes and inserts, autocorrect, spell check, capitals) directly. If the field is
/// not found, nothing changes — grading folds typographic quotes and dashes on both sides
/// (`VocabGames.foldTypography`), so a curly one is never refused either way.
private struct PlainTyping: UIViewRepresentable {
    let field: SpellingField

    func makeUIView(context: Context) -> PlainTypingProbe { PlainTypingProbe(field: field) }
    func updateUIView(_ probe: PlainTypingProbe, context: Context) {}
}

/// The spelling field's UIKit side, shared between the view and the probe that finds it.
@MainActor
private final class SpellingField {
    weak var textField: UITextField?

    /// True while the keyboard holds marked text (a Japanese or Chinese IME composing, say).
    /// False when the field was never found — then there is nothing to wait for.
    var isComposing: Bool { textField?.markedTextRange != nil }
}

private final class PlainTypingProbe: UIView {
    private let field: SpellingField
    /// The lookup's cache. The probe lays out on every keystroke (the text moves the field's
    /// layout), so while this field is held and on screen, all `apply` costs is that check. Its
    /// own, not `field`'s: a question leaving still has its field on screen for a beat, and the
    /// next question's probe must not take that one for its own.
    private weak var found: UITextField?
    /// Passes spent looking since the last find, so a field that never turns up is not searched
    /// for on every layout. Starts afresh when a field is found, so a replaced one gets its turn.
    private var attempts = 0

    init(field: SpellingField) {
        self.field = field
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        accessibilityElementsHidden = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // The text field is laid out beside this view in the same pass (and may be built a beat
    // later), so try whenever this view moves or lays out until it is found.
    override func didMoveToWindow() {
        super.didMoveToWindow()
        apply()
        Task { @MainActor [weak self] in self?.apply() }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        apply()
    }

    private func apply() {
        // SwiftUI may swap the UIKit view under a `TextField`; a swapped-out one has left its
        // window, and the traits must go on the new one.
        guard found?.window == nil, attempts < 30, window != nil else { return }
        attempts += 1
        guard let textField = nearbyTextField() else { return }
        attempts = 0
        // Set only what differs, so a field found again is not asked to reload its keyboard.
        var changed = false
        func set<T: Equatable>(_ keyPath: ReferenceWritableKeyPath<UITextField, T>, to value: T) {
            if textField[keyPath: keyPath] != value { textField[keyPath: keyPath] = value; changed = true }
        }
        set(\.autocorrectionType, to: .no)
        set(\.spellCheckingType, to: .no)
        set(\.autocapitalizationType, to: .none)
        set(\.smartQuotesType, to: .no)
        set(\.smartDashesType, to: .no)
        set(\.smartInsertDeleteType, to: .no)
        // A keyboard that is already up keeps the traits it was shown with until reloaded.
        if changed, textField.isFirstResponder { textField.reloadInputViews() }
        found = textField
        field.textField = textField
    }

    /// The text field this view is the background of: the one sharing its frame, found by
    /// climbing a few levels of the hosting hierarchy.
    private func nearbyTextField() -> UITextField? {
        var ancestor = superview
        for _ in 0..<6 {
            guard let current = ancestor else { return nil }
            if let field = Self.firstTextField(in: current, overlapping: self) { return field }
            ancestor = current.superview
        }
        return nil
    }

    /// The first text field under `view` that overlaps `probe`, stopping at it — no arrays built
    /// for the whole hierarchy.
    private static func firstTextField(in view: UIView, overlapping probe: UIView) -> UITextField? {
        if let field = view as? UITextField, probe.convert(field.bounds, from: field).intersects(probe.bounds) {
            return field
        }
        for subview in view.subviews {
            if let found = firstTextField(in: subview, overlapping: probe) { return found }
        }
        return nil
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
