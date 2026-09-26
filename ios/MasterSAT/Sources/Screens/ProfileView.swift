import SwiftUI
import MasterSATKit

/// The account, on the site's own hero.
///
/// A grouped `List` is the iOS default and looks nothing like the rest of the product, so
/// this is the hero idiom again: who you are, what you are aiming at, and the two things
/// worth doing from here.
struct ProfileView: View {
    let user: CurrentUser

    @Environment(Session.self) private var session
    @State private var isConfirmingSignOut = false
    @State private var openSurveys: Int?
    @State private var openEvents: Int?

    private var examDateText: String {
        guard let raw = user.satExamDate, let date = DayKey.date(from: raw) else { return "Not chosen" }
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("EEE MMM d yyyy")
        return f.string(from: date)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HeroHeader(
                        eyebrow: "Your account",
                        eyebrowIcon: "person.crop.circle",
                        title: user.displayName,
                        blurb: user.email,
                        tiles: [
                            HeroTile("Target", icon: "target", value: user.targetScore),
                            HeroTile("Exam day", icon: "calendar", value: examDateText),
                        ]
                    ) {
                        AvatarView(user: user)
                    }

                    VStack(alignment: .leading, spacing: 14) {
                        CardHeading(icon: "target", title: "Your goal", subtitle: "Set it from Home")
                        HStack(spacing: 10) {
                            ScoreBox(label: "Overall", value: user.targetScore, emphasised: true)
                            ScoreBox(label: "English", value: user.targetEnglish)
                            ScoreBox(label: "Math", value: user.targetMath)
                        }
                    }
                    .cardStyle(padding: 20)

                    // The web's account-menu rows on a phone. Surveys is always here, never
                    // gated on a count: on the web's phone layout this row is the only way to
                    // the surveys page, and a student who had answered everything could not
                    // reach it when it came and went. Points lives in the Rewards tab now.
                    ProfileLinkRow(
                        icon: "list.clipboard",
                        title: "Surveys",
                        subtitle: "Tell the learning center how it's going",
                        badge: openSurveys.flatMap { $0 > 0 ? "\($0) open" : nil }
                    ) {
                        SurveysListView()
                    }
                    ProfileLinkRow(
                        icon: "calendar",
                        title: "Events",
                        subtitle: "What's coming up, and your tickets",
                        badge: openEvents.flatMap { $0 > 0 ? "\($0) open" : nil }
                    ) {
                        EventsView()
                    }

                    VStack(alignment: .leading, spacing: 0) {
                        DetailRow(label: "Email", value: user.email)
                        Divider().padding(.leading, 4)
                        DetailRow(label: "SAT date", value: examDateText)
                        if let role = user.role, !role.isEmpty {
                            Divider().padding(.leading, 4)
                            DetailRow(label: "Role", value: role.humanisedSubject)
                        }
                    }
                    .cardStyle(padding: 16)

                    NavigationLink {
                        NotificationSettingsView()
                    } label: {
                        HStack(spacing: 13) {
                            IconTile(systemName: "bell.badge", tone: Theme.accent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Notifications")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(.primary)
                                Text("Reminders for homework, midterms and scores")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Theme.textSecondary)
                                    .multilineTextAlignment(.leading)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(Theme.textLabel)
                        }
                        .cardStyle()
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    Button("Sign out") { isConfirmingSignOut = true }
                        .buttonStyle(PrimaryButtonStyle(tone: Theme.danger, fullWidth: true))
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .task {
                // Badges only — nil (not fetched) shows no badge rather than a false "0 open".
                async let surveys = CommunityCounts.openSurveys(session)
                async let events = CommunityCounts.eventsOpenForSignUp(session)
                (openSurveys, openEvents) = await (surveys, events)
            }
            .confirmationDialog("Sign out of MasterSAT?", isPresented: $isConfirmingSignOut) {
                Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                Button("Cancel", role: .cancel) {}
            }
        }
    }
}

/// A row that opens a page: the tile, what it is, one line on what is behind it, and a count
/// when there is something open.
private struct ProfileLinkRow<Destination: View>: View {
    let icon: String
    let title: String
    let subtitle: String
    var badge: String?
    @ViewBuilder let destination: () -> Destination

    var body: some View {
        NavigationLink(destination: destination) {
            HStack(spacing: 13) {
                IconTile(systemName: icon, tone: Theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                if let badge {
                    Text(badge)
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Theme.accentSoft))
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
            .cardStyle()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
            Text(value)
                .font(.system(size: 14, weight: .bold))
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 11)
    }
}

struct AvatarView: View {
    let user: CurrentUser

    var body: some View {
        Group {
            if let raw = user.profileImageURL, let url = URL(string: raw) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initials
                }
            } else {
                initials
            }
        }
        .frame(width: 52, height: 52)
        .clipShape(Circle())
        .overlay(Circle().stroke(.white.opacity(0.5), lineWidth: 2))
    }

    private var initials: some View {
        ZStack {
            Circle().fill(.white.opacity(0.22))
            Text(user.initials).font(.system(size: 18, weight: .heavy)).foregroundStyle(.white)
        }
    }
}
