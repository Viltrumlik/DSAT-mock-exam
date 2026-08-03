import SwiftUI
import MasterSATKit

struct RootView: View {
    @Environment(Session.self) private var session

    var body: some View {
        switch session.phase {
        case .launching:
            ProgressView().controlSize(.large)
        case .signedOut(let message):
            SignInView(message: message)
        case .signedIn(let user):
            RootTabView(user: user)
        }
    }
}

/// Four tabs.
///
/// The app deliberately does not host the timed sittings — mocks, midterms, past papers,
/// practice packs and the question bank are sat on a laptop, under exam conditions, and a
/// phone is the wrong instrument for a three-hour paper. What the phone IS good for is the
/// daily loop: what was set, working through it, and learning words. Midterm *results*
/// still land here, on Home, because a score is worth checking anywhere.
struct RootTabView: View {
    let user: CurrentUser

    var body: some View {
        TabView {
            DashboardView(user: user)
                .tabItem { Label("Home", systemImage: "house") }
            LearnHubView()
                .tabItem { Label("Learn", systemImage: "graduationcap") }
            VocabularyView()
                .tabItem { Label("Words", systemImage: "character.book.closed") }
            ProfileView(user: user)
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
        .tint(Theme.accent)
    }
}

/// Classwork: the class itself, what was set, and the quizzes inside it.
struct LearnHubView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    HubCard(
                        title: "Classroom",
                        subtitle: "Your class, classmates and shared files",
                        icon: "person.3.fill",
                        tone: Theme.accent,
                        destination: ClassesListView()
                    )
                    HubCard(
                        title: "Homework",
                        subtitle: "Everything your teachers have set",
                        icon: "checklist",
                        tone: Theme.info,
                        destination: HomeworkListView()
                    )
                    HubCard(
                        title: "Assessments",
                        subtitle: "Quizzes to work through",
                        icon: "square.and.pencil",
                        tone: Theme.success,
                        destination: AssessmentsListView()
                    )
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Learn")
        }
    }
}

struct HubCard<Destination: View>: View {
    let title: String
    let subtitle: String
    let icon: String
    let tone: Color
    let destination: Destination

    var body: some View {
        NavigationLink {
            destination
        } label: {
            HStack(spacing: 14) {
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(tone.opacity(0.12))
                    .frame(width: 46, height: 46)
                    .overlay(
                        Image(systemName: icon)
                            .font(.system(size: 19, weight: .semibold))
                            .foregroundStyle(tone)
                    )
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
                    Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textLabel)
            }
            .cardStyle()
        }
        .buttonStyle(.plain)
    }
}

struct SignInView: View {
    let message: String?

    @Environment(Session.self) private var session
    @State private var email = ""
    @State private var password = ""
    @FocusState private var focus: Field?

    private enum Field { case email, password }

    private var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty && !session.isWorking
    }

    var body: some View {
        VStack(spacing: 26) {
            Spacer()

            VStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Theme.accentSoft)
                    .frame(width: 72, height: 72)
                    .overlay(
                        Image(systemName: "graduationcap.fill")
                            .font(.system(size: 32, weight: .semibold))
                            .foregroundStyle(Theme.accent)
                    )
                Text("MasterSAT").font(.system(size: 30, weight: .bold))
                Text("Sign in to continue")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
            }

            VStack(spacing: 12) {
                TextField("Email", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focus = .password }

                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .focused($focus, equals: .password)
                    .submitLabel(.go)
                    .onSubmit { if canSubmit { submit() } }
            }
            .textFieldStyle(.roundedBorder)

            if let message {
                // The server's own wording, unedited — a teacher signing in here is told
                // to use the teacher portal, and a generic "sign-in failed" would strand
                // them.
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(Theme.danger)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button(action: submit) {
                if session.isWorking {
                    ProgressView().tint(.white).frame(maxWidth: .infinity)
                } else {
                    Text("Sign in").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(!canSubmit)

            Spacer()
        }
        .padding(24)
        .background(Theme.background)
    }

    private func submit() {
        focus = nil
        Task { await session.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password) }
    }
}
