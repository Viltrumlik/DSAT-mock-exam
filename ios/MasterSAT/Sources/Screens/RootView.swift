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

struct RootTabView: View {
    let user: CurrentUser

    var body: some View {
        TabView {
            DashboardView(user: user)
                .tabItem { Label("Home", systemImage: "house") }
            HomeworkListView()
                .tabItem { Label("Homework", systemImage: "checklist") }
            ExamsListView()
                .tabItem { Label("Exams", systemImage: "doc.text") }
            VocabularyView()
                .tabItem { Label("Words", systemImage: "character.book.closed") }
            ProfileView(user: user)
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
        .tint(Theme.accent)
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
