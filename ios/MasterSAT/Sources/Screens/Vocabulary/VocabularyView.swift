import SwiftUI
import MasterSATKit

/// The words tab — the site's `/vocabulary` hub.
///
/// Gradient hero carrying real totals, then three tabs: the published bank, the student's
/// own sets, and what a teacher assigned. The counts live on the tab bar for the reason the
/// site puts them there: a student must be able to see there is homework waiting without
/// opening the tab to find out.
struct VocabularyView: View {
    enum Tab: Hashable { case bank, mine, homework }

    @Environment(Session.self) private var session
    @State private var sections: [VocabSection] = []
    @State private var mySets: [VocabMySet] = []
    @State private var groups: [VocabHomeworkGroup] = []
    @State private var loadError: String?
    @State private var isLoading = true
    @State private var tab: Tab = .bank
    @State private var isBuilding = false

    private var totals: (words: Int, sets: Int, mastered: Int, learning: Int) {
        sections.reduce(into: (0, 0, 0, 0)) { acc, section in
            acc.0 += section.wordCount
            acc.1 += section.setCount
            acc.2 += section.progress.mastered
            acc.3 += section.progress.learning
        }
    }

    /// Sets a teacher set that are still outstanding — the number worth badging.
    private var outstanding: Int {
        groups.reduce(0) { $0 + $1.sets.filter { !$0.completed }.count }
    }

