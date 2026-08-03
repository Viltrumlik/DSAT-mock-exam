import SwiftUI
import Combine
import MasterSATKit

/// Shown before the clock starts. The last screen where a student can still walk away.
struct ExamWelcomeView: View {
    let attempt: Attempt
    @Bindable var runner: ExamRunner
    let onClose: @MainActor () -> Void

    @State private var isStarting = false

    private var details: PracticeTestDetails { attempt.practiceTestDetails }

    /// From the whole-paper fields, never from `modules` — that list holds the ACTIVE
    /// section only and is empty on the screen shown before the exam starts, which is
    /// exactly this one. Counting it advertised a 0-module, 0-minute exam.
    private var moduleCount: Int {
        details.totalModuleCount ?? details.modules.count
    }

    private var totalMinutes: Int {
        details.totalTimeMinutes ?? details.modules.reduce(0) { $0 + $1.timeLimitMinutes }
    }

    /// What this paper is, in one line — built from whatever the backend actually sends.
    ///
    /// The three exam types describe themselves differently: a mock reports its whole
    /// shape, a midterm reports a question count, a past paper reports its modules. Show
    /// only the parts that are really there rather than printing a confident "0".
    private var shapeSummary: String {
        var parts: [String] = []
        if moduleCount > 0 { parts.append("\(moduleCount) module\(moduleCount == 1 ? "" : "s")") }
        if let questions = details.totalQuestionCount, questions > 0 {
            parts.append("\(questions) questions")
        }
        if totalMinutes > 0 { parts.append("\(totalMinutes) minutes") }
        return parts.isEmpty ? "" : parts.joined(separator: " · ")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(details.title).font(.title2.bold())
                    Text(shapeSummary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                VStack(alignment: .leading, spacing: 14) {
                    if runner.backend.supportsPause {
                        // A past paper is practice. Promising an unstoppable clock here
                        // would be both wrong and needlessly frightening.
                        rule("pause.circle", "You can stop any time", "Leaving pauses the clock. Pick it up again whenever you like.")
                    } else {
                        rule("timer", "The clock does not stop", "Once you start, it runs until the module ends — even if you close the app.")
                    }
                    rule("square.and.arrow.down", "Your answers save themselves", "Every answer is sent as you give it. You can lose signal and still be fine.")
                    rule("arrow.uturn.backward.circle", "Modules are one-way", "When you submit a module you cannot go back to it.")

                    // Asked of the BACKEND, not of the attempt: `proctored` is a mock-only
                    // field, and every midterm is invigilated without publishing one.
                    if runner.backend.policesOffscreen {
                        rule(
                            "eye",
                            "This sitting is invigilated",
                            "Leaving the app is recorded. \(attempt.offscreenLimit ?? 3) times ends the sitting and sends your paper for scoring."
                        )
                        guidedAccessHint
                    }
                }

                Button {
                    isStarting = true
                    Task {
                        await runner.start()
                        isStarting = false
                    }
                } label: {
                    if isStarting {
                        ProgressView().tint(.white).frame(maxWidth: .infinity)
                    } else {
                        Text("Start").bold().frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(Theme.accent)
                .disabled(isStarting)

                Button("Not now", action: onClose)
                    .frame(maxWidth: .infinity)
                    .tint(.secondary)
            }
            .padding(24)
        }
    }

    /// iOS has no equivalent of the browser's fullscreen lock — an app cannot stop the
    /// student leaving it. Guided Access is the platform's real answer, and it is the
    /// student's own device, so the honest move is to ask rather than to pretend the app
    /// can enforce it.
    private var guidedAccessHint: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Turn on Guided Access", systemImage: "lock.shield")
                .font(.subheadline.weight(.semibold))
            Text("Settings → Accessibility → Guided Access, then triple-click the side button here. It keeps you in the exam so you do not lose a chance by accident.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func rule(_ icon: String, _ title: String, _ body: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Theme.accent)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(body).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

/// The mock's break between the English and Math sections.
///
/// The break is a real, server-timed phase — not a pause. When it elapses the server moves
/// on with or without a tap, so the countdown here has to be honest about that.
struct ExamBreakView: View {
    @Bindable var runner: ExamRunner

    @State private var now = ExamClock.monotonicNow()
    @State private var isEnding = false
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var remaining: TimeInterval? {
        runner.attempt.flatMap { ExamClock.forBreak(attempt: $0) }?.remaining(at: now)
    }

    var body: some View {
        VStack(spacing: 22) {
            Spacer()

            Image(systemName: "cup.and.saucer.fill")
                .font(.system(size: 42))
                .foregroundStyle(Theme.accent)

            Text("Break").font(.title.bold())

            if let remaining {
                Text(ExamClock.format(remaining))
                    .font(.system(size: 52, weight: .bold, design: .rounded).monospacedDigit())
                    .contentTransition(.numericText())
            }

            Text("Math starts when you are ready, or when the break ends.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button {
                isEnding = true
                Task {
                    await runner.endBreak()
                    isEnding = false
                }
            } label: {
                if isEnding {
                    ProgressView().tint(.white).frame(maxWidth: .infinity)
                } else {
                    Text("Start Math").bold().frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(Theme.accent)
            .disabled(isEnding)

            Spacer()
        }
        .padding(28)
        .onReceive(tick) { _ in
            now = ExamClock.monotonicNow()
            // The server ends the break on its own schedule; poll across the boundary so
            // the student is moved into Math rather than left on a spent countdown.
            if let remaining, remaining <= 0 {
                Task { await runner.loadStatus() }
            }
        }
    }
}

struct MockResultsView: View {
    let attemptId: Int
    let onClose: @MainActor () -> Void

    @Environment(Session.self) private var session
    @State private var results: MockResults?
    @State private var loadError: String?

    var body: some View {
        VStack(spacing: 24) {
            if let results {
                Text(results.title ?? "Your result").font(.title3.bold())

                VStack(spacing: 4) {
                    Text(ScoreText.string(results.totalScore))
                        .font(.system(size: 68, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(Theme.accent)
                    Text("out of " + ScoreText.string(results.scoreCeiling ?? 1600))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 28) {
                    sectionScore("Reading & Writing", results.englishScore)
                    sectionScore("Math", results.mathScore)
                }

                Button("Done", action: onClose)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .tint(Theme.accent)
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
                Button("Close", action: onClose).tint(.secondary)
            } else {
                ProgressView().task { await load() }
            }
        }
        .padding(28)
    }

    private func sectionScore(_ title: String, _ value: Double?) -> some View {
        VStack(spacing: 2) {
            Text(ScoreText.string(value))
                .font(.title2.bold().monospacedDigit())
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
    }

    @MainActor
    private func load() async {
        loadError = nil
        do {
            results = try await ExamAPI(client: session.client, backend: .mocks).mockResults(attemptId: attemptId)
        } catch let error as APIError {
            // "Results not ready" is a 403 with the server's own wording, and it is a
            // normal state right after submitting — not a failure to apologise for.
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }
}
