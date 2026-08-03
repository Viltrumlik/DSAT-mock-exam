import SwiftUI
import MasterSATKit

/// The signed-out half of the app — the site's `/login` and `/register`.
///
/// The web puts a brand panel beside the form and hides it below `lg`. A phone has no
/// "beside", so the panel becomes a header band: the gradient, the mark and the promise
/// still arrive first, which is the whole job of it. On iPad, where the width is regular,
/// the two-column split comes back exactly as the site draws it.
///
/// Google and Telegram are not here. Both are browser flows that finish by setting a cookie
/// on the site, and a native client holds tokens instead — so the buttons would look like a
/// way in and be a dead end. Email and password sign in the same accounts either way.
struct AuthView: View {
    /// Why the session ended, when it ended on its own rather than by a tap. The web reads
    /// the same thing out of `authTabSync` and shows it above the form.
    let notice: String?

    @Environment(\.horizontalSizeClass) private var widthClass
    @State private var mode: Mode = .signIn
    @State private var noticeDismissed = false

    enum Mode { case signIn, register }

    private var isWide: Bool { widthClass == .regular }

    var body: some View {
        // Outside every `ignoresSafeArea`, so it can still report the inset the status bar
        // occupies — the band is drawn under the clock and needs to know by how much.
        GeometryReader { screen in
            let topInset = screen.safeAreaInsets.top
            Group {
                if isWide {
                    HStack(spacing: 0) {
                        panel(topInset: 48).frame(maxWidth: .infinity)
                        ScrollView {
                            // Centred against the panel beside it, the way the site's
                            // `items-center justify-center` main column sits. Left at the
                            // top it floats in a half-empty page on a portrait iPad.
                            form
                                .padding(.vertical, 40)
                                .frame(minHeight: screen.size.height, alignment: .center)
                        }
                        .frame(maxWidth: .infinity)
                    }
                } else {
                    // minHeight, so the sign-in form — which is short — does not leave the
                    // page top-heavy with a band of empty grey under it. The copyright
                    // takes the slack, exactly where the site's panel keeps it.
                    ScrollView {
                        VStack(spacing: 0) {
                            panel(topInset: topInset + 14)
                            form.padding(.top, 24)
                            Spacer(minLength: 16)
                            copyright.padding(.bottom, 18)
                        }
                        .frame(minHeight: screen.size.height + topInset)
                    }
                    // The band starts at the top of the screen, which means it also scrolls
                    // under the clock — and white-on-white, the lockup and the time land on
                    // top of each other. This holds the strip behind the status bar at the
                    // band's own colour so whatever passes under it is simply hidden.
                    .overlay(alignment: .top) {
                        Rectangle().fill(Brand.top).frame(height: topInset)
                    }
                }
            }
            .background(Theme.background)
            .ignoresSafeArea(.container, edges: isWide ? .all : .top)
            .scrollDismissesKeyboard(.interactively)
            .animation(.easeInOut(duration: 0.22), value: mode)
        }
    }

    @ViewBuilder
    private func panel(topInset: CGFloat) -> some View {
        switch mode {
        case .signIn:
            BrandPanel(
                headline: "Your digital SAT, mastered.",
                showsPromises: true,
                compact: !isWide,
                topInset: topInset
            )
        case .register:
            BrandPanel(
                headline: "Real past papers. Real scores. Real progress.",
                blurb: "Take a full-length diagnostic, get your predicted score, and focus on the exact domains where you're losing points.",
                // On a phone the register form is five fields tall. The pitch comes off
                // rather than pushing the first one below the fold.
                showsPromises: isWide,
                compact: !isWide,
                topInset: topInset
            )
        }
    }

    private var copyright: some View {
        Text("© \(ScoreText.string(Calendar.current.component(.year, from: Date()))) MasterSAT Center")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Theme.textLabel)
    }

    @ViewBuilder
    private var form: some View {
        Group {
            switch mode {
            case .signIn:
                SignInForm(notice: noticeDismissed ? nil : notice) {
                    noticeDismissed = true
                    mode = .register
                }
            case .register:
                RegisterForm { mode = .signIn }
            }
        }
        .frame(maxWidth: 460)
        .padding(.horizontal, 20)
        .padding(.bottom, 36)
    }
}

// MARK: - Sign in

private struct SignInForm: View {
    let notice: String?
    let onRegister: () -> Void

    @Environment(Session.self) private var session
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var retryable = false
    @State private var forgotOpen = false
    @FocusState private var focus: AuthFocus?

    private var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty && !session.isWorking
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Welcome back")
                .font(.system(size: 30, weight: .heavy))
                .tracking(-0.8)
                .padding(.bottom, 2)

            if let notice, error == nil {
                AuthAlert(tone: .warning, message: notice)
            }
            if let error {
                AuthAlert(tone: .danger, message: error) {
                    if retryable {
                        Button(action: submit) {
                            Label("Retry", systemImage: "arrow.clockwise")
                                .font(.system(size: 12, weight: .bold))
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.accent)
                        .disabled(session.isWorking)
                    }
                }
            }

