import SwiftUI
import MasterSATKit

/// The Words tab: "Review today" — the words still to master and the one set Start opens — a
/// search of the whole bank, then the three places a set lives: word homework, the bank, and
/// the student's own sets. The four games sit under the lists, because they are how a set from
/// any of the three is studied.
///
/// Each list loads, fails and retries on its own, as the web's do. The hero needs the bank AND
/// the homework — it chooses between them — so it is built only once BOTH have loaded, and says
/// so when either has never loaded, rather than calling a student "all caught up" on half the
/// facts (or skipping owed homework because its read failed). A reload that fails keeps the last
/// good answer, on the hero and in every list.
struct VocabularyView: View {
    enum Segment: Hashable { case homework, bank, mine }

    /// Pages this root pushes. Each is a VALUE on `path` — a `NavigationLink { destination }`
    /// never enters the path, so re-tapping the tab (or a link to it) could not pop it. The
    /// title travels with the id: the page shows it while its own load is in flight.
    enum Route: Hashable {
        case section(id: Int, title: String)
        case set(id: Int, title: String, assignmentId: Int? = nil)
    }

    private enum Phase: Equatable { case loading, loaded, failed }

    /// Start opened a section and found no set in it to play: said under the button for as long
    /// as that section is still the card's next step.
    private struct StartNote: Equatable {
        let sectionId: Int
        let text: String
    }

    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// "Review today" steps aside while the search field holds text, so the results start at the
    /// top of a small phone with the keyboard up. Its own state, written in an animation as the
    /// field empties or fills, rather than an animation keyed on the whole page.
    @State private var reviewHidden = false
    @State private var sections: [VocabSection] = []
    @State private var mySets: [VocabMySet] = []
    @State private var groups: [VocabHomeworkGroup] = []
    @State private var sectionsPhase: Phase = .loading
    @State private var mySetsPhase: Phase = .loading
    @State private var homeworkPhase: Phase = .loading
    /// Loaded at least once in this view's life. A failed reload keeps the last good answer, so
    /// "known" — not the phase, not "non-empty" — is what a list and the hero stand on.
    @State private var sectionsKnown = false
    @State private var mySetsKnown = false
    @State private var homeworkKnown = false
    @State private var segment: Segment = .homework
    /// The opening segment is chosen once, from the first homework answer — never after the
    /// student has picked one.
    @State private var segmentPicked = false
    @State private var isBuilding = false
    @State private var pendingDelete: VocabMySet?
    @State private var isDeleting = false
    @State private var deleteError: String?
    @State private var startingReview = false
    @State private var startNote: StartNote?
    @State private var query = ""
    /// The latest answer from the server and the text it answers. "Searching" is never stored:
    /// it is "the field holds text that `resultsFor` does not answer yet", so nothing can be left
    /// stuck on it.
    @State private var results: [VocabWord] = []
    @State private var resultsFor: String?
    /// The text whose search failed — not "no matches".
    @State private var searchFailedFor: String?
    @State private var searchTask: Task<Void, Never>?
    @State private var shown = false

    /// Sets owed on homework: not yet MASTERED, not merely not started. Zero is not shown.
    private var outstanding: Int { VocabHomeworkGroup.outstanding(in: groups) }

    private var searchText: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var isSearching: Bool { searchText.count >= 2 }

    /// `VocabReview` cannot tell `[]` from a failed read, so it is built only from two answers
    /// that both arrived: never from a placeholder standing in for a load that failed.
    private var reviewState: ReviewTodayCard.State {
        if sectionsKnown && homeworkKnown {
            return .ready(VocabReview(sections: sections, homework: groups))
        }
        if (!sectionsKnown && sectionsPhase == .failed) || (!homeworkKnown && homeworkPhase == .failed) {
            return .failed
        }
        return .loading
    }

    private var segmentItems: [SegmentBar<Segment>.Item] {
        [
            .init(segment: .homework, title: outstanding > 0 ? "Homework · \(ScoreText.string(outstanding))" : "Homework"),
            .init(segment: .bank, title: "Word bank"),
            .init(segment: .mine, title: "My sets"),
        ]
    }

