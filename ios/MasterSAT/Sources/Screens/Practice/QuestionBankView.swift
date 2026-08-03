import SwiftUI
import MasterSATKit

/// The question bank as free practice: filter, pick a question, answer it, see why.
///
/// This is the one place in the app where a student is *meant* to see the worked solution
/// straight after answering — it is practice, not an exam — which is why it uses the
/// bank's own answer endpoint rather than an attempt.
struct QuestionBankView: View {
    @Environment(Session.self) private var session

    @State private var rows: [BankQuestionSummary] = []
    @State private var count = 0
    @State private var offset = 0
    @State private var subject = ""
    @State private var difficulty = ""
    @State private var search = ""
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var searchTask: Task<Void, Never>?

    private static let pageSize = 30

    var body: some View {
        VStack(spacing: 0) {
            filters
            content
        }
        .navigationTitle("Question bank")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load(reset: true) }
        .onChange(of: search) { _, _ in
            // Typing must not fire a request per keystroke; the same reasoning as the
            // runner's autosave debounce, at a length that feels instant to a person.
            searchTask?.cancel()
            searchTask = Task {
                try? await Task.sleep(for: .milliseconds(350))
                if Task.isCancelled { return }
                await load(reset: true)
            }
        }
    }

    private var filters: some View {
        VStack(spacing: 8) {
            Picker("Subject", selection: $subject) {
                Text("All").tag("")
                Text("English").tag("ENGLISH")
                Text("Math").tag("MATH")
            }
            .pickerStyle(.segmented)

            Picker("Difficulty", selection: $difficulty) {
                Text("Any").tag("")
                Text("Easy").tag("EASY")
                Text("Medium").tag("MEDIUM")
                Text("Hard").tag("HARD")
            }
            .pickerStyle(.segmented)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .onChange(of: subject) { _, _ in Task { await load(reset: true) } }
        .onChange(of: difficulty) { _, _ in Task { await load(reset: true) } }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && rows.isEmpty {
            Spacer(); ProgressView(); Spacer()
        } else if let loadError {
            Spacer(); RetryNotice(message: loadError) { await load(reset: true) }; Spacer()
        } else if rows.isEmpty {
            Spacer()
            ContentUnavailableView(
                "Nothing matches",
                systemImage: "magnifyingglass",
                description: Text("Try a different subject or search.")
            )
            Spacer()
        } else {
            List {
                Section {
                    ForEach(rows) { row in
                        NavigationLink {
                            BankQuestionView(questionId: row.id)
                        } label: {
                            BankRow(row: row)
                        }
                    }
                } header: {
                    Text("\(count) question\(count == 1 ? "" : "s")")
                } footer: {
                    if offset + rows.count < count {
                        Button("Load more") { Task { await loadMore() } }
                            .font(.subheadline)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $search, prompt: "Search questions")
        }
    }

    private var filterSet: PracticeAPI.BankFilters {
        PracticeAPI.BankFilters(
            subject: subject.isEmpty ? nil : subject,
            difficulty: difficulty.isEmpty ? nil : difficulty,
            search: search.isEmpty ? nil : search,
            limit: Self.pageSize,
            offset: offset
        )
    }

    @MainActor
    private func load(reset: Bool) async {
        if reset { offset = 0 }
        isLoading = rows.isEmpty || reset
        loadError = nil
        do {
            let page = try await session.practice.bankQuestions(filterSet)
            rows = reset ? page.results : rows + page.results
            count = page.count
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor
    private func loadMore() async {
        offset += Self.pageSize
        await load(reset: false)
    }
}

struct BankRow: View {
    let row: BankQuestionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(row.questionText.strippedHTML)
                .font(.subheadline)
                .lineLimit(3)
            HStack(spacing: 6) {
                if !row.subject.isEmpty {
                    Text(row.subject.humanisedSubject).font(.caption2).foregroundStyle(.secondary)
                }
                if let skill = row.skillName, !skill.isEmpty {
                    Text("· \(skill)").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                if !row.difficulty.isEmpty {
                    Text("· \(row.difficulty.capitalized)").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// One bank question, answered.
struct BankQuestionView: View {
    let questionId: Int

    @Environment(Session.self) private var session
    @State private var question: BankQuestionDetail?
    @State private var choice: String?
    @State private var typed = ""
    @State private var result: BankAnswerResult?
    @State private var isChecking = false
    @State private var loadError: String?

    var body: some View {
        Group {
            if let question {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let passage = question.passageText, !passage.isEmpty {
                            RichText(html: passage)
                        }
                        RichText(html: question.questionText)
                        if let prompt = question.questionPrompt, !prompt.isEmpty {
                            RichText(html: prompt)
                        }

                        if question.isGridIn {
                            TextField("Your answer", text: $typed)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.numbersAndPunctuation)
                                .disabled(result != nil)
                        } else {
                            ForEach(question.choices) { option in
                                BankChoiceRow(
                                    option: option,
                                    isSelected: choice == option.id,
                                    verdict: verdict(for: option.id)
                                ) {
                                    guard result == nil else { return }
                                    choice = option.id
                                }
                            }
                        }

                        if let result {
                            answerFeedback(result)
                        } else {
                            Button(action: check) {
                                if isChecking {
                                    ProgressView().tint(.white).frame(maxWidth: .infinity)
                                } else {
                                    Text("Check answer").bold().frame(maxWidth: .infinity)
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(Theme.accent)
                            .controlSize(.large)
                            .disabled(!canCheck)
                        }

                        if let loadError {
                            Text(loadError).font(.footnote).foregroundStyle(.red)
                        }
                    }
                    .padding(16)
                }
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Practice")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var canCheck: Bool {
        guard !isChecking else { return false }
        guard let question else { return false }
        return question.isGridIn
            ? !typed.trimmingCharacters(in: .whitespaces).isEmpty
            : choice != nil
    }

    private func verdict(for optionId: String) -> Bool? {
        guard let result else { return nil }
        if result.correctAnswer.displayText == optionId { return true }
        if choice == optionId { return false }
        return nil
    }

    @ViewBuilder
    private func answerFeedback(_ result: BankAnswerResult) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(
                result.isCorrect ? "Correct" : "Not quite — the answer is \(result.correctAnswer.displayText)",
                systemImage: result.isCorrect ? "checkmark.circle.fill" : "info.circle.fill"
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(result.isCorrect ? .green : Theme.accent)

            if let explanation = result.explanation, !explanation.isEmpty {
                RichText(html: explanation)
            }
        }
        .cardStyle()
    }

    @MainActor
    private func check() {
        isChecking = true
        loadError = nil
        Task {
            defer { isChecking = false }
            let answer = question?.isGridIn == true
                ? typed.trimmingCharacters(in: .whitespaces)
                : (choice ?? "")
            do {
                result = try await session.practice.answerBankQuestion(id: questionId, answer: answer)
            } catch let error as APIError {
                loadError = error.errorDescription
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    @MainActor
    private func load() async {
        loadError = nil
        do {
            question = try await session.practice.bankQuestion(id: questionId)
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct BankChoiceRow: View {
    let option: BankChoice
    let isSelected: Bool
    /// True correct, false wrong, nil not judged yet.
    let verdict: Bool?
    let onTap: @MainActor () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 12) {
                Text(option.id)
                    .font(.subheadline.bold())
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(circleFill))
                    .foregroundStyle(isSelected || verdict == true ? .white : Color.primary)
                RichText(html: option.text)
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(borderColor, lineWidth: isSelected || verdict != nil ? 2 : 1)
            )
            // A button's label is only hit-testable where it draws, so without this only
            // the glyphs themselves respond to a tap.
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var circleFill: Color {
        if verdict == true { return .green }
        if verdict == false { return Theme.flagged }
        return isSelected ? Theme.accent : Color(.tertiarySystemFill)
    }

    private var borderColor: Color {
        if verdict == true { return .green }
        if verdict == false { return Theme.flagged }
        return isSelected ? Theme.accent : Color(.separator)
    }
}

extension String {
    /// A one-line preview of authored HTML.
    ///
    /// List rows cannot afford a web view each, and a row that shows `<p>` tags looks
    /// broken — so tags come out and entities are decoded for the preview only. The full
    /// question is still rendered properly when it is opened.
    var strippedHTML: String {
        let withoutTags = replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        return withoutTags
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