            AuthField(label: "Email or username", icon: "envelope") {
                // `verbatim`, because a plain string placeholder is a LocalizedStringKey:
                // SwiftUI parses it as markdown, spots an address in it, and draws the hint
                // as a blue tappable link inside an empty field.
                TextField(text: $email, prompt: Text(verbatim: "name@example.com or username")) {
                    Text("Email or username")
                }
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focus = .password }
            }

            PasswordField(
                label: "Password",
                text: $password,
                focus: $focus,
                field: .password,
                onSubmit: { if canSubmit { submit() } }
            )

            HStack {
                Spacer()
                Button("Forgot password?") { forgotOpen.toggle() }
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.accent)
            }
            if forgotOpen {
                Text("Ask your teacher or the MasterSAT center to reset your password.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button(action: submit) {
                if session.isWorking {
                    ProgressView().tint(.white).frame(maxWidth: .infinity)
                } else {
                    Label("Sign in", systemImage: "rectangle.portrait.and.arrow.forward")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(!canSubmit)
            .padding(.top, 2)

            HStack(spacing: 5) {
                Text("Don't have an account?")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                Button("Register now", action: onRegister)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.accent)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
        }
    }

    private func submit() {
        focus = nil
        error = nil
        Task {
            do {
                try await session.signIn(
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password
                )
            } catch {
                let copy = AuthErrorCopy.classify(error)
                self.error = copy.message
                retryable = copy.retryable
            }
        }
    }
}

// MARK: - Register

private struct RegisterForm: View {
    let onSignIn: () -> Void

    @Environment(Session.self) private var session
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var username = ""
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    /// The server refused because someone of this name is already enrolled. Only staff can
    /// add a second, so the way out is to sign in — not to try a different spelling.
    @State private var duplicateName = false
    @FocusState private var focus: AuthFocus?

    private var canSubmit: Bool {
        !firstName.isEmpty && !lastName.isEmpty && !username.isEmpty
            && !email.isEmpty && !password.isEmpty && !session.isWorking
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Create your account")
                    .font(.system(size: 30, weight: .heavy))
                    .tracking(-0.8)
                Text("Join the MasterSAT program.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.bottom, 2)

            if let error {
                AuthAlert(tone: .danger, message: error) {
                    if duplicateName {
                        Button("Sign in instead", action: onSignIn)
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.accent)
                    }
                }
            }

            HStack(alignment: .top, spacing: 11) {
                AuthField(label: "First name") {
                    TextField("John", text: $firstName)
                        .textContentType(.givenName)
                        .focused($focus, equals: .firstName)
                        .submitLabel(.next)
                        .onSubmit { focus = .lastName }
                }
                AuthField(label: "Last name") {
                    TextField("Doe", text: $lastName)
                        .textContentType(.familyName)
                        .focused($focus, equals: .lastName)
                        .submitLabel(.next)
                        .onSubmit { focus = .username }
                }
            }

            AuthField(label: "Username", icon: "person") {
                TextField("johndoe123", text: $username)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .username)
                    .submitLabel(.next)
                    .onSubmit { focus = .email }
            }

            AuthField(label: "Email address", icon: "envelope") {
                TextField(text: $email, prompt: Text(verbatim: "name@example.com")) {
                    Text("Email address")
                }
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focus = .password }
            }

            PasswordField(
                label: "Password",
                text: $password,
                textContentType: .newPassword,
                focus: $focus,
                field: .password,
                onSubmit: { if canSubmit { submit() } }
            )

            Button(action: submit) {
                if session.isWorking {
                    ProgressView().tint(.white).frame(maxWidth: .infinity)
                } else {
                    Label("Create account", systemImage: "person.badge.plus")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(!canSubmit)
            .padding(.top, 2)

            HStack(spacing: 5) {
                Text("Already have an account?")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                Button("Sign in", action: onSignIn)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.accent)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
        }
    }

    private func submit() {
        focus = nil
        error = nil
        duplicateName = false

        // Checked here as well as on the server, because a round trip to be told a name is
        // two letters long is a round trip that did not need making. Same rule, same words.
        let first = firstName.trimmingCharacters(in: .whitespaces)
        let last = lastName.trimmingCharacters(in: .whitespaces)
        let user = username.trimmingCharacters(in: .whitespaces)
        guard first.count >= 3, last.count >= 3, user.count >= 3 else {
            error = "First name, last name, and username must be at least 3 characters."
            return
        }

        Task {
            do {
                try await session.register(
                    firstName: first,
                    lastName: last,
                    username: user,
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password
                )
            } catch APIError.validation(let detail, let code, _) {
                duplicateName = code == "duplicate_full_name"
                error = detail.isEmpty ? "Registration failed. Please check your details." : detail
            } catch {
                self.error = AuthErrorCopy.classify(error).message
            }
        }
    }
}
