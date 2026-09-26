import SwiftUI
import MasterSATKit

/// The words tab — the site's `/vocabulary` hub.
///
/// Gradient hero with real totals, then three tabs: the published bank, the student's own
/// sets, and what a teacher assigned. The counts live on the tab bar for the reason the site
/// puts them there — a student must be able to see there is homework waiting without opening
/// the tab — and the four games sit under every tab, because they are how a set from any of
/// the three is studied and they are the key to the coloured bar on every card.
///
/// Each tab loads, fails and retries on its own, as the web's do: a student whose own sets
/// would not load still has the bank they came for, and is told the sets failed rather than
/// shown "no sets".
struct VocabularyView: View {
    enum Tab: Hashable { case bank, mine, homework }

    private enum Phase: Equatable { case loading, loaded, failed }

    @Environment(Session.self) private var session
    @State private var sections: [VocabSection] = []
    @State private var mySets: [VocabMySet] = []
    @State private var groups: [VocabHomeworkGroup] = []
    @State private var sectionsPhase: Phase = .loading
    @State private var mySetsPhase: Phase = .loading
    @State private var homeworkPhase: Phase = .loading
    @State private var tab: Tab = .bank
    @State private var isBuilding = false
    @State private var pendingDelete: VocabMySet?
    @State private var isDeleting = false
    @State private var deleteError: String?

    private var totals: VocabHubTotals { VocabHubTotals(sections: sections) }
    private var heroReady: Bool { sectionsPhase == .loaded }

    /// Sets owed on homework: not yet MASTERED, not merely not started. Zero is not shown.
    private var outstanding: Int { VocabHomeworkGroup.outstanding(in: groups) }

