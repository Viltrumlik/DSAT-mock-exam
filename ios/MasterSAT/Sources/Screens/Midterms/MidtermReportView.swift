import SwiftUI
import MasterSATKit

/// One sat midterm: the score, the certificate, and which skills (or topics) cost marks.
///
/// Two calls, run together — the review carries the score and the certificate, the error
/// report carries the breakdown, and neither has the other. Both sit behind the same
/// publication gate. The report can also be missing for its own reasons (a sitting scored
/// before per-question results were kept), so its failure is held apart from the score's: a
/// report that cannot be shown must never blank a score the student is allowed to see.
struct MidtermReportView: View {
    let attemptId: Int
    /// The paper's name when the caller knows it; the report's own title replaces it.
    var title: String = ""

    @Environment(Session.self) private var session
    @State private var result: MidtermResult?
    @State private var report: MidtermErrorReport?
    @State private var reportProblem: MidtermReportUnavailable?
    @State private var loadError: String?
    @State private var isLoading = true
    @State private var pdf: PDFRequest?

    /// Which PDF the sheet is showing.
    private enum PDFRequest: String, Identifiable {
        case certificate, report
        var id: String { rawValue }
    }

    private var released: Bool { result?.released ?? (report != nil) }
    private var heading: String {
        if let name = report?.midterm.title, !name.isEmpty { return name }
        return title.isEmpty ? "Midterm result" : title
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Overline("Midterm result")
                    Text(heading)
                        .font(.system(size: 26, weight: .heavy))
                        .tracking(-0.6)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if isLoading && result == nil && report == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60)
                } else if let loadError {
                    RetryNotice(message: loadError) { await load() }
                } else if released {
                    scoreHero
                    reportSection
                } else {
                    notice(
                        icon: "clock",
                        title: "Submitted",
                        message: "Your answers are in. Your teacher will release the results and your certificate shortly."
                    )
                }
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .sheet(item: $pdf) { request in
            switch request {
            case .certificate:
                CertificatePDFSheet(title: "Certificate", fileName: "Certificate — \(heading)") {
                    try await certificateData()
                }
            case .report:
                CertificatePDFSheet(title: "Error report", fileName: "Error report — \(heading)") {
                    try await CertificateAPI(client: session.client).midtermErrorReport(attemptId: attemptId)
                }
            }
        }
    }

    // MARK: - Score

    private var score: Double? { result?.totalScore ?? report?.score }
    private var ceiling: Double? { result?.scoreCeiling ?? report?.midterm.scoreCeiling }
    private var certificate: CertificateInfo? { result?.certificate }

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

            if let rank = certificate?.rank {
                Text(certificate?.cohortSize.map { "Class rank \(ScoreText.string(rank)) of \(ScoreText.string($0))" }
                     ?? "Class rank \(ScoreText.string(rank))")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.9))
            }

            HStack(spacing: 8) {
                if let subject = report?.midterm.subjectLabel ?? result?.subject.map(MidtermWording.subjectLabel),
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

            if certificate?.available == true {
                Button { pdf = .certificate } label: {
                    Label("Download certificate", systemImage: "arrow.down.doc.fill")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 11)
                        .background(Capsule().fill(.white))
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
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

    /// The certificate by its `download_url`, falling back to its code.
    private func certificateData() async throws -> Data {
        let api = CertificateAPI(client: session.client)
        if let url = certificate?.downloadURL, !url.isEmpty {
            return try await api.pdf(downloadURL: url)
        }
        guard let code = certificate?.code, !code.isEmpty else {
            throw APIError.http(status: 404, detail: "This certificate is not available.")
        }
        return try await api.midtermCertificate(code: code)
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

    // MARK: - The error report

    @ViewBuilder
    private var reportSection: some View {
        if let report {
            breakdown(report)
        } else if let reportProblem {
            switch reportProblem {
            case .sealed(let message):
                notice(icon: "lock", title: "Not released yet", message: message)
            case .notAnalysed:
                notice(
                    icon: "list.bullet.rectangle",
                    title: "No breakdown for this sitting",
                    message: "A skill breakdown is not available for this attempt — it was scored before each question's result was kept. Your score above is unaffected."
                )
            case .failed:
                VStack(spacing: 4) {
                    RetryNotice(message: "Your error report is not available for this attempt.") { await load() }
                }
            }
        }
    }

    /// The report, in the order the centre's sheet uses: who and what, the numbers, then
    /// the skills that cost marks, most first, then every skill the paper tested.
    @ViewBuilder
    private func breakdown(_ report: MidtermErrorReport) -> some View {
        let noun = report.noun
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Overline("Error report")
                    Text(
                        [report.studentName, report.midterm.subjectLabel, report.date]
                            .filter { !$0.isEmpty }
                            .joined(separator: " · ")
                    )
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Button { pdf = .report } label: {
                    Label("Download report", systemImage: "arrow.down.doc")
                        .font(.system(size: 13, weight: .bold))
                }
                .buttonStyle(SecondaryButtonStyle())
            }

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                if report.isGraded, let score = report.score {
                    MidtermStatTile(
                        label: "Score",
                        value: ScoreText.string(score),
                        sub: report.passMark.map { "Pass mark \(ScoreText.string($0))" }
                            ?? report.midterm.scoreCeiling.map { "of \(ScoreText.string($0))" }
                    )
                }
                MidtermStatTile(
                    label: "Correct",
                    value: "\(ScoreText.string(report.correctCount))/\(ScoreText.string(report.totalCount))",
                    sub: "\(report.accuracyPercent)% accuracy"
                )
                MidtermStatTile(label: "To improve", value: ScoreText.string(report.wrongCount), sub: nil)
                MidtermStatTile(
                    label: "Focus \(noun)s",
                    value: ScoreText.string(report.skills.count),
                    sub: report.skills.count == 1 ? "\(noun) to work on" : "\(noun)s to work on"
                )
            }
        }
        .cardStyle()

        VStack(alignment: .leading, spacing: 10) {
            CardHeading(
                icon: "target",
                title: "\(report.nounPluralTitle) to work on",
                subtitle: "Only \(noun)s with questions to revisit, from most to least.",
                tone: Theme.warning
            )

            if report.skills.isEmpty {
                if report.unclassifiedTotal > 0 {
                    DashedEmpty(
                        title: "No \(noun) breakdown for this midterm",
                        hint: "These questions have not been classified by \(noun) yet, so your mistakes cannot be broken down. Ask your teacher to walk through the paper with you."
                    )
                } else {
                    DashedEmpty(
                        title: "A clean paper",
                        hint: "You did not miss a single question, so there is nothing to plot here. Keep the same routine for the next one."
                    )
                }
            } else {
                ForEach(report.skills) { SkillRow(skill: $0) }
            }

            // Disclosed rather than folded into a skill: quietly under-reporting a skill's
            // question count would point revision at the wrong thing.
            if report.unclassifiedWrong > 0 {
                Label(
                    "\(ScoreText.string(report.unclassifiedWrong)) of your \(ScoreText.string(report.wrongCount)) mistakes came from questions that are not tagged to a \(noun) yet, so they are not in the list above.",
                    systemImage: "info.circle"
                )
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
            }
        }

        if !report.covered.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                CardHeading(
                    icon: "checklist",
                    title: "\(report.nounPluralTitle) in this paper",
                    subtitle: "Every \(noun) this midterm tested, and how many of its questions you got right.",
                    tone: Theme.success
                )
                VStack(spacing: 0) {
                    ForEach(Array(report.covered.enumerated()), id: \.element.id) { index, skill in
                        if index > 0 { Divider() }
                        CoveredRow(skill: skill)
                    }
                }
                .cardStyle(padding: 12)
            }
        }
    }

    private func notice(icon: String, title: String, message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 30))
                .foregroundStyle(Theme.warning)
            Text(title).font(.system(size: 17, weight: .bold))
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
        isLoading = true
        defer { isLoading = false }

        async let review = session.results.midtermResult(attemptId: attemptId)
        async let breakdown = session.results.midtermErrorReport(attemptId: attemptId)

        // Held separately on purpose: a missing report must not blank a released score.
        do {
            report = try await breakdown
            reportProblem = nil
        } catch {
            report = nil
            reportProblem = MidtermReportUnavailable(error)
        }

        do {
            result = try await review
        } catch let error as APIError {
            // Only a failure of BOTH is a failure of the screen.
            if report == nil { loadError = error.errorDescription ?? "Result not available yet." }
        } catch {
            if report == nil { loadError = error.localizedDescription }
        }
    }
}

