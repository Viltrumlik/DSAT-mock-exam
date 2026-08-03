import SwiftUI
import MasterSATKit

/// Joining an invigilated mock sitting, and waiting in it.
///
/// The flow is deliberately three steps — type the code, wait to be approved, wait for the
/// room to start — because that is what an invigilated sitting IS: the whole room begins
/// together on the teacher's word. The app cannot start early even if the student is ready.
struct SittingsView: View {
    @Environment(Session.self) private var session
    @State private var places: [MockSessionPlace] = []
    @State private var code = ""
    @State private var isJoining = false
    @State private var isLoading = true
    @State private var errorText: String?
    @State private var pollTask: Task<Void, Never>?
    @State private var route: ExamRoute?

    var body: some View {
        List {
            Section {
                HStack(spacing: 10) {
                    TextField("Sitting code", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.join)
                        .onSubmit { join() }
                    Button(action: join) {
                        if isJoining {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Join").bold()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || isJoining)
                }
            } header: {
                Text("Join a sitting")
            } footer: {
                if let errorText {
                    Text(errorText).foregroundStyle(.red)
                } else {
                    Text("Your teacher will read the code out at the start of the sitting.")
                }
            }

            if isLoading {
                Section { ProgressView().frame(maxWidth: .infinity) }
            } else if !places.isEmpty {
                Section("Your sittings") {
                    ForEach(places) { place in
                        SittingRow(place: place) {
                            if let attemptId = place.attemptId {
                                route = .runner(attemptId: attemptId, backend: .mocks)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Invigilated sitting")
        .navigationBarTitleDisplayMode(.inline)
        .task { await startWatching() }
        .onDisappear { pollTask?.cancel() }
        .fullScreenCover(item: $route) { route in
            if case .runner(let attemptId, let backend) = route {
                ExamContainerView(attemptId: attemptId, backend: backend) {
                    self.route = nil
                    Task { await load() }
                }
            }
        }
    }

    @MainActor
    private func join() {
        isJoining = true
        errorText = nil
        Task {
            defer { isJoining = false }
            do {
                _ = try await session.practice.joinSitting(code: code)
                code = ""
                await load()
            } catch let error as APIError {
                errorText = error.errorDescription
            } catch {
                errorText = error.localizedDescription
            }
        }
    }

    /// Poll while this screen is open.
    ///
    /// There is no push transport server-side — the site runs three synchronous gunicorn
    /// workers and an open SSE stream would hold one hostage — so the waiting room asks.
    /// Five seconds is close enough that "the room started" feels immediate and slow
    /// enough that a full class waiting together is not a load problem.
    @MainActor
    private func startWatching() async {
        await load()
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                if Task.isCancelled { return }
                await load(quietly: true)
            }
        }
    }

    @MainActor
    private func load(quietly: Bool = false) async {
        if !quietly { isLoading = places.isEmpty }
        do {
            places = try await session.practice.mySittings()
            if !quietly { errorText = nil }
        } catch let error as APIError {
            // A poll failure is not worth replacing the screen over — the next one may
            // well succeed, and the student is watching for a start, not for an error.
            if !quietly { errorText = error.errorDescription }
        } catch {
            if !quietly { errorText = error.localizedDescription }
        }
        isLoading = false
    }
}

struct SittingRow: View {
    let place: MockSessionPlace
    let onStart: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(place.title).font(.subheadline.weight(.medium))
            if let date = place.sessionDate, let parsed = JSONCoding.parseServerDate(date) {
                Text(parsed.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if place.hasStarted {
                Button(action: onStart) {
                    Label("Start now", systemImage: "play.fill").bold()
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
            } else if place.isRejected {
                // The server's decision, stated plainly and without blame.
                Label("Not admitted to this sitting", systemImage: "xmark.circle")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            } else if place.isApproved {
                Label("Approved · waiting for your teacher to start", systemImage: "hourglass")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.accent)
            } else {
                Label("Waiting to be let in", systemImage: "hourglass")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 4)
    }
}
