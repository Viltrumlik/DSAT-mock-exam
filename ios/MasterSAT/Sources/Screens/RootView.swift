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
///
/// The site's sidebar splits Learn from Simulation; the app has no simulation, so Learn is
/// the whole of it and gets a page rather than a menu — each card says what is behind it
/// and how much of it there is.
struct LearnHubView: View {
    @Environment(Session.self) private var session
    @State private var assignments: [AssignmentListing] = []
    @State private var classroomCount: Int?

    private var openHomework: Int {
        assignments.filter { ($0.workflowStatus ?? "").lowercased() != "graded" }.count
    }

    private var openAssessments: Int {
        assignments
            .flatMap(\.assessmentHomeworks)
            .filter { ($0.progress?.state ?? "not_started") != "completed" }
            .count
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    PageTitle("Learn")

                    HubCard(
                        title: "Classroom",
                        subtitle: "Your class, classmates and shared files",
                        icon: "person.3.fill",
                        tone: Theme.accent,
                        count: classroomCount,
                        destination: ClassesListView()
                    )
                    HubCard(
                        title: "Homework",
                        subtitle: "Everything your teachers have set",
                        icon: "checklist",
                        tone: Theme.info,
                        count: openHomework,
                        destination: HomeworkListView()
                    )
                    HubCard(
                        title: "Assessments",
                        subtitle: "Quizzes to work through",
                        icon: "square.and.pencil",
                        tone: Theme.success,
                        count: openAssessments,
                        destination: AssessmentsListView()
                    )
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Learn")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .onAppear { Task { await load() } }
            .refreshable { await load() }
        }
    }

    @MainActor
    private func load() async {
        // Counts only — a failure here leaves the cards without badges, which is a far
        // better outcome than a hub that refuses to draw.
        assignments = (try? await session.student.assignments()) ?? []
        classroomCount = (try? await session.classrooms.classrooms())?.count
    }
}

struct HubCard<Destination: View>: View {
    let title: String
    let subtitle: String
    let icon: String
    let tone: Color
    var count: Int?
    let destination: Destination

    var body: some View {
        NavigationLink {
            destination
        } label: {
            HStack(spacing: 14) {
                IconTile(systemName: icon, tone: tone, size: 46)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 16, weight: .heavy)).foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                // Zero is not shown: an empty badge says "nothing waiting" better than a
                // grey 0, which reads as a score.
                if let count, count > 0 {
                    Text(ScoreText.string(count))
                        .font(.system(size: 12, weight: .heavy).monospacedDigit())
                        .foregroundStyle(tone)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(tone.opacity(0.13)))
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card)
            .overlay(alignment: .leading) { Rectangle().fill(tone).frame(width: 3) }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
            .contentShape(Rectangle())
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
