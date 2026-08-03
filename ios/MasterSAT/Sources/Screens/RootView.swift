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

/// Five tabs, grouped the way the web sidebar groups them.
///
/// The web has ten student routes. Ten tabs is not an option on a phone, and burying nine
/// of them behind a "More" list is worse than a shallow grouping, so Learn and Practice
/// are hubs — the same split the sidebar already makes between "Learn" and "Simulation".
struct RootTabView: View {
    let user: CurrentUser

    var body: some View {
        TabView {
            DashboardView(user: user)
                .tabItem { Label("Home", systemImage: "house") }
            LearnHubView()
                .tabItem { Label("Learn", systemImage: "graduationcap") }
            PracticeHubView()
                .tabItem { Label("Practice", systemImage: "play.rectangle") }
            ProgressHubView(user: user)
                .tabItem { Label("Progress", systemImage: "chart.line.uptrend.xyaxis") }
            ProfileView(user: user)
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
        .tint(Theme.accent)
    }
}

/// Classwork: the class itself, what was set, and the words to learn.
struct LearnHubView: View {
    var body: some View {
        NavigationStack {
            List {
                Section {
                    HubRow(
                        title: "Classroom",
                        subtitle: "Your classes, classmates and shared files",
                        icon: "person.3",
                        destination: ClassesListView()
                    )
                    HubRow(
                        title: "Homework",
                        subtitle: "Everything your teachers have set",
                        icon: "checklist",
                        destination: HomeworkListView()
                    )
                    HubRow(
                        title: "Assessments",
                        subtitle: "Quizzes to work through",
                        icon: "square.and.pencil",
                        destination: AssessmentsListView()
                    )
                    HubRow(
                        title: "Vocabulary",
                        subtitle: "Word sets and your own lists",
                        icon: "character.book.closed",
                        destination: VocabularyView()
                    )
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Learn")
        }
    }
}

/// Everything a student can sit under their own steam.
struct PracticeHubView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Full sittings") {
                    HubRow(
                        title: "Mock exams",
                        subtitle: "A full test day, scored out of 1600",
                        icon: "doc.text",
                        destination: MocksScreen()
                    )
                    HubRow(
                        title: "Midterms",
                        subtitle: "Scheduled class papers",
                        icon: "flag.checkered",
                        destination: MidtermsScreen()
                    )
                    HubRow(
                        title: "Invigilated sitting",
                        subtitle: "Join with the code your teacher reads out",
                        icon: "person.badge.key",
                        destination: SittingsView()
                    )
                }
                Section("Practice") {
                    HubRow(
                        title: "Past papers",
                        subtitle: "Practice papers you can pause",
                        icon: "tray.full",
                        destination: PastpapersScreen()
                    )
                    HubRow(
                        title: "Practice tests",
                        subtitle: "Curated sets of sections",
                        icon: "flask",
                        destination: PracticePacksView()
                    )
                    HubRow(
                        title: "Question bank",
                        subtitle: "Single questions, by skill",
                        icon: "square.stack.3d.up",
                        destination: QuestionBankView()
                    )
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Practice")
        }
    }
}

struct HubRow<Destination: View>: View {
    let title: String
    let subtitle: String
    let icon: String
    let destination: Destination

    var body: some View {
        NavigationLink {
            destination
        } label: {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 17))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body.weight(.medium))
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
        }
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
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 8) {
                Image(systemName: "graduationcap.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(Theme.accent)
                Text("MasterSAT").font(.largeTitle.bold())
                Text("Sign in to continue").foregroundStyle(.secondary)
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
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button(action: submit) {
                if session.isWorking {
                    ProgressView().tint(.white).frame(maxWidth: .infinity)
                } else {
                    Text("Sign in").bold().frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(Theme.accent)
            .disabled(!canSubmit)

            Spacer()
        }
        .padding(24)
    }

    private func submit() {
        focus = nil
        Task { await session.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password) }
    }
}
