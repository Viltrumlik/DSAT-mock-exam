import SwiftUI
import MasterSATKit

struct ProfileView: View {
    let user: CurrentUser
    @Environment(Session.self) private var session
    @State private var isConfirmingSignOut = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        AvatarView(user: user)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.displayName).font(.headline)
                            Text(user.email).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section("Goals") {
                    LabeledContent("Target score", value: ScoreText.string(user.targetScore))
                    LabeledContent("Reading & Writing", value: ScoreText.string(user.targetEnglish))
                    LabeledContent("Math", value: ScoreText.string(user.targetMath))
                    LabeledContent("SAT date", value: user.satExamDate ?? "—")
                }

                Section {
                    Button("Sign out", role: .destructive) { isConfirmingSignOut = true }
                }
            }
            .navigationTitle("Profile")
            .confirmationDialog("Sign out of MasterSAT?", isPresented: $isConfirmingSignOut) {
                Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                Button("Cancel", role: .cancel) {}
            }
        }
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
    }

    private var initials: some View {
        ZStack {
            Circle().fill(Theme.accent.opacity(0.15))
            Text(user.initials).font(.headline).foregroundStyle(Theme.accent)
        }
    }
}
