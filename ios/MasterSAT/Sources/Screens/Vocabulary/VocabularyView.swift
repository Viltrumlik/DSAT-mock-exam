import SwiftUI
import MasterSATKit

/// Which study modes the app offers.
///
/// The platform defines four. Two of them — Matching (a drag-to-pair grid) and Speed (a
/// timed grid) — are built around a pointer and a wide screen; a phone-sized version would
/// be a different game, not the same one, so they are left to the web for now rather than
/// shipped as a worse imitation. Flashcards and Test are the learning loop: meet the word,
/// then check you have it.
enum StudyMode: String, CaseIterable, Identifiable {
    case flashcard
    case test

    var id: String { rawValue }

    var kitMode: VocabStudyMode {
        switch self {
        case .flashcard: return .flashcard
        case .test: return .test
        }
    }

    var title: String {
        switch self {
        case .flashcard: return "Flashcards"
        case .test: return "Test"
        }
    }

    var subtitle: String {
        switch self {
        case .flashcard: return "See the word, recall the meaning. Missed words come back."
        case .test: return "Pick the right definition. One pass, then a score."
        }
    }

    var icon: String {
        switch self {
        case .flashcard: return "rectangle.on.rectangle"
        case .test: return "checkmark.circle"
        }
    }
}

struct VocabularyView: View {
    @Environment(Session.self) private var session
    @State private var groups: [VocabHomeworkGroup] = []
    @State private var loadError: String?
    @State private var isLoading = true

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
            } else {
                List {
                    Section {
                        NavigationLink {
                            VocabBrowseView()
                        } label: {
                            Label("Browse the word bank", systemImage: "books.vertical")
                        }
                        NavigationLink {
                            MySetsView()
                        } label: {
                            Label("My own sets", systemImage: "folder.badge.person.crop")
                        }
                    }

                    if groups.isEmpty {
                        Section {
                            ContentUnavailableView(
                                "Nothing assigned yet",
                                systemImage: "character.book.closed",
                                description: Text("Vocabulary your teacher assigns will appear here.")
                            )
                        }
                    } else {
                        ForEach(groups) { group in
                            Section {
                                ForEach(group.sets) { set in
                                    NavigationLink(value: set) {
                                        VocabSetRow(set: set)
                                    }
                                }
                            } header: {
                                Text(group.assignmentTitle)
                            } footer: {
                                if let due = group.dueAt, let date = JSONCoding.parseServerDate(due) {
                                    Text("Due \(date.formatted(date: .abbreviated, time: .shortened))")
                                }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .navigationTitle("Vocabulary")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: VocabSetSummary.self) { set in
            VocabSetView(setId: set.id, title: set.title)
        }
        .task { await load() }
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
                .foregroundStyle(set.completed ? .green : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(set.title).font(.subheadline.weight(.medium))
                // The section is what tells two sets apart: the bank names them "Set 1",
                // "Set 2" per section, so titles collide across sections routinely and a
                // student would see the same row twice with no way to choose.
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
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
                List {
                    Section {
                        HStack(spacing: 20) {
                            progressPill("Mastered", mastered, .green)
                            progressPill("Learning", learning, .orange)
                            progressPill("New", detail.words.count - mastered - learning, .secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                    }

                    Section("Study") {
                        ForEach(StudyMode.allCases) { mode in
                            Button { studying = mode } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: mode.icon)
                                        .foregroundStyle(Theme.accent)
                                        .frame(width: 26)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(mode.title).font(.subheadline.weight(.medium))
                                        Text(mode.subtitle).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            // A test over one word is a formality, not a check.
                            .disabled(detail.words.count < (mode == .test ? 4 : 1))
                        }
                    }

                    Section("\(detail.words.count) words") {
                        ForEach(detail.words) { WordRow(word: $0) }
                    }
                }
                .listStyle(.insetGrouped)
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

    private func progressPill(_ label: String, _ count: Int, _ colour: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(count)").font(.title3.bold().monospacedDigit()).foregroundStyle(colour)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
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

struct WordRow: View {
    let word: VocabWord

    private var statusColour: Color {
        switch word.status {
        case .mastered: return .green
        case .learning: return .orange
        case .new: return .secondary
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(statusColour).frame(width: 8, height: 8).padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(word.word).font(.subheadline.weight(.semibold))
                    if let part = word.partOfSpeech, !part.isEmpty {
                        Text(part).font(.caption2.italic()).foregroundStyle(.secondary)
                    }
                }
                Text(word.definition).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
