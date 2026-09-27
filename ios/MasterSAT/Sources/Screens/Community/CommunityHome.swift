import SwiftUI
import MasterSATKit

// What Home needs to show a banner or a badge only when something is open. Nothing here is
// wired in — Home and Profile belong to the integrator.

/// Counts for badges ("Surveys · 2 open", "Events · 1 open").
///
/// Nil means the count could not be fetched — NOT zero. A badge that turns a failed request
/// into "nothing open" tells a student there is no survey when there may be one waiting.
@MainActor
enum CommunityCounts {
    /// Surveys waiting for this student.
    static func openSurveys(_ session: Session) async -> Int? {
        try? await SurveysAPI(client: session.client).openCount()
    }

    /// Events the server says can be signed up for right now.
    static func eventsOpenForSignUp(_ session: Session) async -> Int? {
        try? await EventsAPI(client: session.client).openForSignUpCount()
    }
}

/// A Home card that exists only while a survey is waiting — the web's sign-in invite, in
/// the form of a card: the newest survey, what it pays, and one way in.
///
/// Zero points tall while loading, when nothing is open, and when the list could not be
/// fetched: a prompt has no duty to report a failure, and the surveys page itself says so.
/// Re-reads every time it appears, so an answered survey leaves Home on the way back.
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
            NavigationLink {
                SurveysWaitingDestination(surveyId: others > 0 ? nil : featured.id)
            } label: {
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

private struct SurveysWaitingDestination: View {
    let surveyId: Int?

    var body: some View {
        if let surveyId {
            SurveyFillView(surveyId: surveyId)
        } else {
            SurveysListView()
        }
    }
}

/// A Home card that exists only while an event is open for sign-up — the web's event invite:
/// the soonest one, when and where, the seats left, and the way to the events page.
///
/// Signing up happens there, not here: the page shows the row in full, including the warning
/// when a seat could no longer be given back.
struct EventsOpenCard: View {
    var refreshID: Int = 0

    @Environment(Session.self) private var session
    @State private var open: [LearningEvent] = []

    var body: some View {
        VStack(spacing: 0) {
            if let featured = open.first {
                card(featured)
            } else {
                Color.clear.frame(height: 0)
            }
        }
        .task(id: refreshID) { await load() }
    }

    private func card(_ featured: LearningEvent) -> some View {
        let whenWhere = [featured.startDate.map { CommunityFormat.when($0) }, featured.location.isEmpty ? nil : featured.location]
            .compactMap { $0 }
            .joined(separator: " · ")
        return VStack(alignment: .leading, spacing: 14) {
            CardHeading(
                icon: "calendar",
                title: "There's an event coming up",
                subtitle: "Take a seat now — there are only so many."
            )

            VStack(alignment: .leading, spacing: 4) {
                Text(featured.title)
                    .font(.system(size: 15, weight: .heavy))
                if !whenWhere.isEmpty {
                    Text(whenWhere)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                Text(CommunityFormat.count(featured.seatsLeft, "seat left", "seats left"))
                    .font(.system(size: 13, weight: .bold))
                    .padding(.top, 4)
            }

            NavigationLink {
                EventsView()
            } label: {
                Text("See all events")
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
        }
        .cardStyle(padding: 18)
    }

    private func load() async {
        guard let events = try? await EventsAPI(client: session.client).upcoming() else { return }
        // Soonest first, as the server orders them.
        open = events.filter(\.canSignUp)
    }
}
