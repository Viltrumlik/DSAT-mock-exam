import SwiftUI
import MasterSATKit

// What Today shows only while something is waiting: the survey prompt.

/// A Today card that exists only while a survey is waiting — the web's sign-in invite, in
/// the form of a card: the newest survey, what it pays, and one way in.
///
/// Zero points tall while loading, when nothing is open, and when the list could not be
/// fetched: a prompt has no duty to report a failure, and the surveys page itself says so.
/// Re-reads every time it appears, so an answered survey leaves Today on the way back.
struct SurveysWaitingCard: View {
    var refreshID: Int = 0

    @Environment(Session.self) private var session
    @State private var waiting: [SurveyBrief] = []

    var body: some View {
        VStack(spacing: 0) {
            if let featured = waiting.first {
                card(featured)
            } else {
                Color.clear.frame(height: 0)
            }
        }
        .task(id: refreshID) { await load() }
    }

    private func card(_ featured: SurveyBrief) -> some View {
        let others = waiting.count - 1
        return VStack(alignment: .leading, spacing: 14) {
            CardHeading(
                icon: "list.clipboard",
                title: "You have a survey waiting",
                subtitle: "Tell the learning center how it's going — it stays between you and the office."
            )

            VStack(alignment: .leading, spacing: 4) {
                Text(featured.title)
                    .font(.system(size: 15, weight: .heavy))
                Text(SurveyListRow.meta(featured))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }

            // Read from the survey, never assumed: an admin can price one at anything,
            // including nothing.
            if featured.pointsAward > 0 {
                HStack(spacing: 6) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.amber)
                        .accessibilityHidden(true)
                    Text("Finishing it earns you \(ScoreText.string(featured.pointsAward)) points.")
                        .font(.system(size: 14, weight: .bold))
                }
            } else {
                Text("It only takes a minute.")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }

            if others > 0 {
                Text("And \(ScoreText.string(others)) more \(others == 1 ? "survey is" : "surveys are") waiting after this one.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }

            // One survey opens its form; several open the list, as the web's button does.
            NavigationLink(value: others > 0 ? AppLink.surveys : AppLink.survey(id: featured.id)) {
                Text("Take the survey")
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
        }
        .cardStyle(padding: 18)
    }

    private func load() async {
        guard let open = try? await SurveysAPI(client: session.client).open() else { return }
        waiting = open
    }
}
