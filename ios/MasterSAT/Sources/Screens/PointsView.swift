import SwiftUI
import MasterSATKit

/// Points and coins — the native counterpart of the site's `/rewards` page.
///
/// Reached from Profile rather than the tab bar, which mirrors the web: Points is a running
/// total worth glancing at, not a place you navigate to. The site keeps it out of the sidebar
/// and in the header for the same reason.
struct PointsView: View {
    @Environment(Session.self) private var session

    @State private var rewards: MyRewards?
    @State private var rules: [RewardRule] = []
    @State private var failed = false
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroHeader(
                    eyebrow: "Rewards",
                    eyebrowIcon: "sparkles",
                    title: "Points",
                    blurb: "What you've earned for showing up and doing the work.",
                    tiles: heroTiles
                ) { EmptyView() }

                if failed && rewards == nil {
                    // A failed fetch must never render as "you have nothing" — that reads as
                    // a punishment for work the student actually did.
                    ContentUnavailableView(
                        "Points aren't loading right now",
                        systemImage: "wifi.exclamationmark",
                        description: Text("Nothing has been lost — this screen just couldn't reach your total.")
                    )
                    .padding(.top, 24)
                } else {
                    earnings
                    if !rules.isEmpty { howToEarn }
                }
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("Points")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private var heroTiles: [HeroTile] {
        guard let r = rewards else { return [] }
        return [
            HeroTile("Points", icon: "star.fill", value: r.points),
            HeroTile("Coins", icon: "circle.circle.fill", value: r.coins),
            HeroTile("To next coin", icon: "arrow.up.forward", value: r.pointsToNextCoin),
        ]
    }

    @ViewBuilder private var earnings: some View {
        VStack(alignment: .leading, spacing: 14) {
            CardHeading(
                icon: "list.bullet.rectangle",
                title: "Your earnings",
                subtitle: "Every point you've picked up so far"
            )
            if let history = rewards?.history, !history.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(history.enumerated()), id: \.element.id) { index, award in
                        if index > 0 { Divider().padding(.leading, 4) }
                        AwardRow(award: award)
                    }
                }
            } else if loaded {
                DashedEmpty(title: "Nothing yet — but everything counts")
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 12)
            }
        }
        .cardStyle(padding: 18)
    }

    @ViewBuilder private var howToEarn: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeading(
                icon: "questionmark.circle",
                title: "How to earn",
                subtitle: "Served from the school's live rules"
            )
            ForEach(rules) { rule in
                HStack {
                    Text(rule.label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.textSecondary)
                    Spacer(minLength: 12)
                    Text("+\(rule.points)")
                        .font(.subheadline.weight(.heavy))
                        .foregroundStyle(Color.primary)
                }
                .padding(.vertical, 2)
            }
        }
        .cardStyle(padding: 18)
    }

    private func load() async {
        // The rules failing must not hide the balance: they are two requests and only one of
        // them is the answer to "how many points do I have".
        async let mine = session.rewards.me()
        async let theRules = session.rewards.rules()
        do {
            rewards = try await mine
            failed = false
        } catch {
            failed = true
        }
        rules = (try? await theRules) ?? []
        loaded = true
    }
}

private struct AwardRow: View {
    let award: PointAward

    private var when: String {
        guard let date = award.awardedDate else { return "" }
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("MMM d")
        return f.string(from: date)
    }

    private var subtitle: String {
        [award.classroomName, when].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(award.label)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Color.primary)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            Spacer(minLength: 12)
            Text("+\(award.points)")
                .font(.subheadline.weight(.heavy))
                .foregroundStyle(Theme.success)
        }
        .padding(.vertical, 10)
    }
}
