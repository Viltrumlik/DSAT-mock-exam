import SwiftUI
import MasterSATKit

/// Shared plumbing for the three sitting screens.
///
/// They are separate screens rather than one merged list because they are not the same
/// kind of thing: a mock is a full test-day sitting, a midterm is a scheduled class paper
/// with a window and a code, and a past paper is practice you can stop whenever you like.
/// One list would force one set of words onto three different promises.
private struct ExamScreenScaffold<Content: View>: View {
    let title: String
    let isLoading: Bool
    let loadError: String?
    let reload: @MainActor () async -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let loadError {
                RetryNotice(message: loadError) { await reload() }
            } else {
                content()
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct MocksScreen: View {
    @Environment(Session.self) private var session
    @State private var mocks: [MockListing] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var startingId: Int?
    @State private var route: ExamRoute?

    var body: some View {
        ExamScreenScaffold(title: "Mock exams", isLoading: isLoading, loadError: loadError, reload: load) {
            if mocks.isEmpty {
                ContentUnavailableView(
                    "No mocks available",
                    systemImage: "doc.text",
                    description: Text("Mocks your teacher assigns will appear here.")
                )
            } else {
                List(mocks) { mock in
                    MockRow(
                        mock: mock,
                        isStarting: startingId == mock.mockId,
                        onStart: { start(mock.mockId) },
                        onViewResult: {
                            if let id = mock.resultAttemptId { route = .results(attemptId: id) }
                        }
                    )
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .task { await load() }
        .fullScreenCover(item: $route) { route in
            switch route {
            case .runner(let attemptId, let backend):
                ExamContainerView(attemptId: attemptId, backend: backend) {
                    self.route = nil
                    Task { await load() }
                }
            case .results(let attemptId):
                MockResultsView(attemptId: attemptId) { self.route = nil }
            }
        }
    }

    @MainActor
    private func start(_ mockId: Int) {
        startingId = mockId
        Task {
            defer { startingId = nil }
            do {
                // Returns the live attempt rather than opening a second one, so a double
                // tap cannot start two sittings.
                let attempt = try await session.student.startMockAttempt(mockId: mockId)
                route = .runner(attemptId: attempt.id, backend: .mocks)
            } catch let error as APIError {
                loadError = error.errorDescription
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    @MainActor
    private func load() async {
        isLoading = mocks.isEmpty
        loadError = nil
        do {
            mocks = try await session.student.mocks()
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

struct MidtermsScreen: View {
    @Environment(Session.self) private var session
    @State private var midterms: [MidtermListing] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var startingId: Int?
    @State private var route: ExamRoute?
    @State private var resultAttemptId: Int?

    var body: some View {
        ExamScreenScaffold(title: "Midterms", isLoading: isLoading, loadError: loadError, reload: load) {
            if midterms.isEmpty {
                ContentUnavailableView(
                    "No midterms yet",
                    systemImage: "flag.checkered",
                    description: Text("Midterms your class is scheduled for will appear here.")
                )
            } else {
                List(midterms) { midterm in
                    VStack(alignment: .leading, spacing: 8) {
                        MidtermRow(
                            midterm: midterm,
                            isStarting: startingId == midterm.midtermId,
                            onStart: { start(midterm.midtermId) }
                        )
                        // The web had no link at all from a submitted midterm to its own
                        // result page; the row is the only place a student would look.
                        if midterm.submitted, let attemptId = midterm.attemptId {
                            Button("See result") { resultAttemptId = attemptId }
                                .font(.caption.weight(.medium))
                                .buttonStyle(.bordered)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .task { await load() }
        .navigationDestination(item: $resultAttemptId) { id in
            MidtermResultView(attemptId: id)
        }
        .fullScreenCover(item: $route) { route in
            switch route {
            case .runner(let attemptId, let backend):
                ExamContainerView(attemptId: attemptId, backend: backend) {
                    self.route = nil
                    Task { await load() }
                }
            case .results(let attemptId):
                MockResultsView(attemptId: attemptId) { self.route = nil }
            }
        }
    }

    @MainActor
    private func start(_ midtermId: Int) {
        startingId = midtermId
        Task {
            defer { startingId = nil }
            do {
                let attempt = try await session.student.startMidtermAttempt(midtermId: midtermId)
                route = .runner(attemptId: attempt.id, backend: .midterms)
            } catch let error as APIError {
                loadError = error.errorDescription
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    @MainActor
    private func load() async {
        isLoading = midterms.isEmpty
        loadError = nil
        do {
            midterms = try await session.student.midterms()
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

struct PastpapersScreen: View {
    @Environment(Session.self) private var session
    @State private var papers: [PastpaperListing] = []
    @State private var attempts: [PastpaperAttemptSummary] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var startingId: Int?
    @State private var route: ExamRoute?

    var body: some View {
        ExamScreenScaffold(title: "Past papers", isLoading: isLoading, loadError: loadError, reload: load) {
            if papers.isEmpty {
                ContentUnavailableView(
                    "No past papers yet",
                    systemImage: "tray.full",
                    description: Text("Practice papers will appear here.")
                )
            } else {
                List {
                    ForEach(grouped, id: \.0) { collection, rows in
                        Section(collection) {
                            ForEach(rows) { paper in
                                PastpaperRow(
                                    paper: paper,
                                    attempt: attempt(for: paper),
                                    isStarting: startingId == paper.id,
                                    onStart: { start(paper.id) }
                                )
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .task { await load() }
        .fullScreenCover(item: $route) { route in
            switch route {
            case .runner(let attemptId, let backend):
                ExamContainerView(attemptId: attemptId, backend: backend) {
                    self.route = nil
                    Task { await load() }
                }
            case .results(let attemptId):
                MockResultsView(attemptId: attemptId) { self.route = nil }
            }
        }
    }

    private var grouped: [(String, [PastpaperListing])] {
        Dictionary(grouping: papers) {
            ($0.collectionName?.isEmpty == false) ? $0.collectionName! : "Past papers"
        }
        .sorted { $0.key < $1.key }
        .map { ($0.key, $0.value.sorted { $0.title < $1.title }) }
    }

    private func attempt(for paper: PastpaperListing) -> PastpaperAttemptSummary? {
        attempts.filter { $0.practiceTest == paper.id }.max { $0.id < $1.id }
    }

    @MainActor
    private func start(_ practiceTestId: Int) {
        startingId = practiceTestId
        Task {
            defer { startingId = nil }
            do {
                let attempt = try await session.student.startPastpaperAttempt(practiceTestId: practiceTestId)
                route = .runner(attemptId: attempt.id, backend: .exams)
            } catch let error as APIError {
                loadError = error.errorDescription
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    @MainActor
    private func load() async {
        isLoading = papers.isEmpty
        loadError = nil
        do {
            async let list = session.student.pastpapers()
            async let mine = session.student.pastpaperAttempts()
            papers = try await list
            attempts = try await mine
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

/// One practice-test pack, opened.
///
/// A pack's sections ARE past-paper sections, so starting one opens the same runner as a
/// past paper. Only the grouping is different.
struct PracticePacksView: View {
    @Environment(Session.self) private var session
    @State private var packs: [PracticePack] = []
    @State private var isLoading = true
    @State private var loadError: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
            } else if packs.isEmpty {
                ContentUnavailableView(
                    "No practice tests yet",
                    systemImage: "flask",
                    description: Text("Practice tests published for you will appear here.")
                )
            } else {
                List(packs) { pack in
                    NavigationLink {
                        PracticePackDetailView(pack: pack)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(pack.title).font(.subheadline.weight(.medium))
                            if let description = pack.description, !description.isEmpty {
                                Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                            Text("\(pack.sections.count) section\(pack.sections.count == 1 ? "" : "s")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .navigationTitle("Practice tests")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @MainActor
    private func load() async {
        isLoading = packs.isEmpty
        loadError = nil
        do {
            packs = try await session.practice.packs()
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

struct PracticePackDetailView: View {
    let pack: PracticePack

    @Environment(Session.self) private var session
    @State private var startingId: Int?
    @State private var errorText: String?
    @State private var route: ExamRoute?

    var body: some View {
        List {
            if let description = pack.description, !description.isEmpty {
                Section { Text(description).font(.subheadline) }
            }
            Section("Sections") {
                ForEach(pack.sections) { section in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(section.title.isEmpty ? "Section" : section.title)
                                .font(.subheadline.weight(.medium))
                            Text([
                                section.subject.humanisedSubject,
                                "\(section.moduleCount) module\(section.moduleCount == 1 ? "" : "s")",
                            ].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button {
                            start(section.id)
                        } label: {
                            if startingId == section.id {
                                ProgressView().controlSize(.small)
                            } else {
                                Text("Start").bold()
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.accent)
                        .disabled(startingId != nil)
                    }
                    .padding(.vertical, 2)
                }
            }
            if let errorText {
                Section { Text(errorText).font(.footnote).foregroundStyle(.red) }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(pack.title)
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(item: $route) { route in
            if case .runner(let attemptId, let backend) = route {
                ExamContainerView(attemptId: attemptId, backend: backend) { self.route = nil }
            }
        }
    }

    @MainActor
    private func start(_ sectionId: Int) {
        startingId = sectionId
        errorText = nil
        Task {
            defer { startingId = nil }
            do {
                let attempt = try await session.student.startPastpaperAttempt(practiceTestId: sectionId)
                route = .runner(attemptId: attempt.id, backend: .exams)
            } catch let error as APIError {
                errorText = error.errorDescription
            } catch {
                errorText = error.localizedDescription
            }
        }
    }
}
