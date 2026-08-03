import SwiftUI
import MasterSATKit

/// The words tab: what was assigned, the whole bank, and the student's own lists.
struct VocabularyView: View {
    @Environment(Session.self) private var session
    @State private var groups: [VocabHomeworkGroup] = []
    @State private var loadError: String?
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 12) {
                        NavigationLink { VocabBrowseView() } label: {
                            VocabShortcut(title: "Word bank", icon: "books.vertical.fill", tone: Theme.accent)
                        }
                        .buttonStyle(.plain)
                        NavigationLink { MySetsView() } label: {
                            VocabShortcut(title: "My sets", icon: "folder.fill.badge.person.crop", tone: Theme.info)
                        }
                        .buttonStyle(.plain)
                    }

                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                    } else if let loadError {
                        RetryNotice(message: loadError) { await load() }
                    } else if groups.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "character.book.closed")
                                .font(.system(size: 30))
                                .foregroundStyle(Theme.textLabel)
                            Text("Nothing assigned yet").font(.system(size: 16, weight: .bold))
                            Text("Vocabulary your teacher sets will appear here — the word bank above is open to you meanwhile.")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                        .cardStyle()
                    } else {
                        ForEach(groups) { group in
                            VStack(alignment: .leading, spacing: 10) {
                                Overline(group.assignmentTitle)
                                if let due = group.dueAt, let date = JSONCoding.parseServerDate(due) {
                                    Text("Due \(date.formatted(date: .abbreviated, time: .shortened))")
                                        .font(.system(size: 12))
                                        .foregroundStyle(Theme.textSecondary)
                                }
                                ForEach(group.sets) { set in
                                    NavigationLink(value: set) {
                                        VocabSetRow(set: set)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Words")
            .navigationDestination(for: VocabSetSummary.self) { set in
                VocabSetView(setId: set.id, title: set.title)
            }
            .refreshable { await load() }
            .onAppear { Task { await load() } }
        }
    }

    @MainActor
    private func load() async {
        isLoading = groups.isEmpty
        loadError = nil
        do {
            groups = try await session.student.vocabularyHomework()
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

struct VocabShortcut: View {
    let title: String
    let icon: String
    let tone: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(tone)
            Text(title).font(.system(size: 15, weight: .bold)).foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(tone.opacity(0.10))
        )
    }
}

extension VocabSetSummary: @retroactive Hashable {
    public static func == (lhs: VocabSetSummary, rhs: VocabSetSummary) -> Bool { lhs.id == rhs.id }
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct VocabSetRow: View {
    let set: VocabSetSummary

    private var subtitle: String {
        let section = set.sectionTitle ?? ""
        let words = "\(set.wordCount) words"
        return section.isEmpty ? words : "\(section) · \(words)"
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: set.completed ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 20))
                .foregroundStyle(set.completed ? Theme.success : Theme.textLabel)
            VStack(alignment: .leading, spacing: 2) {
                Text(set.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                // The section is what tells two sets apart: the bank names them "Set 1",
                // "Set 2" per section, so titles collide across sections routinely and a
                // student would see the same row twice with no way to choose.
                Text(subtitle).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textLabel)
        }
        .cardStyle(padding: 14)
    }
}

/// One set: what is in it, how far along the student is, and how to study it.
struct VocabSetView: View {
    let setId: Int
    let title: String

    @Environment(Session.self) private var session
    @State private var detail: VocabSetDetail?
    @State private var loadError: String?
    @State private var studying: StudyMode?

    private var mastered: Int { detail?.words.filter { $0.status == .mastered }.count ?? 0 }
    private var learning: Int { detail?.words.filter { $0.status == .learning }.count ?? 0 }

    var body: some View {
        Group {
            if let detail {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        progressCard(detail)

                        VStack(alignment: .leading, spacing: 10) {
                            Overline("Study")
                            ForEach(StudyMode.allCases) { mode in
                                ModeCard(mode: mode, isEnabled: detail.words.count >= mode.minimumWords) {
                                    studying = mode
                                }
                            }
                        }

                        VStack(alignment: .leading, spacing: 10) {
                            Overline("\(detail.words.count) words")
                            ForEach(detail.words) { WordRow(word: $0) }
                        }
                    }
                    .padding(16)
                }
                .background(Theme.background)
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .fullScreenCover(item: $studying) { mode in
            if let detail {
                VocabStudyView(mode: mode, set: detail) {
                    studying = nil
                    // Progress moved; repaint from the server rather than guessing.
                    Task { await load() }
                }
            }
        }
    }

    private func progressCard(_ detail: VocabSetDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 0) {
                pill("Mastered", mastered, Theme.success)
                pill("Learning", learning, Theme.warning)
                pill("New", detail.words.count - mastered - learning, Theme.textSecondary)
            }
            Bar(
                fraction: detail.words.isEmpty ? 0 : Double(mastered) / Double(detail.words.count),
                tone: Theme.success
            )
        }
        .cardStyle()
    }

    private func pill(_ label: String, _ count: Int, _ colour: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(count)")
                .font(.system(size: 24, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundStyle(colour)
            Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
    }

    @MainActor
    private func load() async {
        loadError = nil
        do {
            detail = try await session.student.vocabularySet(id: setId)
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct ModeCard: View {
    let mode: StudyMode
    let isEnabled: Bool
    let onTap: @MainActor () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 14) {
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(mode.tone.opacity(0.12))
                    .frame(width: 44, height: 44)
                    .overlay(
                        Image(systemName: mode.icon)
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(mode.tone)
                    )
                VStack(alignment: .leading, spacing: 3) {
                    Text(mode.title).font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
                    Text(isEnabled
                         ? mode.subtitle
                         // Named as a fact about the set, not a refusal.
                         : "Needs at least \(mode.minimumWords) words.")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textLabel)
            }
            .cardStyle(padding: 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.45)
    }
}

struct WordRow: View {
    let word: VocabWord

    private var statusColour: Color {
        switch word.status {
        case .mastered: return Theme.success
        case .learning: return Theme.warning
        case .new: return Theme.textLabel
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(statusColour).frame(width: 8, height: 8).padding(.top, 7)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(word.word).font(.system(size: 15, weight: .bold))
                    if let part = word.partOfSpeech, !part.isEmpty {
                        Text(part).font(.system(size: 11).italic()).foregroundStyle(Theme.textLabel)
                    }
                }
                Text(word.definition).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .cardStyle(padding: 12)
    }
}
