import SwiftUI
import MasterSATKit

/// Everything a student can sit, in the three shapes the platform actually has.
///
/// They are separate segments rather than one merged list because they are not the same
/// kind of thing: a mock is a full test-day sitting, a midterm is a scheduled class
/// assessment with a window and a code, and a past paper is practice you can stop whenever
/// you like. Merging them would force one set of words onto three different promises.
struct ExamsListView: View {
    enum Kind: String, CaseIterable, Identifiable {
        case mocks = "Mocks"
        case midterms = "Midterms"
        case pastpapers = "Past papers"

        var id: String { rawValue }

        var backend: ExamBackend {
            switch self {
            case .mocks: return .mocks
            case .midterms: return .midterms
            case .pastpapers: return .exams
            }
        }
    }

    @Environment(Session.self) private var session
    @State private var kind: Kind = .mocks

    @State private var mocks: [MockListing] = []
    @State private var midterms: [MidtermListing] = []
    @State private var pastpapers: [PastpaperListing] = []
    @State private var pastpaperAttempts: [PastpaperAttemptSummary] = []

    @State private var loadError: String?
    @State private var isLoading = true
    @State private var startingId: Int?
    @State private var route: ExamRoute?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Kind", selection: $kind) {
                    ForEach(Kind.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)

                content
            }
            .navigationTitle("Exams")
            .refreshable { await load() }
            .task(id: kind) { await load() }
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
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            Spacer()
            ProgressView()
            Spacer()
        } else if let loadError {
            Spacer()
            RetryNotice(message: loadError) { await load() }
            Spacer()
        } else {
            switch kind {
            case .mocks: mockList
            case .midterms: midtermList
            case .pastpapers: pastpaperList
            }
        }
    }

    // MARK: - Mocks

    @ViewBuilder
    private var mockList: some View {
        if mocks.isEmpty {
            emptyState("No mocks available", "Mocks your teacher assigns will appear here.", "doc.text")
        } else {
            List(mocks) { mock in
                MockRow(
                    mock: mock,
                    isStarting: startingId == mock.mockId,
                    onStart: { start(mockId: mock.mockId) },
                    onViewResult: {
                        if let id = mock.resultAttemptId { route = .results(attemptId: id) }
                    }
                )
            }
            .listStyle(.insetGrouped)
        }
    }

    // MARK: - Midterms

    @ViewBuilder
    private var midtermList: some View {
        if midterms.isEmpty {
            emptyState("No midterms yet", "Midterms your class is scheduled for will appear here.", "flag.checkered")
        } else {
            List(midterms) { midterm in
                MidtermRow(
                    midterm: midterm,
                    isStarting: startingId == midterm.midtermId,
                    onStart: { start(midtermId: midterm.midtermId) }
                )
            }
            .listStyle(.insetGrouped)
        }
    }

    // MARK: - Past papers

    @ViewBuilder
    private var pastpaperList: some View {
        if pastpapers.isEmpty {
            emptyState("No past papers yet", "Practice papers will appear here.", "tray.full")
        } else {
            List {
                ForEach(groupedPastpapers, id: \.0) { collection, papers in
                    Section(collection) {
                        ForEach(papers) { paper in
                            PastpaperRow(
                                paper: paper,
                                attempt: attempt(for: paper),
                                isStarting: startingId == paper.id,
                                onStart: { start(pastpaperId: paper.id) }
                            )
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    private var groupedPastpapers: [(String, [PastpaperListing])] {
        Dictionary(grouping: pastpapers) {
            ($0.collectionName?.isEmpty == false) ? $0.collectionName! : "Past papers"
        }
        .sorted { $0.key < $1.key }
        .map { ($0.key, $0.value.sorted { $0.title < $1.title }) }
    }

    private func attempt(for paper: PastpaperListing) -> PastpaperAttemptSummary? {
        // The newest attempt for this paper — a completed one still labels the row.
        pastpaperAttempts.filter { $0.practiceTest == paper.id }.max { $0.id < $1.id }
    }

    private func emptyState(_ title: String, _ message: String, _ icon: String) -> some View {
        ContentUnavailableView(title, systemImage: icon, description: Text(message))
    }

    // MARK: - Opening

    @MainActor
    private func start(mockId: Int? = nil, midtermId: Int? = nil, pastpaperId: Int? = nil) {
        startingId = mockId ?? midtermId ?? pastpaperId
        Task {
            defer { startingId = nil }
            do {
                // Every one of these returns the existing live attempt rather than opening
                // a second, so a double tap cannot start two sittings.
                let attempt: Attempt
                if let mockId {
                    attempt = try await session.student.startMockAttempt(mockId: mockId)
                } else if let midtermId {
                    attempt = try await session.student.startMidtermAttempt(midtermId: midtermId)
                } else if let pastpaperId {
                    attempt = try await session.student.startPastpaperAttempt(practiceTestId: pastpaperId)
                } else {
                    return
                }
                route = .runner(attemptId: attempt.id, backend: kind.backend)
            } catch let error as APIError {
                loadError = error.errorDescription
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    @MainActor
    private func load() async {
        isLoading = currentIsEmpty
        loadError = nil
        let student = session.student
        do {
            switch kind {
            case .mocks:
                mocks = try await student.mocks()
            case .midterms:
                midterms = try await student.midterms()
            case .pastpapers:
                async let papers = student.pastpapers()
                async let attempts = student.pastpaperAttempts()
                pastpapers = try await papers
                pastpaperAttempts = try await attempts
            }
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    private var currentIsEmpty: Bool {
        switch kind {
        case .mocks: return mocks.isEmpty
        case .midterms: return midterms.isEmpty
        case .pastpapers: return pastpapers.isEmpty
        }
    }
}

enum ExamRoute: Identifiable, Hashable {
    case runner(attemptId: Int, backend: ExamBackend)
    case results(attemptId: Int)

    var id: String {
        switch self {
        case .runner(let id, let backend): return "runner.\(backend.rawValue).\(id)"
        case .results(let id): return "results.\(id)"
        }
    }
}

// MARK: - Rows

struct MockRow: View {
    let mock: MockListing
    let isStarting: Bool
    let onStart: @MainActor () -> Void
    let onViewResult: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(mock.title).font(.headline)

            Text("\(mock.moduleCount) modules · \(mock.breakMinutes)-minute break")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 10) {
                Button(action: onStart) {
                    if isStarting {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(mock.inProgress ? "Resume" : "Start").bold()
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(isStarting)

                // Always the last finished sitting, even once a retake is under way —
                // otherwise starting a retake would hide the score just earned.
                if mock.submitted, mock.resultAttemptId != nil {
                    Button("View result", action: onViewResult)
                        .buttonStyle(.bordered)
                }

                Spacer()

                if let score = mock.totalScore {
                    Text(ScoreText.string(score))
                        .font(.title3.bold().monospacedDigit())
                        .foregroundStyle(Theme.accent)
                }
            }
        }
        .padding(.vertical, 6)
    }
}

struct MidtermRow: View {
    let midterm: MidtermListing
    let isStarting: Bool
    let onStart: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(midterm.title).font(.headline)

            HStack(spacing: 6) {
                if !midterm.subject.isEmpty {
                    Text(midterm.subject.humanisedSubject).font(.caption).foregroundStyle(.secondary)
                }
                if let minutes = midterm.durationMinutes {
                    Text("· \(minutes) min").font(.caption).foregroundStyle(.secondary)
                }
                if let count = midterm.questionCount {
                    Text("· \(count) questions").font(.caption).foregroundStyle(.secondary)
                }
            }

            if let window = windowText {
                Label(window, systemImage: "calendar")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if midterm.submitted {
                submittedFooter
            } else if let blocked = midterm.blockedReason {
                // Named as a state of the exam, never of the student.
                Label(blocked, systemImage: "clock")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.orange)
            } else {
                Button(action: onStart) {
                    if isStarting {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(midterm.inProgress ? "Resume" : "Start").bold()
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(isStarting)
            }
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private var submittedFooter: some View {
        if midterm.resultsVisible {
            HStack(spacing: 10) {
                if let score = midterm.score {
                    Text(ScoreText.string(score))
                        .font(.title3.bold().monospacedDigit())
                        .foregroundStyle(Theme.accent)
                    if let ceiling = midterm.scoreCeiling {
                        Text("/ " + ScoreText.string(ceiling)).font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let cert = midterm.certificate, let rank = cert.rank, let cohort = cert.cohortSize {
                    Spacer()
                    Label("\(rank) of \(cohort)", systemImage: "rosette")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        } else {
            // Publish-gated. Say what is happening, so an absent score does not read as a
            // bad one.
            Label("Submitted · results not released yet", systemImage: "checkmark.circle")
                .font(.caption.weight(.medium))
                .foregroundStyle(Theme.accent)
        }
    }

    private var windowText: String? {
        func day(_ raw: String?) -> String? {
            guard let raw, let date = JSONCoding.parseServerDate(raw) else { return nil }
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        if midterm.isBeforeStart, let opens = day(midterm.availableAt) { return "Opens \(opens)" }
        if let closes = day(midterm.deadline) { return "Closes \(closes)" }
        return nil
    }
}

struct PastpaperRow: View {
    let paper: PastpaperListing
    let attempt: PastpaperAttemptSummary?
    let isStarting: Bool
    let onStart: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(paper.title).font(.subheadline.weight(.medium))

            HStack(spacing: 6) {
                if !paper.subject.isEmpty {
                    Text(paper.subject.humanisedSubject)
                        .font(.caption).foregroundStyle(.secondary)
                }
                if paper.totalMinutes > 0 {
                    Text("· \(paper.totalMinutes) min").font(.caption).foregroundStyle(.secondary)
                }
                if let label = paper.label, !label.isEmpty {
                    Text("· \(label)").font(.caption).foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 10) {
                Button(action: onStart) {
                    if isStarting {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(buttonTitle).bold()
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(isStarting)

                if attempt?.isPaused == true {
                    // Pausing is a past-paper-only affordance, so it is worth naming.
                    Label("Paused", systemImage: "pause.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if let score = attempt?.score, attempt?.isCompleted == true {
                    Text(ScoreText.string(score))
                        .font(.subheadline.bold().monospacedDigit())
                        .foregroundStyle(Theme.accent)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var buttonTitle: String {
        guard let attempt else { return "Start" }
        if attempt.inProgress { return "Resume" }
        // A finished paper can be sat again — practice is not one-shot.
        return attempt.isCompleted ? "Try again" : "Start"
    }
}
