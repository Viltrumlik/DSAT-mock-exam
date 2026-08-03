import SwiftUI
import MasterSATKit

/// Full mocks: start one, resume one, or look at the last result.
struct ExamsListView: View {
    @Environment(Session.self) private var session
    @State private var mocks: [MockListing] = []
    @State private var loadError: String?
    @State private var isLoading = true
    @State private var startingMockId: Int?
    @State private var route: ExamRoute?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                } else if let loadError {
                    RetryNotice(message: loadError) { await load() }
                } else if mocks.isEmpty {
                    ContentUnavailableView(
                        "No mocks available",
                        systemImage: "doc.text",
                        description: Text("Mocks your teacher assigns will appear here.")
                    )
                } else {
                    List(mocks) { mock in
                        MockRow(
                            mock: mock,
                            isStarting: startingMockId == mock.mockId,
                            onStart: { start(mock) },
                            onViewResult: {
                                if let id = mock.resultAttemptId { route = .results(attemptId: id) }
                            }
                        )
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Exams")
            .refreshable { await load() }
            .task { await load() }
            .fullScreenCover(item: $route) { route in
                switch route {
                case .runner(let attemptId):
                    ExamContainerView(attemptId: attemptId, backend: .mocks) {
                        self.route = nil
                        Task { await load() }
                    }
                case .results(let attemptId):
                    MockResultsView(attemptId: attemptId) { self.route = nil }
                }
            }
        }
    }

    @MainActor
    private func start(_ mock: MockListing) {
        startingMockId = mock.mockId
        Task {
            defer { startingMockId = nil }
            do {
                // The server hands back the existing in-progress attempt rather than
                // creating a second one, so a double tap cannot open two sittings.
                let attempt = try await session.student.startMockAttempt(mockId: mock.mockId)
                route = .runner(attemptId: attempt.id)
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

enum ExamRoute: Identifiable, Hashable {
    case runner(attemptId: Int)
    case results(attemptId: Int)

    var id: String {
        switch self {
        case .runner(let id): return "runner.\(id)"
        case .results(let id): return "results.\(id)"
        }
    }
}

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
        .buttonStyle(.plain)
    }
}

struct ProfileView: View {
    let user: CurrentUser
    @Environment(Session.self) private var session
    @State private var isConfirmingSignOut = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        AvatarView(user: user)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.displayName).font(.headline)
                            Text(user.email).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section("Goals") {
                    LabeledContent("Target score", value: ScoreText.string(user.targetScore))
                    LabeledContent("Reading & Writing", value: ScoreText.string(user.targetEnglish))
                    LabeledContent("Math", value: ScoreText.string(user.targetMath))
                    LabeledContent("SAT date", value: user.satExamDate ?? "—")
                }

                Section {
                    Button("Sign out", role: .destructive) { isConfirmingSignOut = true }
                }
            }
            .navigationTitle("Profile")
            .confirmationDialog("Sign out of MasterSAT?", isPresented: $isConfirmingSignOut) {
                Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                Button("Cancel", role: .cancel) {}
            }
        }
    }
}

struct AvatarView: View {
    let user: CurrentUser

    var body: some View {
        Group {
            if let raw = user.profileImageURL, let url = URL(string: raw) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initials
                }
            } else {
                initials
            }
        }
        .frame(width: 52, height: 52)
        .clipShape(Circle())
    }

    private var initials: some View {
        ZStack {
            Circle().fill(Theme.accent.opacity(0.15))
            Text(user.initials).font(.headline).foregroundStyle(Theme.accent)
        }
    }
}
