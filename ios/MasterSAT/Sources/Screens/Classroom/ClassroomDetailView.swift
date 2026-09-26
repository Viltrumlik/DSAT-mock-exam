import SwiftUI
import MasterSATKit

/// One classroom, as the site's `/classes/<id>` shows it to a student: the class header with
/// the student's rank, the head-count and their XP, the Telegram group, and five tabs —
/// Overview · Classwork · Assignments · Materials · People.
///
/// The staff-only tabs (Lessons, Attendance, Midterms, Results, Grading, Settings) are not
/// here, because a student cannot open them on the site either.
struct ClassroomDetailView: View {
    enum Tab: Hashable { case overview, classwork, assignments, materials, people }

    private let classroomId: Int

    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var classroom: Classroom?
    @State private var classroomError: String?
    @State private var tab: Tab = .overview

    @State private var board = ClassroomLoad<RankingBoard>()
    @State private var classwork = ClassroomLoad<[AssignmentListing]>()
    @State private var assignments = ClassroomLoad<[AssignmentListing]>()
    @State private var materials = ClassroomLoad<[ClassroomMaterial]>()
    @State private var people = ClassroomLoad<[ClassroomMember]>()
    @State private var telegram: TelegramGroupState?
    @State private var showingTelegram = false

    /// From the classes list, with the row already in hand.
    init(classroom: Classroom) {
        classroomId = classroom.id
        _classroom = State(initialValue: classroom)
    }

    /// From a link that carries only the id (a notification, a deep link). The class is
    /// loaded first; a class the student is not in says so.
    init(classroomId: Int) {
        self.classroomId = classroomId
    }

