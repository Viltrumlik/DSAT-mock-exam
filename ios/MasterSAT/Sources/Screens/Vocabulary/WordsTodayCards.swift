import SwiftUI
import MasterSATKit

/// "Review today": the bank's words still to master, and the one set Start opens.
///
/// There is no spaced repetition on the server, so nothing here says "due": the number is the
/// words not yet mastered, and Start opens the most useful set (`VocabReview`). All caught up and
/// nothing yet are states to show, not failures; a failure says so and offers Try again.
///
/// The words-still-to-master count and the next set are two facts. A set is mastered only once
/// all four games are played clean, so every word can be mastered while a homework set still has
/// games to go: the copy keys off `next`, never off the count alone.
struct ReviewTodayCard: View {
    enum State: Equatable {
        case loading
        case failed
        case ready(VocabReview)
    }

    let state: State
    /// Start is reading a section to pick its set.
    let starting: Bool
    /// A quiet line under Start: the section opened, but had no set to open.
    var note: String?
    let onStart: () -> Void
    let retry: @MainActor () async -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                IconTile(systemName: "character.book.closed.fill", tone: Theme.amber, size: 40)
                    .accessibilityHidden(true)
                Overline("Review today")
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
            }
            content
        }
        .cardStyle(padding: 18)
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .loading:
            VStack(alignment: .leading, spacing: 10) {
                Text(verbatim: "000 words still to master")
                    .font(.system(size: 22, weight: .heavy, design: .rounded))
                    .redacted(reason: .placeholder)
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(Theme.surface2)
                    .frame(height: 64)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Loading today's review")
        case .failed:
            VocabErrorNotice(
                title: "Today's review couldn't load",
                message: "Your words and progress are safe — this card just couldn't work out what's next.",
                retry: retry
            )
        case .ready(let review):
            ready(review)
        }
    }

    @ViewBuilder private func ready(_ review: VocabReview) -> some View {
        switch review.next {
        case .homework(let set):
            if review.wordsToMaster > 0 {
                count(review)
            } else if review.wordsMastered > 0 {
                // Every word is mastered, yet this set is not: its games are what is left.
                // With nothing mastered at all that would be untrue, so only Next up speaks.
                headline(
                    "Every word is mastered",
                    detail: "Your homework just has games to go."
                )
            }
            nextUp(title: set.title, detail: homeworkDetail(set))
            startButton(for: set.title)
            noteLine
        case .section(_, let title, let left):
            count(review)
            nextUp(
                title: title,
                detail: "\(ScoreText.string(left)) \(left == 1 ? "word" : "words") still to master here — Start opens the set with the most."
            )
            startButton(for: title)
            noteLine
        case .caughtUp:
            // The Words page's one piece of art: this and "nothing yet" never show together, and
            // its other empty slots are the compact form.
            EmptyState(
                art: .allDone,
                title: "All caught up",
                message: "Every word is mastered. Play any set to keep them fresh."
            )
        case .nothingYet:
            // A brand-new account, or one whose only word homework is a set with no words yet.
            EmptyState(
                art: .noWords,
                title: "No words to review yet",
                message: "Once a word list is published, or a teacher sets word homework with words in it, it lands here."
            )
        }
    }

    private func headline(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 20, weight: .heavy, design: .rounded))
            Text(detail)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func count(_ review: VocabReview) -> some View {
        if review.wordsToMaster > 0 {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(ScoreText.string(review.wordsToMaster))
                        .font(.system(size: 34, weight: .black, design: .rounded))
                        .contentTransition(reduceMotion ? .identity : .numericText(value: Double(review.wordsToMaster)))
                    Text(review.wordsToMaster == 1 ? "word still to master" : "words still to master")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                }
                if review.wordsMastered > 0 {
                    Text(verbatim: "\(ScoreText.string(review.wordsMastered)) mastered so far")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textLabel)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func nextUp(title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Overline("Next up")
            Text(title)
                .font(.system(size: 16, weight: .heavy))
                .lineLimit(2)
            Text(detail)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.amberSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func homeworkDetail(_ set: VocabReview.HomeworkSet) -> String {
        let games = "\(set.gamesLeft) \(set.gamesLeft == 1 ? "game" : "games") to go"
        return [set.assignmentTitle, DueLabel.text(set.dueAt)?.text, games]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private func startButton(for title: String) -> some View {
        Button(action: onStart) {
            HStack(spacing: 8) {
                if starting {
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: "play.fill").font(.system(size: 13, weight: .bold))
                }
                Text(starting ? "Opening…" : "Start")
            }
        }
        .buttonStyle(PrimaryButtonStyle(fullWidth: true))
        .disabled(starting)
        // "Start" alone says nothing about what it starts.
        .accessibilityLabel(starting ? "Opening \(title)" : "Start \(title)")
    }

    @ViewBuilder private var noteLine: some View {
        if let note {
            Text(note)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// The bank search on the tab — a field, not the navigation bar's: a tab root hides its bar.
struct WordSearchField: View {
    @Binding var query: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.textSecondary)
                .accessibilityHidden(true)
            TextField("Search words or definitions", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.textLabel)
                        // A 44-pt target, flush with the field's trailing edge.
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .font(.system(size: 15, weight: .medium))
        .padding(.leading, 14)
        .padding(.trailing, query.isEmpty ? 14 : 0)
        .frame(minHeight: 44)
        .background(Theme.card, in: Capsule())
    }
}

/// One search result: the word, and the section it comes from — the same word is a separate
/// row in every section that teaches it, and they would otherwise look identical.
struct VocabSearchRow: View {
    let word: VocabWord

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let section = word.sectionTitle, !section.isEmpty {
                Overline("From \(section)")
            }
            VocabWordRow(word: word)
        }
    }
}
