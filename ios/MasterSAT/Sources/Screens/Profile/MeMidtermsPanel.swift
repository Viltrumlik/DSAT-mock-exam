import SwiftUI
import MasterSATKit

/// A midterm certificate asked for from the Me sheet.
struct MeCertificate: Identifiable {
    let code: String
    let title: String
    var id: String { code }
}

/// Midterms & certificates: the three newest sittings whose score is out, each opening its
/// result, with "Passed" where the centre marked it and the certificate where one was issued.
///
/// It reads the list `MidtermsView` reads (`ProfileModel.midterms`). Every push is a value the
/// sheet's root declares. The certificate opens over the Me sheet itself (`onCertificate`), not
/// through `AppRouter`, whose one-sheet rule would close Me first and drop the student out of it.
struct MeMidtermsPanel: View {
    let model: ProfileModel
    let onRetry: @MainActor () async -> Void
    let onCertificate: (MeCertificate) -> Void

    var body: some View {
        ProfilePanel(
            icon: "rosette",
            tone: ProfileTone.emerald,
            title: "Midterms & certificates",
            description: "Your scores once they're released, and the certificates that come with them."
        ) {
            NavigationLink(value: AppLink.midterms) {
                HStack(spacing: 4) {
                    Text("All midterms")
                    Image(systemName: "arrow.right").appFont(11, weight: .bold)
                        .accessibilityHidden(true)
                }
            }
            .buttonStyle(AccountPillButtonStyle(kind: .quiet, tone: ProfileTone.primary))
        } content: {
            content
        }
    }

    @ViewBuilder private var content: some View {
        let load = model.midterms
        if load.isPending {
            LoadingSkeleton(rows: 2)
        } else if load.isFailed {
            ErrorState(title: "Your midterms didn't load.", style: .inline, retry: onRetry)
        } else {
            let rows = model.shownMidterms
            if rows.isEmpty {
                DashedEmpty(
                    title: "No midterm results yet",
                    hint: "Your scores and certificates show up here once they're released."
                )
            } else {
                VStack(spacing: 8) {
                    ForEach(rows) { midterm in
                        if let attemptId = midterm.attemptId {
                            row(midterm, attemptId: attemptId)
                        }
                    }
                }
            }
        }
    }

    /// The results' row, opening the sitting's result. The certificate button sits under it,
    /// outside the link, so the two never fight over one tap.
    private func row(_ midterm: MidtermListing, attemptId: Int) -> some View {
        let subject = MidtermWording.subjectLabel(midterm.subject)
        let title = midterm.title.isEmpty ? "Midterm" : midterm.title
        return VStack(alignment: .leading, spacing: 10) {
            NavigationLink(value: AppLink.midtermResult(attemptId: attemptId)) {
                ProfileScoreRow(
                    math: subject == MidtermWording.subjectLabel("MATH"),
                    title: title,
                    detail: subject,
                    score: ScoreText.string(midterm.releasedScore),
                    ceiling: midterm.scoreCeiling.map { ScoreText.string($0) },
                    passed: model.passed[attemptId] == true,
                    opens: true,
                    titleLines: 2
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint("Opens your result")

            if let code = midterm.certificateCode {
                Button {
                    onCertificate(MeCertificate(code: code, title: title))
                } label: {
                    Label("Certificate", systemImage: "rosette")
                }
                .buttonStyle(AccountPillButtonStyle(kind: .soft, tone: ProfileTone.emerald))
                // Under the paper's name, past the tile.
                .padding(.leading, 46)
                .accessibilityLabel("Certificate for \(title)")
            }
        }
        .profileRow()
    }
}