    var body: some View {
        NavigationStack(path: $path) {
            TabRootScroll(tab: .words, onRefresh: { await load() }) {
                VStack(alignment: .leading, spacing: 16) {
                    AppHeader(title: "Words").stagger(0, shown: shown)

                    if !reviewHidden {
                        reviewCard
                            .stagger(1, shown: shown)
                            .transition(.opacity)
                    }

                    WordSearchField(query: $query).stagger(2, shown: shown)

                    if isSearching {
                        searchResults
                    } else {
                        SegmentBar(items: segmentItems, selection: $segment)
                            .stagger(3, shown: shown)

                        Group {
                            switch segment {
                            case .homework: homeworkList
                            case .bank: bankList
                            case .mine: mineList
                            }
                        }
                        .stagger(4, shown: shown)

                        VocabGameGuide()
                            .padding(.top, 4)
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.background)
            .navigationTitle("Words")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .section(let id, let title): VocabSectionView(sectionId: id, title: title)
                case .set(let id, let title, let assignmentId):
                    VocabSetView(setId: id, title: title, assignmentId: assignmentId)
                }
            }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
            // Not `.task`: a TabView never tears its tabs down.
            .onAppear {
                if !shown { shown = true }
                Task { await load() }
                // Back from a page: read the search again, quietly, with the answer still shown.
                if isSearching { runSearch(searchText, pause: false) }
            }
            // A newer keystroke cancels the older search; a cancelled search stores nothing.
            .onChange(of: searchText) { _, text in runSearch(text, pause: true) }
            // Fades out with the first letter and back when the field is cleared; under Reduce
            // Motion it simply goes and comes back (the animation is the only thing it picks).
            .onChange(of: searchText.isEmpty) { _, empty in
                withAnimation(reduceMotion ? nil : Motion.focus) { reviewHidden = !empty }
            }
            .onChange(of: segment) { _, _ in
                if !segmentPicked { segmentPicked = true }
            }
            .sheet(isPresented: $isBuilding) {
                CustomSetBuilderView { saved in
                    isBuilding = false
                    if saved { Task { await load() } }
                }
                .noBarClearance()
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

    // MARK: - Review today

    @ViewBuilder private var reviewCard: some View {
        let state = reviewState
        ReviewTodayCard(
            state: state,
            starting: startingReview,
            note: noteText(for: state),
            onStart: startReview,
            retry: { await load() }
        )
    }

    /// The note belongs to the section it was found for: once the card's next step is something
    /// else, it says nothing.
    private func noteText(for state: ReviewTodayCard.State) -> String? {
        guard let startNote, case .ready(let review) = state,
              case .section(let id, _, _) = review.next, id == startNote.sectionId else { return nil }
        return startNote.text
    }

    /// Start: the homework set bound to its homework, or — for a section — one read of it, then
    /// its set with the most words still to master (the section page if the read fails). A root
    /// push: a second tap while the first is in flight stacks nothing.
    private func startReview() {
        guard case .ready(let review) = reviewState, !startingReview, path.isEmpty else { return }
        switch review.next {
        case .homework(let set):
            if startNote != nil { startNote = nil }
            path.append(Route.set(id: set.setId, title: set.title, assignmentId: set.assignmentId))
        case .section(let id, let title, _):
            if startNote != nil { startNote = nil }
            startingReview = true
            Task { await openBestSet(inSection: id, title: title) }
        case .caughtUp, .nothingYet:
            break
        }
    }

    @MainActor
    private func openBestSet(inSection id: Int, title: String) async {
        defer { startingReview = false }
        var detail: VocabSectionDetail?
        do {
            detail = try await session.student.vocabularySection(id: id)
        } catch {
            // A cancelled read is not a failed one: do nothing rather than open a page.
            guard !Task.isCancelled else { return }
        }
        // The student went somewhere else meanwhile — another page, or another tab: leave them there.
        guard path.isEmpty, router.selection == .words else { return }
        guard let detail else {
            // The read failed: the section page loads for itself, and says so if it cannot.
            path.append(Route.section(id: id, title: title))
            return
        }
        if let best = VocabReview.bestSet(in: detail) {
            path.append(Route.set(id: best.id, title: best.title))
        } else {
            // Words remain by the bank's count, yet no set in the section has any to play. That
            // is not "all caught up" — say what happened and leave the lists to the student.
            let text = "There's no set to open in \(title) right now — pick one from the word bank below."
            startNote = StartNote(sectionId: id, text: text)
            AccessibilityNotification.Announcement(text).post()
        }
    }

    // MARK: - Search

    @ViewBuilder private var searchResults: some View {
        let text = searchText
        let fresh = resultsFor == text
        if searchFailedFor == text {
            VocabErrorNotice(
                title: "Search didn't go through",
                message: "Check your connection and try again."
            ) { runSearch(searchText, pause: false) }
        } else if fresh && results.isEmpty {
            DashedEmpty(title: "No matches for “\(text)”", hint: "Try a shorter word, or part of a definition.")
        } else if fresh || (resultsFor != nil && !results.isEmpty) {
            // Not yet answered for this text: the last answer stays, dimmed, rather than
            // collapsing into a spinner on every keystroke.
            VStack(spacing: 12) {
                ForEach(results) { VocabSearchRow(word: $0, stale: !fresh) }
            }
            .opacity(fresh ? 1 : 0.45)
            .animation(.easeOut(duration: 0.15), value: fresh)
        } else {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
                .accessibilityLabel("Searching")
        }
    }

    /// One search at a time, owned here: a newer keystroke cancels the older one, and a task
    /// that was cancelled stores nothing. `pause` waits for a break in the typing.
    private func runSearch(_ text: String, pause: Bool) {
        searchTask?.cancel()
        searchTask = nil
        guard text.count >= 2 else {
            if !results.isEmpty { results = [] }
            if resultsFor != nil { resultsFor = nil }
            if searchFailedFor != nil { searchFailedFor = nil }
            return
        }
        // The very text already answered (typed away and back): the answer on screen stands.
        if pause, resultsFor == text, searchFailedFor == nil { return }
        // A new request is starting, so a failure from the last one no longer stands: "Try again"
        // shows progress, and typing back to a term that failed does not flash its error first.
        if searchFailedFor != nil { searchFailedFor = nil }
        searchTask = Task {
            if pause {
                do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
            }
            await fetchSearch(text)
        }
    }

    @MainActor
    private func fetchSearch(_ text: String) async {
        do {
            let found = try await session.student.searchVocabularyWords(text)
            guard !Task.isCancelled, text == searchText else { return }
            if results != found { results = found }
            if resultsFor != text { resultsFor = text }
            if searchFailedFor != nil { searchFailedFor = nil }
        } catch {
            guard !Task.isCancelled, text == searchText else { return }
            // A quiet re-read that fails keeps the answer already on screen.
            if resultsFor != text, searchFailedFor != text { searchFailedFor = text }
        }
    }

    // MARK: - Homework

    @ViewBuilder
    private var homeworkList: some View {
        if !homeworkKnown {
            if homeworkPhase == .failed {
                VocabErrorNotice(title: "Couldn't load your homework") { await loadHomework() }
            } else {
                loadingSlot
            }
        } else if groups.isEmpty {
            VocabEmptyState(
                title: "No vocabulary homework right now",
                message: "When a teacher assigns a word list it lands here with its due date. Until then, pick any set from the word bank."
            )
        } else {
            VStack(spacing: 18) {
                ForEach(groups) { VocabHomeworkGroupCard(group: $0) }
            }
        }
    }

    // MARK: - Word bank

    @ViewBuilder
    private var bankList: some View {
        if !sectionsKnown {
            if sectionsPhase == .failed {
                VocabErrorNotice(title: "Couldn't load the word bank") { await loadSections() }
            } else {
                loadingSlot
            }
        } else if sections.isEmpty {
            VocabEmptyState(
                title: "No word lists published yet",
                message: "Your teachers publish vocabulary sections here. In the meantime you can build a set of your own.",
                actionTitle: "Build my own set",
                action: { isBuilding = true }
            )
        } else {
            VStack(spacing: 14) {
                ForEach(sections) { section in
                    NavigationLink(value: Route.section(id: section.id, title: section.title)) {
                        VocabSectionCard(section: section)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - My sets

    @ViewBuilder
    private var mineList: some View {
        if !mySetsKnown {
            if mySetsPhase == .failed {
                VocabErrorNotice(title: "Couldn't load your sets") { await loadMySets() }
            } else {
                loadingSlot
            }
        } else if mySets.isEmpty {
            VocabEmptyState(
                title: "Make a set of the words you keep missing",
                message: "Pull any words from the word bank into a set of your own, then study it with all four games.",
                actionTitle: "New set",
                action: { isBuilding = true }
            )
        } else {
            VStack(spacing: 14) {
                HStack {
                    Text("Sets you built")
                        .appFont(15, weight: .heavy)
                    Spacer()
                    Button { isBuilding = true } label: {
                        Label("New set", systemImage: "plus")
                            .appFont(13, weight: .heavy)
                            .padding(.vertical, 8)
                            .padding(.leading, 12)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressBounce())
                    .foregroundStyle(Theme.accent)
                }
                ForEach(mySets) { set in
                    NavigationLink(value: Route.set(id: set.id, title: set.title)) {
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
                                .appFont(14, weight: .semibold)
                                .foregroundStyle(Theme.textSecondary)
                                .frame(width: 36, height: 36)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(isDeleting)
                        .accessibilityLabel("Delete \(set.title)")
                        .capDynamicType(label: "Delete \(set.title)", systemImage: "trash")
                        .padding(.top, 10)
                        .padding(.trailing, 8)
                    }
                }
            }
        }
    }

    private var loadingSlot: some View {
        // Only the selected segment's list is drawn, so one of these shows at a time, in the shape
        // of that list's cards.
        LoadingSkeleton(rows: 2, height: 84, style: .cards)
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
        async let bank: Void = loadSections()
        async let mine: Void = loadMySets()
        async let assigned: Void = loadHomework()
        _ = await (bank, mine, assigned)
    }

    @MainActor
    private func loadSections() async {
        if !sectionsKnown, sectionsPhase != .loading { sectionsPhase = .loading }
        do {
            let fresh = try await session.student.vocabularySections()
            if sections != fresh {
                sections = fresh
                // A reload may leave a set to open where Start found none.
                if startNote != nil { startNote = nil }
            }
            if !sectionsKnown { sectionsKnown = true }
            if sectionsPhase != .loaded { sectionsPhase = .loaded }
        } catch {
            // A cancelled read is not a failed one; a failed reload keeps the last good bank.
            guard !Task.isCancelled else { return }
            if sectionsPhase != .failed { sectionsPhase = .failed }
        }
    }

    @MainActor
    private func loadMySets() async {
        if !mySetsKnown, mySetsPhase != .loading { mySetsPhase = .loading }
        do {
            let fresh = try await session.student.myVocabularySets()
            if mySets != fresh { mySets = fresh }
            if !mySetsKnown { mySetsKnown = true }
            if mySetsPhase != .loaded { mySetsPhase = .loaded }
        } catch {
            guard !Task.isCancelled else { return }
            if mySetsPhase != .failed { mySetsPhase = .failed }
        }
    }

    @MainActor
    private func loadHomework() async {
        if !homeworkKnown, homeworkPhase != .loading { homeworkPhase = .loading }
        do {
            let fresh = try await session.student.vocabularyHomework()
            if groups != fresh { groups = fresh }
            if !homeworkKnown { homeworkKnown = true }
            if homeworkPhase != .loaded { homeworkPhase = .loaded }
            if !segmentPicked {
                segmentPicked = true
                let opening: Segment = fresh.isEmpty ? .bank : .homework
                if segment != opening { segment = opening }
            }
        } catch {
            guard !Task.isCancelled else { return }
            if homeworkPhase != .failed { homeworkPhase = .failed }
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
            guard !Task.isCancelled else { return }
            deleteError = error.errorDescription
        } catch {
            guard !Task.isCancelled else { return }
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
                    tone: allDone ? Theme.success : Theme.amber,
                    size: 40
                )
                VStack(alignment: .leading, spacing: 8) {
                    Text(group.assignmentTitle)
                        .appFont(17, weight: .heavy)
                        .titleLineLimit(2)
                    FlowLayout(spacing: 6) {
                        if let name = group.classroomName, !name.isEmpty {
                            if let classroomId = group.classroomId {
                                NavigationLink(value: AppLink.classroom(id: classroomId)) {
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
                // "Done" is any game finished on a set with words; the segment's count is mastery.
                // A homework with nothing to play yet has nothing to be done: it is not "complete".
                if group.playableCount == 0 {
                    Chip(text: "No words yet", tone: .neutral)
                } else if allDone {
                    Chip(text: "\(ScoreText.string(group.doneCount)) / \(ScoreText.string(group.playableCount)) complete",
                         icon: "checkmark.circle.fill", tone: .success)
                } else {
                    Chip(text: "\(ScoreText.string(group.doneCount)) / \(ScoreText.string(group.playableCount)) done",
                         tone: late ? .warning : .neutral)
                }
            }

            ForEach(group.sets) { set in
                if set.wordCount > 0 {
                    NavigationLink(value: VocabularyView.Route.set(id: set.id, title: set.title, assignmentId: group.assignmentId)) {
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
                } else {
                    // Nothing to play: a Start card would open an empty page. It stays listed, so
                    // the homework is honest about what it carries, but it is not a link.
                    VocabEmptySetRow(title: set.title, subtitle: set.sectionTitle)
                }
            }
        }
        .cardStyle(padding: 16)
        .overlay {
            if allDone {
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.success.opacity(0.4), lineWidth: 1)
                    .allowsHitTesting(false)
            }
        }
    }

    private func classroomChip(_ name: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: "person.2.fill").appFont(10, weight: .bold)
                .accessibilityHidden(true)
            Text(name).appFont(12, weight: .semibold).lineLimit(1)
        }
        .foregroundStyle(Theme.textSecondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(Theme.surface2))
    }
}
