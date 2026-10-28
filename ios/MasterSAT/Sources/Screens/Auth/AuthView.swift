import SwiftUI
import MasterSATKit

/// The signed-out half of the app: one quiet page, and the only way in.
///
/// There is no Register form and no marketing panel. Every student here was enrolled by the
/// learning centre, which created the account — so there is nothing to sell and nothing to
/// sign up for, and the page is the shape of what is left: a mark, two fields and a button.
/// The two lines under them are text, not buttons, because the centre does both jobs (resets
/// a password, creates an account) and a tappable version would promise a channel the app
/// does not have.
///
/// One identity field, not three. The server resolves an address, a username and a phone
/// number on the same endpoint, so splitting them here would lock out two of the three ways in.
///
/// Google and Telegram are not here. Both are browser flows that finish by setting a cookie
/// on the site, and a native client holds tokens instead — so the buttons would look like a
/// way in and be a dead end.
struct AuthView: View {
    /// Why the session ended, when it ended on its own rather than by a tap. The web reads
    /// the same thing out of `authTabSync` and shows it above the form.
    let notice: String?

    @Environment(Session.self) private var session
    /// Whatever the student types to be recognised: a phone number, an address or a username.
    @State private var identity = ""
    @State private var password = ""
    @State private var error: String?
    @State private var retryable = false
    /// The notice is about the session that just ended; once they have tried to sign in again
    /// it is about nothing, so it goes.
    @State private var noticeDismissed = false
    @FocusState private var focus: AuthFocus?
    /// Bumped when the server said the identity or password is wrong: the password box shakes and
    /// a warning haptic plays. Other failures (offline, throttled) only say so.
    @State private var refusals = 0
    /// The last attempt was refused: the password box is drawn red until it is edited (mockup 02).
    @State private var passwordRefused = false
    /// The sign-in on its way. A second tap cancels the first, so two attempts never race to
    /// set the same error.
    @State private var attempt: Task<Void, Never>?

    private var canSubmit: Bool {
        !identity.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty && !session.isWorking
    }

    var body: some View {
        GeometryReader { screen in
            let top = screen.safeAreaInsets.top
            ScrollView {
                // The page is short, so it is centred rather than left at the top — and
                // `minHeight` is what lets the keyboard push it up instead of covering the
                // password box. The copyright takes the slack at the bottom.
                VStack(spacing: 0) {
                    // The new look's blue top (mockup 01), under the status bar too.
                    AuthBand(height: min(330, (screen.size.height + top) * 0.38))
                    form
                        .padding(.top, 28)
                    Spacer(minLength: 28)
                    copyright
                }
                .frame(minHeight: screen.size.height + top)
                .frame(maxWidth: .infinity)
                .padding(.bottom, 12)
            }
            .ignoresSafeArea(.container, edges: .top)
            .scrollDismissesKeyboard(.interactively)
        }
        // Not `Theme.background`: the mockup's page is white, where the grouped background is
        // the grey a page of cards sits on. In dark mode this is the same near-black.
        .background(NewLook.page.ignoresSafeArea())
        // The band is blue under the status bar in either appearance: the clock over it is white.
        .background(LightStatusBar())
        .sensoryFeedback(.warning, trigger: refusals)
        .onDisappear { attempt?.cancel() }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Sign in")
                .appDisplayFont(32)
                .tracking(-0.8)
                .foregroundStyle(NewLook.ink)
                .accessibilityAddTraits(.isHeader)
            Text("MasterSAT Center")
                .appFont(16, weight: .medium)
                .foregroundStyle(NewLook.muted)
                .padding(.top, 4)

            // Above the fields, where the eye is not, and said once (below).
            if let notice, !noticeDismissed, error == nil {
                AuthAlert(tone: .warning, message: notice)
                    .padding(.top, 20)
            }
            if let error {
                AuthAlert(tone: .danger, message: error) {
                    if retryable {
                        Button(action: submit) {
                            Label("Retry", systemImage: "arrow.clockwise")
                                .appFont(13, weight: .bold)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(NewLook.blueText)
                        .disabled(session.isWorking)
                    }
                }
                .padding(.top, 20)
            }

            SoftField(systemImage: "person") {
                // `verbatim`, because a plain string placeholder is a LocalizedStringKey:
                // SwiftUI parses it as markdown, and a hint with an address or a `+998` in it
                // comes out as a blue tappable link inside an empty field.
                TextField(text: $identity, prompt: Text(verbatim: "Phone, email or username")) {
                    Text(verbatim: "Phone, email or username")
                }
                    .textContentType(.username)
                    // The email keyboard, even though a phone number is one of the three: it
                    // has no autocaps, `@` and `.` on the first plane and digits one tap away,
                    // and a password manager still fills it. A phone pad would make the other
                    // two untypable.
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focus = .password }
            }
            .padding(.top, 22)

            PasswordField(
                label: "Password",
                text: $password,
                focus: $focus,
                field: .password,
                shakes: refusals,
                invalid: passwordRefused,
                onSubmit: { if canSubmit { submit() } }
            )
            .padding(.top, 12)
            .onChange(of: password) { _, _ in if passwordRefused { passwordRefused = false } }

            Button(action: submit) {
                if session.isWorking {
                    ProgressView().tint(.white).frame(maxWidth: .infinity)
                } else {
                    Text("Sign in").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(NewLookButtonStyle(kind: .primary, size: .large))
            .disabled(!canSubmit)
            // The spinner has no words of its own.
            .accessibilityLabel(session.isWorking ? "Signing in" : "Sign in")
            .padding(.top, 18)

            help
                .frame(maxWidth: .infinity)
                .padding(.top, 24)
        }
        // One centred column at every width: the iPad split is gone with the panel that
        // filled its other half.
        .frame(maxWidth: 460, alignment: .leading)
        .padding(.horizontal, 20)
    }

    private var help: some View {
        VStack(spacing: 7) {
            Text("Forgot your password? ").foregroundStyle(NewLook.ink4)
                + Text("Your centre resets it.").foregroundStyle(NewLook.blueText)
            Text("No account yet? Your learning centre creates it for you.")
                .foregroundStyle(NewLook.ink4)
        }
        .appFont(13, weight: .medium)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var copyright: some View {
        Text("© \(ScoreText.string(Calendar.current.component(.year, from: Date()))) MasterSAT Center")
            .appFont(13, weight: .medium)
            .foregroundStyle(NewLook.muted)
    }

    private func submit() {
        focus = nil
        error = nil
        noticeDismissed = true
        attempt?.cancel()
        attempt = Task {
            do {
                try await session.signIn(
                    email: identity.trimmingCharacters(in: .whitespaces),
                    password: password
                )
            } catch {
                // Cancelled — a second tap took over — is not a failure, and `APIClient` reports
                // it as a transport error: nothing to show, nothing to announce.
                guard !Task.isCancelled else { return }
                let copy = AuthErrorCopy.classify(error)
                self.error = copy.message
                retryable = copy.retryable
                // On this screen a 401 from the token exchange is a wrong identity or password
                // (`AuthErrorCopy`); one from /me after it (`AccountDidNotLoad`) is not, and
                // neither is "cannot reach the server" — shaking there teaches a student to
                // retype a password that was right.
                if case .unauthorized? = error as? APIError {
                    refusals += 1
                    passwordRefused = true
                }
                // The alert appears where the eye is not; VoiceOver hears it once.
                AccessibilityNotification.Announcement(copy.message).post()
            }
        }
    }
}