    private var tabs: [PillTabs<Tab>.Item] {
        [
            .init(tab: .bank, title: "Question Bank", icon: "books.vertical",
                  count: sectionsPhase == .loaded ? sections.count : nil),
            .init(tab: .mine, title: "My Sets", icon: "bookmark",
                  count: mySetsPhase == .loaded ? mySets.count : nil),
            .init(tab: .homework, title: "Homework", icon: "graduationcap",
                  count: outstanding > 0 ? outstanding : nil,
                  highlighted: outstanding > 0),
        ]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HeroHeader(
                        eyebrow: "Vocabulary",
                        eyebrowIcon: "sparkles",
                        title: "Build your word bank",
                        blurb: "The word lists your teachers publish, the homework they set, and any set you build yourself — all studied the same four ways.",
                        tiles: [
                            HeroTile("Words", icon: "textformat", value: heroReady ? totals.words : nil),
                            HeroTile("Words mastered", icon: "checkmark.circle", value: heroReady ? totals.wordsMastered : nil),
                            HeroTile("Sets", icon: "square.stack.3d.up", value: heroReady ? totals.sets : nil),
                            HeroTile("Sets mastered", icon: "trophy", value: heroReady ? totals.setsMastered : nil),
                        ]
                    ) {
                        Button { isBuilding = true } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "plus").font(.system(size: 12, weight: .bold))
                                Text("New set").font(.system(size: 13, weight: .heavy))
                            }
                            .foregroundStyle(Theme.accent)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 8)
                            .background(Capsule().fill(.white))
                            .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }

                    PillTabs(items: tabs, selection: $tab)

                    Group {
                        switch tab {
                        case .bank: bankTab
                        case .mine: mineTab
                        case .homework: homeworkTab
                        }
                    }

                    VocabGameGuide()
                        .padding(.top, 4)
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Words")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await load() }
            .onAppear { Task { await load() } }
            .sheet(isPresented: $isBuilding) {
                CustomSetBuilderView { saved in
                    isBuilding = false
                    if saved { Task { await load() } }
                }
            }
            .alert(
                "Delete this set?",
                isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                presenting: pendingDelete
            ) { set in
                Button("Keep it", role: .cancel) { pendingDelete = nil }
                Button("Delete set", role: .destructive) { Task { await delete(set) } }
            } message: { set in
                Text(verbatim: "“\(set.title)” and its word list will be removed. Your progress on the words themselves is kept.")
            }
            .alert(
                "Couldn't delete that set",
                isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })
            ) {
                Button("OK", role: .cancel) { deleteError = nil }
            } message: {
                Text(verbatim: deleteError ?? "")
            }
        }
    }

    // MARK: - Question Bank

    @ViewBuilder
    private var bankTab: some View {
        switch sectionsPhase {
        case .loading where sections.isEmpty:
            loadingSlot
        case .failed:
            VocabErrorNotice(title: "Couldn't load your vocabulary") { await loadSections() }
        default:
            if sections.isEmpty {
                VocabEmptyState(
                    icon: "books.vertical",
                    title: "No word lists published yet",
                    message: "Your teachers publish vocabulary sections here. In the meantime you can build a set of your own.",
                    actionTitle: "Build my own set",
                    action: { isBuilding = true }
                )
            } else {
                VStack(spacing: 14) {
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
        }
    }

    // MARK: - My Sets

    @ViewBuilder
    private var mineTab: some View {
        switch mySetsPhase {
        case .loading where mySets.isEmpty:
            loadingSlot
        case .failed:
            VocabErrorNotice(title: "Couldn't load your sets") { await loadMySets() }
        default:
            if mySets.isEmpty {
                VocabEmptyState(
                    icon: "sparkles",
                    title: "Make a set of the words you keep missing",
                    message: "Pull any words from the question bank into a set of your own, then study it with all four modes.",
                    actionTitle: "New set",
                    action: { isBuilding = true }
                )
            } else {
                VStack(spacing: 14) {
                    ForEach(mySets) { set in
                        NavigationLink {
                            VocabSetView(setId: set.id, title: set.title)
                        } label: {
                            VocabSetCard(
                                title: set.title,
                                wordCount: set.wordCount,
                                completed: set.completed,
                                mastery: set.mastery,
                                subtitle: createdLabel(set.createdAt),
                                reservesTrailingControl: true
                            )
                        }
                        .buttonStyle(.plain)
                        // Laid over the link, not inside it: a button inside a link's label
                        // competes with the link for the same tap.
                        .overlay(alignment: .topTrailing) {
                            Button { pendingDelete = set } label: {
                                Image(systemName: "trash")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.textSecondary)
                                    .frame(width: 36, height: 36)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(isDeleting)
                            .accessibilityLabel("Delete \(set.title)")
                            .padding(.top, 10)
                            .padding(.trailing, 8)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Homework

    @ViewBuilder
    private var homeworkTab: some View {
        switch homeworkPhase {
        case .loading where groups.isEmpty:
            loadingSlot
        case .failed:
            VocabErrorNotice(title: "Couldn't load your homework") { await loadHomework() }
        default:
            if groups.isEmpty {
                VocabEmptyState(
                    icon: "graduationcap",
                    title: "No vocabulary homework right now",
                    message: "When a teacher assigns a word list it lands here with its due date. Until then, pick any set from the question bank."
                )
            } else {
                VStack(spacing: 18) {
                    ForEach(groups) { VocabHomeworkGroupCard(group: $0) }
                }
            }
        }
    }

    private var loadingSlot: some View {
        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 50)
    }

    private func createdLabel(_ iso: String?) -> String? {
        guard let iso, let date = JSONCoding.parseServerDate(iso) else { return nil }
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("MMMdyyyy")
        return "Created \(f.string(from: date))"
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        let student = session.student
        if sections.isEmpty { sectionsPhase = .loading }
        if mySets.isEmpty { mySetsPhase = .loading }
        if groups.isEmpty { homeworkPhase = .loading }
        async let bank = student.vocabularySections()
        async let mine = student.myVocabularySets()
        async let assigned = student.vocabularyHomework()
        do { sections = try await bank; sectionsPhase = .loaded } catch { sectionsPhase = .failed }
        do { mySets = try await mine; mySetsPhase = .loaded } catch { mySetsPhase = .failed }
        do { groups = try await assigned; homeworkPhase = .loaded } catch { homeworkPhase = .failed }
    }

    @MainActor
    private func loadSections() async {
        sectionsPhase = .loading
        do {
            sections = try await session.student.vocabularySections()
            sectionsPhase = .loaded
        } catch {
            sectionsPhase = .failed
        }
    }

    @MainActor
    private func loadMySets() async {
        mySetsPhase = .loading
        do {
            mySets = try await session.student.myVocabularySets()
            mySetsPhase = .loaded
        } catch {
            mySetsPhase = .failed
        }
    }

    @MainActor
    private func loadHomework() async {
        homeworkPhase = .loading
        do {
            groups = try await session.student.vocabularyHomework()
            homeworkPhase = .loaded
        } catch {
            homeworkPhase = .failed
        }
    }

    @MainActor
    private func delete(_ set: VocabMySet) async {
        pendingDelete = nil
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await session.student.deleteVocabularySet(id: set.id)
            mySets.removeAll { $0.id == set.id }
        } catch let error as APIError {
            deleteError = error.errorDescription
        } catch {
            deleteError = error.localizedDescription
        }
    }
}

/// One homework that carries word sets: its title, the class, the deadline, how many of its
/// sets have been started — and the sets themselves, each opened bound to THIS homework.
///
/// The binding is the point. The same set can sit under two homeworks here (two classrooms,
/// or re-assigned for revision), and the two cards then differ only by the assignment they
/// carry; without it the server binds every run to whichever is newest.
struct VocabHomeworkGroupCard: View {
    let group: VocabHomeworkGroup

    private var allDone: Bool { group.isComplete }
    private var late: Bool { DueLabel.text(group.dueAt)?.late ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                IconTile(
                    systemName: "graduationcap.fill",
                    tone: allDone ? Theme.success : Theme.accent,
                    size: 40
                )
                VStack(alignment: .leading, spacing: 8) {
                    Text(group.assignmentTitle)
                        .font(.system(size: 17, weight: .heavy))
                        .lineLimit(2)
                    FlowLayout(spacing: 6) {
                        if let name = group.classroomName, !name.isEmpty {
                            if let classroomId = group.classroomId {
                                NavigationLink {
                                    LearnMoreClassroomView(classroomId: classroomId)
                                } label: {
                                    classroomChip(name)
                                }
                                .buttonStyle(.plain)
                            } else {
                                classroomChip(name)
                            }
                        }
                        VocabDueChip(dueAt: group.dueAt)
                    }
                }
                Spacer(minLength: 0)
                // "Done" is any game finished on the set; the tab badge counts mastery.
                if allDone {
                    Chip(text: "\(ScoreText.string(group.doneCount)) / \(ScoreText.string(group.sets.count)) complete",
                         icon: "checkmark.circle.fill", tone: .success)
                } else {
                    Chip(text: "\(ScoreText.string(group.doneCount)) / \(ScoreText.string(group.sets.count)) done",
                         tone: late ? .warning : .neutral)
                }
            }

            ForEach(group.sets) { set in
                NavigationLink {
                    VocabSetView(setId: set.id, title: set.title, assignmentId: group.assignmentId)
                } label: {
                    VocabSetCard(
                        title: set.title,
                        wordCount: set.wordCount,
                        completed: set.completed,
                        mastery: set.mastery,
                        subtitle: set.sectionTitle,
                        actionLabel: "Start"
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .stroke(allDone ? Theme.success.opacity(0.4) : Theme.separator.opacity(0.5), lineWidth: allDone ? 1 : 0.5)
        )
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }

    private func classroomChip(_ name: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: "person.2.fill").font(.system(size: 10, weight: .bold))
            Text(name).font(.system(size: 12, weight: .semibold)).lineLimit(1)
        }
        .foregroundStyle(Theme.textSecondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(Theme.surface2))
    }
}
