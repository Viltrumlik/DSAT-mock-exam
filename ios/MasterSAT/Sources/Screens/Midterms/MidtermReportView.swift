import SwiftUI
import MasterSATKit

/// One sat midterm: the score, and which skills cost it.
///
/// Two calls, run together — the review carries the certificate, the error report carries
/// the per-skill breakdown, and neither has the other. Both sit behind the same publication
/// gate, so if the teacher has not released the paper both refuse and the screen says so in
/// the server's own words rather than showing an empty report.
struct MidtermReportView: View {
    let attemptId: Int
    let title: String

    @Environment(Session.self) private var session
    @State private var result: MidtermResult?
    @State private var report: MidtermErrorReport?
    /// The report can be sealed while the review is not, so its failure is held separately —
    /// otherwise one 403 would blank a score the student is allowed to see.
    @State private var reportError: String?
    @State private var loadError: String?
    @State private var isLoading = true

    private var released: Bool { result?.released ?? (report != nil) }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if isLoading && result == nil && report == nil {
                    ProgressView().padding(.vertical, 60)
                } else if let loadError {
                    RetryNotice(message: loadError) { await load() }
                } else if released {
                    scoreHero
                    if let report { breakdown(report) }
                    else if let reportError { sealed(reportError, icon: "lock") }
                    certificate
                } else {
                    sealed("Your teacher will publish the results for this midterm.", icon: "hourglass")
                }
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    // MARK: - Score

    private var score: Double? { report?.score ?? result?.totalScore }
    private var ceiling: Double? { report?.midterm.scoreCeiling ?? result?.scoreCeiling }

    private var scoreHero: some View {
        VStack(spacing: 12) {
            Text("YOUR SCORE")
                .font(.system(size: 11, weight: .heavy))
                .tracking(1.2)
                .foregroundStyle(.white.opacity(0.8))

            HStack(alignment: .lastTextBaseline, spacing: 6) {
                Text(ScoreText.string(score))
                    .font(.system(size: 60, weight: .heavy).monospacedDigit())
                    .tracking(-1.5)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                if let ceiling {
                    Text("/ \(ScoreText.string(ceiling))")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white.opacity(0.75))
                }
            }

            HStack(spacing: 8) {
                if let subject = report?.midterm.subjectLabel ?? result?.subject?.humanisedSubject,
                   !subject.isEmpty {
                    heroChip(subject, icon: "book.closed")
                }
                // A pre-midterm is a diagnostic: scored, never judged. Showing a pass mark
                // on one would invent a verdict the centre never issued.
                if let report, report.isGraded, let passed = report.passed {
                    heroChip(
                        passed ? "Passed" : "Keep going",
                        icon: passed ? "checkmark.seal.fill" : "arrow.up.forward"
                    )
                }
            }

            if let report, report.totalCount > 0 {
                Text("\(ScoreText.string(report.correctCount)) of \(ScoreText.string(report.totalCount)) correct")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
            }
        }
        .padding(26)
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(
                colors: [Theme.accent, Theme.accentHover],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .background(Theme.accent)
        .overlay(alignment: .topTrailing) {
            Circle().fill(.white.opacity(0.08))
                .frame(width: 200, height: 200)
                .offset(x: 60, y: -80)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
    }

    private func heroChip(_ text: String, icon: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 10, weight: .bold))
            Text(text).font(.system(size: 12, weight: .heavy))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 11)
        .padding(.vertical, 5)
        .background(Capsule().fill(.white.opacity(0.2)))
    }

    // MARK: - Skills

    /// The error report, in the only order that helps: most marks lost first.
    ///
    /// Only skills that actually cost something appear — a skill answered perfectly is not
    /// an error, and listing it would bury the three that matter under fifteen that do not.
    @ViewBuilder
    private func breakdown(_ report: MidtermErrorReport) -> some View {
        HStack(spacing: 10) {
            ScoreBox(label: "Correct", value: report.correctCount, emphasised: true)
            ScoreBox(label: "To improve", value: report.wrongCount)
            ScoreBox(label: "Questions", value: report.totalCount)
        }

        VStack(alignment: .leading, spacing: 10) {
            CardHeading(
                icon: "target",
                title: "Skills to work on",
                subtitle: report.skills.isEmpty
                    ? "Nothing to review — every tagged question was correct."
                    : "Where the marks went, most first.",
                tone: Theme.warning
            )

            if report.skills.isEmpty {
                DashedEmpty(title: "A clean paper", hint: "No skill lost you marks on this one.")
            } else {
                ForEach(report.skills) { SkillRow(skill: $0) }
            }

            // Disclosed rather than folded into a skill: quietly under-reporting a skill's
            // question count would point revision at the wrong thing.
            if report.unclassifiedWrong > 0 {
                Text("\(ScoreText.string(report.unclassifiedWrong)) of \(ScoreText.string(report.unclassifiedTotal)) questions carry no skill tag, so they are not counted above.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
    }

    // MARK: - Certificate

    @ViewBuilder
    private var certificate: some View {
        if let cert = result?.certificate, cert.available {
            VStack(alignment: .leading, spacing: 10) {
                CardHeading(icon: "rosette", title: "Certificate", tone: Theme.success)
                if let rank = cert.rank, let cohort = cert.cohortSize {
                    Text("Ranked \(ScoreText.string(rank)) of \(ScoreText.string(cohort))")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
                if let raw = cert.downloadURL, let url = URL(string: raw) {
                    Link(destination: url) {
                        Label("Open certificate", systemImage: "arrow.up.right.square")
                            .font(.system(size: 14, weight: .bold))
                    }
                }
            }
            .cardStyle()
        }
    }

    private func sealed(_ message: String, icon: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 32))
                .foregroundStyle(Theme.warning)
            Text("Not released yet").font(.system(size: 17, weight: .bold))
            Text(message)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .cardStyle(padding: 28)
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        loadError = nil
        reportError = nil
        isLoading = true
        defer { isLoading = false }

        async let review = session.results.midtermResult(attemptId: attemptId)
        async let breakdown = session.results.midtermErrorReport(attemptId: attemptId)

        // Held separately on purpose: a sealed report must not blank a released score.
        do {
            report = try await breakdown
        } catch let error as APIError {
            report = nil
            reportError = error.errorDescription
        } catch {
            report = nil
            reportError = error.localizedDescription
        }

        do {
            result = try await review
        } catch let error as APIError {
            // Only a failure of BOTH is a failure of the screen.
            if report == nil { loadError = error.errorDescription }
        } catch {
            if report == nil { loadError = error.localizedDescription }
        }
    }
}

/// One skill and what it cost.
///
/// The bar shows how much of the skill was right, not how much was wrong: a student reading
/// their own report should be looking at ground held, with the gap visible beside it.
private struct SkillRow: View {
    let skill: MidtermErrorReport.SkillRow

    private var tone: Color {
        // Under half right is where revision genuinely has to start.
        skill.accuracy < 0.5 ? Theme.danger : Theme.warning
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(skill.skill)
                        .font(.system(size: 14, weight: .bold))
                        .multilineTextAlignment(.leading)
                    if let domain = skill.domain, !domain.isEmpty {
                        Text(domain)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                Spacer(minLength: 0)
                Text("\(ScoreText.string(skill.wrong)) of \(ScoreText.string(skill.total))")
                    .font(.system(size: 12, weight: .heavy).monospacedDigit())
                    .foregroundStyle(tone)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(tone.opacity(0.13)))
            }
            Bar(fraction: skill.accuracy, tone: tone, height: 6)
        }
        .cardStyle(padding: 14)
    }
}