    private var tabs: [PillTabs<Tab>.Item] {
        [
            .init(tab: .bank, title: "Word bank", icon: "books.vertical", count: sections.count),
            .init(tab: .mine, title: "My sets", icon: "bookmark", count: mySets.count),
            .init(
                tab: .homework,
                title: "Homework",
                icon: "graduationcap",
                count: outstanding > 0 ? outstanding : nil,
                highlighted: outstanding > 0
            ),
        ]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HeroHeader(
                        eyebrow: "Vocabulary",
                        eyebrowIcon: "sparkles",
                        title: "Build your word bank",
                        blurb: "Four ways to study every set — flashcards, matching, speed and a full test. Any one of them counts as done.",
                        tiles: [
                            HeroTile("Words", icon: "textformat", value: isLoading ? nil : totals.words),
                            HeroTile("Mastered", icon: "checkmark.circle", value: isLoading ? nil : totals.mastered),
                            HeroTile("Learning", icon: "chart.line.uptrend.xyaxis", value: isLoading ? nil : totals.learning),
                            HeroTile("Sets", icon: "square.stack", value: isLoading ? nil : totals.sets),
                        ]
                    ) {
                        Button { isBuilding = true } label: {
                            Image(systemName: "plus")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(Theme.accent)
                                .frame(width: 36, height: 36)
                                .background(Circle().fill(.white))
                        }
                        .buttonStyle(.plain)
                    }

                    PillTabs(items: tabs, selection: $tab)

                    if isLoading && sections.isEmpty {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 50)
                    } else if let loadError {
                        RetryNotice(message: loadError) { await load() }
                    } else {
                        switch tab {
                        case .bank: bankTab
                        case .mine: mineTab
                        case .homework: homeworkTab
                        }
                    }
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Words")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: VocabSetSummary.self) { set in
                VocabSetView(setId: set.id, title: set.title)
            }
            .refreshable { await load() }
            .onAppear { Task { await load() } }
            .sheet(isPresented: $isBuilding) {
                CustomSetBuilderView { isBuilding = false; Task { await load() } }
            }
        }
    }

    // MARK: - Tabs

    @ViewBuilder
    private var bankTab: some View {
        if sections.isEmpty {
            DashedEmpty(title: "The bank is empty", hint: "Word sections appear here once they are published.")
        } else {
            ForEach(sections) { section in
                NavigationLink {
                    VocabSectionView(sectionId: section.id, title: section.title)
                } label: {
                    VocabSectionCard(section: section)
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private var mineTab: some View {
        if mySets.isEmpty {
            VStack(spacing: 14) {
                DashedEmpty(title: "No sets of your own yet", hint: "Build one from words you want to work on.")
                Button("Build a set") { isBuilding = true }
                    .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            }
        } else {
            ForEach(mySets) { set in
                NavigationLink {
                    VocabSetView(setId: set.id, title: set.title)
                } label: {
                    VocabMySetCard(set: set)
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button("Delete", role: .destructive) { Task { await delete(set) } }
                }
            }
        }
    }

    @ViewBuilder
    private var homeworkTab: some View {
        if groups.isEmpty {
            DashedEmpty(
                title: "Nothing assigned yet",
                hint: "Vocabulary your teacher sets appears here — the bank is open to you meanwhile."
            )
        } else {
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        Overline(group.assignmentTitle)
                        Spacer(minLength: 0)
                        if let due = DueLabel.text(group.dueAt) {
                            Chip(text: due.text, icon: "calendar", tone: due.late ? .danger : .neutral)
                        }
                    }
                    ForEach(group.sets) { set in
                        NavigationLink(value: set) { VocabSetRow(set: set) }
                            .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Loading

    @MainActor
    private func delete(_ set: VocabMySet) async {
        do {
            try await session.student.deleteVocabularySet(id: set.id)
            mySets.removeAll { $0.id == set.id }
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }

    @MainActor
    private func load() async {
        isLoading = sections.isEmpty && groups.isEmpty
        loadError = nil
        let student = session.student
        async let bank = student.vocabularySections()
        async let mine = student.myVocabularySets()
        async let assigned = student.vocabularyHomework()
        do {
            sections = try await bank
            groups = try await assigned
            // A student with no sets of their own is the common case, and a failure here
            // must not blank the bank they came for.
            mySets = (try? await mine) ?? []
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - Cards

/// A bank section: name, what is in it, and how much of it is stuck.
struct VocabSectionCard: View {
    let section: VocabSection

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                IconTile(systemName: "books.vertical.fill", tone: Theme.accent, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(section.title)
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                    Text("\(ScoreText.string(section.setCount)) sets · \(ScoreText.string(section.wordCount)) words")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
            MasteryBar(progress: section.progress)
            MasteryLegend(progress: section.progress)
        }
        .cardStyle()
        .contentShape(Rectangle())
    }
}

struct VocabMySetCard: View {
    let set: VocabMySet

    var body: some View {
        HStack(spacing: 12) {
            IconTile(
                systemName: set.completed ? "checkmark.seal.fill" : "bookmark.fill",
                tone: set.completed ? Theme.success : Theme.info,
                size: 40
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(set.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                Text("\(ScoreText.string(set.wordCount)) words")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textLabel)
        }
        .cardStyle(padding: 14)
        .contentShape(Rectangle())
    }
}

/// The site's three-segment mastery bar: mastered, learning, and everything untouched.
struct MasteryBar: View {
    let progress: VocabProgress
    var height: CGFloat = 8

    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 2) {
                segment(progress.mastered, Theme.success, geometry.size.width)
                segment(progress.learning, Theme.amber, geometry.size.width)
                Rectangle().fill(Theme.surface2)
            }
        }
        .frame(height: height)
        .clipShape(Capsule())
    }

    private func segment(_ count: Int, _ colour: Color, _ width: CGFloat) -> some View {
        // Guarded: a set with no words at all would divide by zero, and SwiftUI draws a
        // NaN width as nothing at all.
        let fraction = progress.total > 0 ? CGFloat(count) / CGFloat(progress.total) : 0
        return Rectangle().fill(colour).frame(width: max(0, width * fraction))
    }
}

struct MasteryLegend: View {
    let progress: VocabProgress

    var body: some View {
        HStack(spacing: 14) {
            entry("Mastered", progress.mastered, Theme.success)
            entry("Learning", progress.learning, Theme.amber)
            entry("New", max(0, progress.total - progress.mastered - progress.learning), Theme.textLabel)
            Spacer(minLength: 0)
        }
    }

    private func entry(_ label: String, _ count: Int, _ tone: Color) -> some View {
        HStack(spacing: 5) {
            Circle().fill(tone).frame(width: 7, height: 7)
            Text("\(label) \(ScoreText.string(count))")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
        }
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
        let words = "\(ScoreText.string(set.wordCount)) words"
        return section.isEmpty ? words : "\(section) · \(words)"
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: set.completed ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 20))
                .foregroundStyle(set.completed ? Theme.success : Theme.textLabel)
            VStack(alignment: .leading, spacing: 2) {
                Text(set.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                // The section is what tells two sets apart: the bank names them "Set 1",
                // "Set 2" per section, so titles collide across sections routinely and a
                // student would see the same row twice with no way to choose.
                Text(subtitle).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textLabel)
        }
        .cardStyle(padding: 14)
        .contentShape(Rectangle())
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
                    VStack(alignment: .leading, spacing: 18) {
                        HeroHeader(
                            eyebrow: "Word set",
                            eyebrowIcon: "square.stack.3d.up.fill",
                            title: title,
                            tiles: [
                                HeroTile("Words", icon: "textformat", value: detail.words.count),
                                HeroTile("Mastered", icon: "checkmark.circle", value: mastered),
                            ]
                        )

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
                            Overline("\(ScoreText.string(detail.words.count)) words")
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
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 0) {
                pill("Mastered", mastered, Theme.success)
                pill("Learning", learning, Theme.amber)
                pill("New", detail.words.count - mastered - learning, Theme.textSecondary)
            }
            Bar(
                fraction: detail.words.isEmpty ? 0 : Double(mastered) / Double(detail.words.count),
                tone: Theme.success,
                height: 8
            )
        }
        .cardStyle(padding: 18)
    }

    private func pill(_ label: String, _ count: Int, _ colour: Color) -> some View {
        VStack(spacing: 3) {
            Text(ScoreText.string(count))
                .font(.system(size: 26, weight: .heavy).monospacedDigit())
                .tracking(-0.7)
                .foregroundStyle(colour)
            Text(label).font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.textSecondary)
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

/// A study-mode launcher. The site gives each mode its own accent on purpose — four
/// identical grey cards make the pick feel arbitrary.
struct ModeCard: View {
    let mode: StudyMode
    let isEnabled: Bool
    let onTap: @MainActor () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 14) {
                    IconTile(systemName: mode.icon, tone: mode.tone, size: 46)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(mode.title).font(.system(size: 16, weight: .heavy)).foregroundStyle(.primary)
                        Text(isEnabled
                             ? mode.subtitle
                             // Named as a fact about the set, not a refusal.
                             : "Needs at least \(ScoreText.string(mode.minimumWords)) words.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(mode.tone)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card)
            // The accent edge is the only thing that tells the four apart at a glance.
            .overlay(alignment: .top) {
                LinearGradient(
                    colors: [mode.tone.opacity(0.7), mode.tone.opacity(0.25), .clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .frame(height: 4)
                .allowsHitTesting(false)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
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
        case .learning: return Theme.amber
        case .new: return Theme.textLabel
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(statusColour).frame(width: 8, height: 8).padding(.top, 7)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(word.word).font(.system(size: 15, weight: .heavy))
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
