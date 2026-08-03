import SwiftUI
import UIKit
import MasterSATKit

/// Owns one sitting: creates the runner, routes by attempt state, and handles the two
/// things a phone does that a browser tab does not — leaving the foreground, and going to
/// sleep.
struct ExamContainerView: View {
    let attemptId: Int
    let backend: ExamBackend
    let onClose: () -> Void

    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var runner: ExamRunner?
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        Group {
            if let runner {
                content(runner)
            } else {
                ProgressView().task { await bootstrap() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard let runner else { return }
            switch phase {
            case .active:
                runner.isEnabled = true
            case .inactive, .background:
                // Leaving the foreground is the phone's version of closing the tab, and it
                // is the moment work is most likely to be lost: iOS can kill a backgrounded
                // app without warning. Stand the autosave down and push what we have.
                runner.isEnabled = false
                Task {
                    await runner.flushOnLeaving()
                    // On an invigilated sitting, leaving is also the reportable event. The
                    // server owns the tally — a count kept here would reset with the app,
                    // which is exactly what a student gaming the rule would do.
                    await runner.reportOffscreen()
                }
            @unknown default:
                break
            }
        }
        .onDisappear {
            pollTask?.cancel()
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    @ViewBuilder
    private func content(_ runner: ExamRunner) -> some View {
        if let attempt = runner.attempt {
            switch attempt.currentState {
            case .notStarted:
                ExamWelcomeView(attempt: attempt, runner: runner, onClose: onClose)
            case .scoring:
                ExamScoringView()
            case .completed:
                MockResultsView(attemptId: attemptId, onClose: onClose)
            case .abandoned:
                ExamEndedView(
                    title: "This sitting is closed",
                    message: "It was ended and cannot be reopened.",
                    onClose: onClose
                )
            default:
                if attempt.wasTerminated {
                    ExamEndedView(
                        title: "Your paper was collected",
                        message: "The sitting ended early and has been sent for scoring.",
                        onClose: onClose
                    )
                } else if attempt.onBreak {
                    ExamBreakView(runner: runner)
                } else if attempt.isModulePayloadMissing {
                    // "Active but no questions" is an error, not an empty exam. Never show
                    // a blank page a student could sit through and fail.
                    RetryNotice(message: "This module did not load.") { await runner.loadStatus() }
                } else {
                    ExamRunnerView(runner: runner, onClose: onClose)
                }
            }
        } else if let error = runner.lastError {
            RetryNotice(message: error.errorDescription ?? "Could not load this exam.") {
                await runner.loadStatus()
            }
        } else {
            ProgressView()
        }
    }

    private func bootstrap() async {
        let runner = ExamRunner(
            attemptId: attemptId,
            api: ExamAPI(client: session.client, backend: backend),
            backend: backend
        )
        self.runner = runner
        await runner.loadStatus()

        // An exam clock that keeps running while the screen sleeps is the server's rule;
        // letting the phone dim mid-passage just makes the student fight the device.
        UIApplication.shared.isIdleTimerDisabled = true

        pollTask = Task { await runner.poll() }
    }
}

struct ExamScoringView: View {
    var body: some View {
        VStack(spacing: 16) {
            ProgressView().controlSize(.large)
            Text("Scoring your exam").font(.headline)
            Text("This takes a moment. You can leave this screen — your answers are in.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
    }
}

struct ExamEndedView: View {
    let title: String
    let message: String
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "tray.and.arrow.down.fill")
                .font(.system(size: 40))
                .foregroundStyle(Theme.accent)
            Text(title).font(.title3.bold())
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Done", action: onClose)
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
        }
        .padding(32)
    }
}
