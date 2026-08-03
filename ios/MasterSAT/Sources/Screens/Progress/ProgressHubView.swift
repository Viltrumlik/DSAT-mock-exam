import SwiftUI
import Charts
import MasterSATKit

/// Where the student stands: score history, subject split, and what they have sat.
///
/// Nothing here is estimated or projected. Every figure comes from a result that exists;
/// a section with no real data says so instead of drawing a flat line at zero.
struct ProgressHubView: View {
    let user: CurrentUser

    @Environment(Session.self) private var session
    @State private var model: Analytics = .empty
    @State private var isLoading = true
    @State private var loadError: String?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                } else if let loadError {
                    RetryNotice(message: loadError) { await load() }
                } else {
                    ScrollView {
                        VStack(spacing: 14) {
                            headline
                            if model.hasAnyResult {
                                chart
                                subjectBreakdown
                            } else {
                                ContentUnavailableView(
                                    "No results yet",
                                    systemImage: "chart.line.uptrend.xyaxis",
                                    description: Text("Sit a past paper and your progress will start showing here.")
                                )
                                .padding(.top, 24)
                            }
                            activity
                            certificateLookup
                        }
                        .padding(16)
                    }
                }
            }
            .navigationTitle("Progress")
            .refreshable { await load() }
            // `.task` fires once and a tab's view is never torn down, so a student who
            // sits a paper and comes straight here would be looking at the numbers from
            // whenever the app launched. Reload each time the tab is shown.
            .onAppear { Task { await load() } }
        }
    }

    private var headline: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Your score").font(.headline)
            HStack(alignment: .firstTextBaseline, spacing: 16) {
                figure("Latest", model.current)
                figure("Best", model.best)
                figure("Average", model.average)
            }
            if let target = model.target {
                Divider()
                HStack {
                    Text("Target \(ScoreText.string(target))").font(.subheadline)
                    Spacer()
                    if model.goalReached {
                        Label("Reached", systemImage: "checkmark.seal.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.green)
                    } else if let gap = model.gap {
                        Text("\(ScoreText.string(gap)) to go")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(Theme.accent)
                    }
                }
            }
        }
        .cardStyle()
    }

    private func figure(_ label: String, _ value: Double?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(ScoreText.string(value))
                .font(.title2.bold().monospacedDigit())
                .foregroundStyle(value == nil ? Color.secondary : Theme.accent)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }

    private var chart: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Score history").font(.headline)
                Spacer()
                if let delta = model.trendDelta, delta != 0 {
                    Label(
                        "\(delta > 0 ? "+" : "")\(ScoreText.string(delta))",
                        systemImage: delta > 0 ? "arrow.up.right" : "arrow.down.right"
                    )
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(delta > 0 ? .green : .secondary)
                }
            }
            Chart(model.history) { point in
                LineMark(x: .value("Attempt", point.label), y: .value("Score", point.score))
                    .foregroundStyle(Theme.accent)
                PointMark(x: .value("Attempt", point.label), y: .value("Score", point.score))
                    .foregroundStyle(Theme.accent)
            }
            .frame(height: 180)
            .chartYScale(domain: .automatic(includesZero: false))
        }
        .cardStyle()
    }

    private var subjectBreakdown: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("By subject").font(.headline)
            if model.subjects.isEmpty {
                Text("Sit papers in both subjects to compare them.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.subjects) { subject in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(subject.label).font(.subheadline.weight(.medium))
                            Text("\(subject.attempts) attempt\(subject.attempts == 1 ? "" : "s")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(ScoreText.string(subject.best))
                                .font(.subheadline.bold().monospacedDigit())
                            if let delta = subject.delta, delta != 0 {
                                Text("\(delta > 0 ? "+" : "")\(ScoreText.string(delta))")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(delta > 0 ? .green : .secondary)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .cardStyle()
    }

    private var activity: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("What you've done").font(.headline)
            HStack(spacing: 16) {
                counter("Past papers", model.totalAttempts)
                counter("Mocks", model.mocksSat)
                counter("Midterms", model.midtermsSat)
            }
            if model.homeworkTotal > 0 {
                Divider()
                HStack {
                    Text("Homework handed in").font(.subheadline)
                    Spacer()
                    Text("\(model.homeworkDone) of \(model.homeworkTotal)")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
        .cardStyle()
    }

    private func counter(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(ScoreText.string(value)).font(.title3.bold().monospacedDigit())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }

    private var certificateLookup: some View {
        NavigationLink {
            CertificateView()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "rosette").foregroundStyle(Theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Certificates").font(.subheadline.weight(.medium))
                    Text("Look one up by its code").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }
            .cardStyle()
        }
        .buttonStyle(.plain)
    }

    @MainActor
    private func load() async {
        isLoading = !model.hasAnyResult
        loadError = nil
        do {
            // Four independent reads; run them together rather than one after another,
            // because on a phone connection the serial version is visibly slow.
            async let attempts = session.student.pastpaperAttempts()
            async let mocks = session.student.mocks()
            async let midterms = session.student.midterms()
            async let assignments = session.student.assignments()
            model = Analytics.build(
                pastpaperAttempts: try await attempts,
                mocks: try await mocks,
                midterms: try await midterms,
                assignments: try await assignments,
                user: user
            )
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

/// A midterm result, which is publish-gated.
struct MidtermResultView: View {
    let attemptId: Int

    @Environment(Session.self) private var session
    @State private var result: MidtermResult?
    @State private var loadError: String?

    var body: some View {
        Group {
            if let result {
                ScrollView {
                    VStack(spacing: 16) {
                        if result.released, let score = result.totalScore {
                            VStack(spacing: 6) {
                                Text(ScoreText.string(score))
                                    .font(.system(size: 56, weight: .bold, design: .rounded))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.accent)
                                if let ceiling = result.scoreCeiling {
                                    Text("out of \(ScoreText.string(ceiling))")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                                if let subject = result.subject, !subject.isEmpty {
                                    Text(subject.humanisedSubject).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .cardStyle()
                        } else {
                            VStack(spacing: 8) {
                                Image(systemName: "hourglass")
                                    .font(.system(size: 36))
                                    .foregroundStyle(Theme.accent)
                                Text("Not released yet").font(.headline)
                                // Scored on submit, sealed until the teacher publishes.
                                // Saying so stops an absent score reading as a bad one.
                                Text("Your teacher will publish the results for this midterm.")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                            }
                            .cardStyle()
                        }

                        if let cert = result.certificate, cert.available {
                            VStack(alignment: .leading, spacing: 8) {
                                Label("Certificate", systemImage: "rosette")
                                    .font(.headline)
                                if let rank = cert.rank, let cohort = cert.cohortSize {
                                    Text("Ranked \(ScoreText.string(rank)) of \(ScoreText.string(cohort))")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                                if let raw = cert.downloadURL, let url = URL(string: raw) {
                                    Link(destination: url) {
                                        Label("Open certificate", systemImage: "arrow.up.right.square")
                                            .font(.subheadline.weight(.medium))
                                    }
                                }
                            }
                            .cardStyle()
                        }
                    }
                    .padding(16)
                }
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Midterm result")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @MainActor
    private func load() async {
        loadError = nil
        do {
            result = try await session.practice.midtermResult(attemptId: attemptId)
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }
}

/// Look up a certificate by the code printed on it.
struct CertificateView: View {
    @Environment(Session.self) private var session
    @State private var code = ""
    @State private var certificate: CertificateDetail?
    @State private var isLooking = false
    @State private var errorText: String?

    var body: some View {
        List {
            Section {
                HStack(spacing: 10) {
                    TextField("Certificate code", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.search)
                        .onSubmit { look() }
                    Button(action: look) {
                        if isLooking {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Find").bold()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || isLooking)
                }
            } footer: {
                if let errorText {
                    Text(errorText).foregroundStyle(.red)
                } else {
                    Text("The code is printed on the certificate itself.")
                }
            }

            if let certificate {
                Section("Certificate") {
                    if let name = certificate.studentName, !name.isEmpty {
                        LabeledContent("Student", value: name)
                    }
                    if let title = certificate.midtermTitle, !title.isEmpty {
                        LabeledContent("Midterm", value: title)
                    }
                    if let score = certificate.score {
                        LabeledContent(
                            "Score",
                            value: certificate.scoreCeiling.map { "\(ScoreText.string(score)) / \(ScoreText.string($0))" }
                                ?? ScoreText.string(score)
                        )
                    }
                    if let rank = certificate.rank, let cohort = certificate.cohortSize {
                        LabeledContent("Rank", value: "\(ScoreText.string(rank)) of \(ScoreText.string(cohort))")
                    }
                    if let raw = certificate.downloadURL, let url = URL(string: raw) {
                        Link(destination: url) {
                            Label("Open the PDF", systemImage: "arrow.up.right.square")
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Certificates")
        .navigationBarTitleDisplayMode(.inline)
    }

    @MainActor
    private func look() {
        isLooking = true
        errorText = nil
        certificate = nil
        Task {
            defer { isLooking = false }
            do {
                certificate = try await session.practice.certificate(
                    code: code.trimmingCharacters(in: .whitespaces)
                )
            } catch let error as APIError {
                errorText = error.errorDescription
            } catch {
                errorText = error.localizedDescription
            }
        }
    }
}
