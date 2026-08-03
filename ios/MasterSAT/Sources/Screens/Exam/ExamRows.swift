import SwiftUI
import MasterSATKit

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