    var body: some View {
        Group {
            if let classroom {
                content(classroom)
            } else if let classroomError {
                ScrollView {
                    ClassroomErrorState(
                        title: "Class not available",
                        message: "It may have been removed, or you're not enrolled."
                    ) { await loadClassroom() }
                    .accessibilityHint(classroomError)
                    .padding(16)
                }
            } else {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Opening classroom…")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadClassroom() }
    }

    private func content(_ classroom: Classroom) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header(classroom)
                telegramButton(classroom)
                PillTabs(items: tabs, selection: $tab)
                tabContent(classroom)
            }
            .padding(16)
        }
        .refreshable { await refresh(classroom) }
        .task(id: tab) { await loadTab(tab, classroom: classroom, force: false) }
        .task { await loadHeader(classroom) }
        .sheet(isPresented: $showingTelegram, onDismiss: { Task { await loadTelegram() } }) {
            ClassroomTelegramSheet(classroomId: classroom.id, className: classroom.name, initialState: telegram) { state in
                telegram = state
            }
        }
    }

    // MARK: - Header

    /// The hero, carrying what the site's header carries: the subject, the schedule and the
    /// room, "Student", and for a student the three numbers — rank, students, their XP.
    private func header(_ classroom: Classroom) -> some View {
        HeroHeader(
            eyebrow: classroom.subjectLabel,
            eyebrowIcon: classroom.isMath ? "function" : "book.closed.fill",
            title: classroom.name,
            blurb: headerLine(classroom),
            tiles: heroTiles(classroom)
        )
    }

    private func headerLine(_ classroom: Classroom) -> String? {
        var parts: [String] = []
        let schedule = classroom.headerScheduleLine
        if !schedule.isEmpty { parts.append(schedule) }
        let room = ClassroomSchedule.roomLabel(classroom.roomNumber)
        if !room.isEmpty { parts.append(room) }
        if classroom.isStudent { parts.append("Student") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func heroTiles(_ classroom: Classroom) -> [HeroTile] {
        let students = HeroTile("Students", icon: "person.2", value: classroom.headCount)
        guard classroom.isStudent else { return classroom.headCount == nil ? [] : [students] }
        // Rank and XP are the student's own row on the class board; "—" until there is one.
        let my = board.value?.my
        return [
            HeroTile("Rank", icon: "trophy", value: my.map { "#\(ScoreText.string($0.rank))" } ?? "—"),
            students,
            HeroTile("Your XP", icon: "sparkles", value: ScoreText.string(my?.score)),
        ]
    }

    @ViewBuilder
    private func telegramButton(_ classroom: Classroom) -> some View {
        let button = TelegramGroupButton.resolve(state: telegram, classroomGroupURL: classroom.telegramGroupURL)
        if let title = button.title {
            Button {
                switch button {
                case .join: showingTelegram = true
                case .link(let raw):
                    if let url = URL(string: raw) { openURL(url) }
                case .none: break
                }
            } label: {
                Label(title, systemImage: "paperplane.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(tone: Theme.info, fullWidth: true))
        }
    }

    // MARK: - Tabs

    private var tabs: [PillTabs<Tab>.Item] {
        [
            .init(tab: .overview, title: "Overview", icon: "square.grid.2x2"),
            .init(tab: .classwork, title: "Classwork", icon: "rectangle.inset.filled.and.person.filled", count: classwork.count),
            .init(tab: .assignments, title: "Assignments", icon: "checklist", count: assignments.count),
            .init(tab: .materials, title: "Materials", icon: "folder", count: materials.count),
            .init(tab: .people, title: "People", icon: "person.2", count: people.count),
        ]
    }

    @ViewBuilder
    private func tabContent(_ classroom: Classroom) -> some View {
        switch tab {
        case .overview:
            ClassroomRankingsSection(load: board, isStudent: classroom.isStudent) {
                await loadBoard(classroom)
            }
        case .classwork:
            ClassroomClassworkSection(load: classwork) {
                await loadTab(.classwork, classroom: classroom, force: true)
            }
        case .assignments:
            ClassroomAssignmentsSection(load: assignments) {
                await loadTab(.assignments, classroom: classroom, force: true)
            }
        case .materials:
            ClassroomMaterialsSection(load: materials) {
                await loadTab(.materials, classroom: classroom, force: true)
            }
        case .people:
            ClassroomPeopleSection(load: people) {
                await loadTab(.people, classroom: classroom, force: true)
            }
        }
    }

    // MARK: - Loading

    @MainActor
    private func loadClassroom() async {
        guard classroom == nil else { return }
        classroomError = nil
        do {
            classroom = try await session.classrooms.classroom(id: classroomId)
        } catch let error as APIError {
            classroomError = error.errorDescription ?? "Class not available"
        } catch {
            classroomError = error.localizedDescription
        }
    }

    /// The header's numbers and the Telegram button — both needed whatever tab is open.
    @MainActor
    private func loadHeader(_ classroom: Classroom) async {
        if !board.isLoading { await loadBoard(classroom) }
        await loadTelegram()
    }

    @MainActor
    private func loadBoard(_ classroom: Classroom) async {
        await run($board) { try await session.classrooms.rankings(classroomId: classroom.id) }
    }

    /// A failed lookup leaves the button on the static link, which still works.
    @MainActor
    private func loadTelegram() async {
        telegram = (try? await ClassroomTelegramAPI(client: session.client).state(classroomId: classroomId)) ?? telegram
    }

    @MainActor
    private func loadTab(_ tab: Tab, classroom: Classroom, force: Bool) async {
        switch tab {
        case .overview:
            // The header loads the board on open; the tab only reloads it when asked.
            if force { await loadBoard(classroom) }
        case .classwork:
            guard force || !classwork.hasLoaded else { return }
            await run($classwork) {
                try await session.classrooms.classwork(classroomId: classroom.id, classroomName: classroom.name)
            }
        case .assignments:
            guard force || !assignments.hasLoaded else { return }
            // The student's own list, filtered to this class: it carries their status on each
            // homework, which the class's own list does not.
            await run($assignments) {
                try await session.student.assignments().filter { $0.classroomId == classroom.id }
            }
        case .materials:
            guard force || !materials.hasLoaded else { return }
            await run($materials) { try await session.classrooms.materials(classroomId: classroom.id) }
        case .people:
            guard force || !people.hasLoaded else { return }
            await run($people) { try await session.classrooms.people(classroomId: classroom.id) }
        }
    }

    @MainActor
    private func refresh(_ classroom: Classroom) async {
        if let fresh = try? await session.classrooms.classroom(id: classroom.id) { self.classroom = fresh }
        await loadHeader(classroom)
        if tab != .overview { await loadTab(tab, classroom: classroom, force: true) }
    }

    /// Load one tab through its binding, so "loading" shows while the request is out and a
    /// failure keeps the last good answer on screen.
    @MainActor
    private func run<Value>(_ target: Binding<ClassroomLoad<Value>>, _ fetch: @MainActor () async throws -> Value) async {
        target.wrappedValue.isLoading = true
        do {
            let value = try await fetch()
            target.wrappedValue.value = value
            target.wrappedValue.error = nil
        } catch {
            target.wrappedValue.error = ClassroomLoad<Value>.message(for: error)
        }
        target.wrappedValue.isLoading = false
        target.wrappedValue.hasLoaded = true
    }
}

/// One tab's data: the last good answer, the last failure, and whether it has ever loaded.
/// A failure keeps the last good answer on screen rather than blanking it.
struct ClassroomLoad<Value> {
    var value: Value?
    var error: String?
    var isLoading = false
    var hasLoaded = false

    static func message(for error: Error) -> String {
        if let failure = error as? APIError { return failure.errorDescription ?? "Something went wrong." }
        return error.localizedDescription
    }
}

extension ClassroomLoad where Value: Collection {
    /// A tab's count badge: only once loaded, and not for zero.
    var count: Int? {
        guard let value, !value.isEmpty else { return nil }
        return value.count
    }
}
