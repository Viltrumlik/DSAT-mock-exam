import SwiftUI
import MasterSATKit

/// The site's `/surveys`: what the learning center is asking, and what each one pays.
///
/// Pushed, so it keeps the navigation bar (it carries Back) and draws its own headline in the
/// hero. Reloads every time it comes back into view: a survey just answered has to leave the
/// list, and the form it was answered in is a screen further up the same stack.
struct SurveysListView: View {
    @Environment(Session.self) private var session

    @State private var surveys: [SurveyBrief] = []
    @State private var phase: Phase = .loading

    private enum Phase { case loading, loaded, failed }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroHeader(
                    eyebrow: "Survey",
                    eyebrowIcon: "bubble.left.and.text.bubble.right",
                    title: "Surveys",
                    blurb: "Tell the learning center what you think. Each survey you finish earns you points.",
                    tiles: heroTiles
                )
                openNow
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .onAppear { Task { await load() } }
    }

    /// Only when there is something: a lone "0" in the masthead reads as a scoreboard of what
    /// the student has not done, and the card below already says it kindly.
    private var heroTiles: [HeroTile] {
        guard phase == .loaded, !surveys.isEmpty else { return [] }
        return [HeroTile(
            "Waiting for you",
            icon: "list.clipboard",
            value: CommunityFormat.count(surveys.count, "survey", "surveys")
        )]
    }

    private var openNow: some View {
        VStack(alignment: .leading, spacing: 14) {
            CardHeading(
                icon: "list.clipboard",
                title: "Open now",
                subtitle: "Surveys you haven't answered yet"
            )
            switch phase {
            case .loading:
                CommunitySkeletonRows()
            case .failed:
                CommunityErrorNotice(
                    title: "Couldn't load your surveys.",
                    message: "Your open surveys will be here as soon as the connection comes back."
                ) { await load() }
            case .loaded where surveys.isEmpty:
                DashedEmpty(
                    title: "Nothing to answer right now",
                    hint: "When the learning center publishes a survey, it will show up here."
                )
            case .loaded:
                VStack(spacing: 0) {
                    ForEach(Array(surveys.enumerated()), id: \.element.id) { index, survey in
                        if index > 0 { Divider() }
                        NavigationLink {
                            SurveyFillView(surveyId: survey.id, cameFromList: true)
                        } label: {
                            SurveyListRow(survey: survey)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .cardStyle(padding: 18)
    }

    private func load() async {
        // A reload keeps what is on screen until the answer arrives — no flash back to
        // placeholders every time the student returns from a form.
        if phase != .loaded { phase = .loading }
        do {
            surveys = try await SurveysAPI(client: session.client).open()
            phase = .loaded
        } catch {
            if phase != .loaded { phase = .failed }
        }
    }
}

/// One open survey: title, then "{n} questions · closes {Sep 3} · can be anonymous".
struct SurveyListRow: View {
    let survey: SurveyBrief

    private var meta: String {
        var parts = [CommunityFormat.count(survey.questionCount, "question", "questions")]
        if let closes = survey.closesDate { parts.append("closes \(CommunityFormat.dayMonth(closes))") }
        // Said before they open it, not after they have typed an opinion they would rather
        // not sign.
        if survey.allowAnonymous { parts.append("can be anonymous") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 12) {
            IconTile(systemName: "list.clipboard", size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(survey.title)
                    .font(.system(size: 15, weight: .heavy))
                    .foregroundStyle(Color.primary)
                    .lineLimit(2)
                Text(meta)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textLabel)
        }
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}