/// One box of the report's numbers: an overline, the value, and a line under it.
private struct MidtermStatTile: View {
    let label: String
    let value: String
    let sub: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .heavy))
                .tracking(1.1)
                .foregroundStyle(Theme.textLabel)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(value)
                .font(.system(size: 24, weight: .heavy).monospacedDigit())
                .tracking(-0.6)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let sub {
                Text(sub)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(13)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.background))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
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

/// One skill the paper tested: right out of total, and a tick when every question was right.
private struct CoveredRow: View {
    let skill: MidtermErrorReport.SkillRow

    private var full: Bool { skill.wrong == 0 }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: full ? "checkmark.circle.fill" : "circle.fill")
                .font(.system(size: full ? 15 : 7))
                .foregroundStyle(full ? Theme.success : Theme.warning)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(skill.skill)
                    .font(.system(size: 14, weight: .semibold))
                    .multilineTextAlignment(.leading)
                if let domain = skill.domain, !domain.isEmpty {
                    Text(domain)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            Spacer(minLength: 0)
            Text("\(ScoreText.string(skill.correct))/\(ScoreText.string(skill.total))")
                .font(.system(size: 13, weight: .heavy).monospacedDigit())
                .foregroundStyle(full ? Theme.success : Theme.textSecondary)
        }
        .padding(.vertical, 9)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(skill.skill): \(skill.correct) of \(skill.total) correct")
    }
}
