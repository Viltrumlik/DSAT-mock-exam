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

                    Button("Sign out") { isConfirmingSignOut = true }
                        .buttonStyle(PrimaryButtonStyle(tone: Theme.danger, fullWidth: true))
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .confirmationDialog("Sign out of MasterSAT?", isPresented: $isConfirmingSignOut) {
                Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                Button("Cancel", role: .cancel) {}
            }
        }
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
