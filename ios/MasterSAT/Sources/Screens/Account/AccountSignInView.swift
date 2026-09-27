import SwiftUI
import MasterSATKit

/// Settings › Sign-in & password: the email that receives codes and results, Telegram, and the
/// password. The web's `SignInSection`.
///
/// One difference from the web, and it is the backend's: changing the password there keeps the
/// browser signed in, because the server spares the session named by the browser's refresh
/// cookie. The app has no such cookie, so the server signs the phone out with everything else.
/// Rather than let that surface hours later as "your session has expired", the app says so the
/// moment the password changes and signs out cleanly — see `AccountPasswordChangedView`.
struct AccountSignInView: View {
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL

    @State private var load: AccountLoadState<AccountProfile> = .loading
    @State private var telegram: TelegramSignInConfig?
    @State private var verifyingEmail = false
    @State private var changingPassword = false
    @State private var passwordChanged = false
    @State private var toast: RewardsToastMessage?

    private var account: AccountAPI { AccountAPI(client: session.client) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                AccountPageHeading(
                    title: "Sign-in & password",
                    description: "The ways into your account, and keeping it yours."
                )

                switch load {
                case .loading:
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 50)
                case .failed(let message):
                    RetryNotice(message: message) { await reload() }
                        .cardStyle()
                case .loaded(let profile):
                    emailRow(profile)
                    telegramRow(profile)
                    passwordRow(profile)
                    Text("Forgot your password? Your learning center can set a new one for you.")
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if load.isLoading { await reload() }
        }
        .sheet(isPresented: $verifyingEmail) {
            AccountEmailVerificationSheet(currentEmail: load.value?.realEmail ?? "") { _ in
                toast = .accountSuccess(AccountCopy.emailConfirmed)
                await refresh()
            }
        }
        // Not dismissible: the phone's session is already revoked server-side, and the only
        // honest way on is signing in again.
        .fullScreenCover(isPresented: $passwordChanged) {
            AccountPasswordChangedView()
                .interactiveDismissDisabled()
        }
        .rewardsToast($toast)
    }

    // MARK: Rows

    private func emailRow(_ profile: AccountProfile) -> some View {
        AccountMethodRow(
            icon: "envelope",
            tone: Theme.accent,
            title: "Email",
            detail: profile.hasEmail ? profile.realEmail : "No email on your account yet"
        ) {
            if profile.hasEmail {
                if profile.emailVerified {
                    AccountStatusPill(text: "Confirmed", tone: Theme.success)
                } else {
                    AccountStatusPill(text: "Not confirmed", tone: Theme.warning)
                }
            }
        } action: {
            Button(emailAction(profile)) {
                verifyingEmail = true
            }
            .buttonStyle(AccountPillButtonStyle(kind: profile.emailIsConfirmed ? .quiet : .soft, tone: Theme.accent))
        } expanded: {
            EmptyView()
        }
    }

    /// The web's three: add one, confirm the one there is, or change a confirmed one.
    private func emailAction(_ profile: AccountProfile) -> String {
        if !profile.hasEmail { return "Add email" }
        return profile.emailVerified ? "Change" : "Confirm"
    }

    private func telegramRow(_ profile: AccountProfile) -> some View {
        let canConnect = telegram?.canConnect == true
        let detail: String
        if profile.telegramLinked {
            detail = "Sign in with one tap from Telegram."
        } else if canConnect {
            // The web's Connect button is a browser redirect that ends by setting a cookie on
            // the site; a native client cannot finish it. The same account connects on the web
            // (whose sign-in lands on the dashboard, not back here — hence the directions).
            detail = "Connect it from your profile on the website to sign in with one tap."
        } else if telegram != nil {
            detail = "Telegram sign-in isn't available here yet."
        } else {
            detail = "Not connected."
        }
        return AccountMethodRow(icon: "paperplane", tone: Theme.info, title: "Telegram", detail: detail) {
            if profile.telegramLinked { AccountStatusPill(text: "Connected", tone: Theme.success) }
        } action: {
            if !profile.telegramLinked, canConnect, let url = siteURL("/profile?tab=settings&section=signin") {
                Button {
                    openURL(url)
                } label: {
                    Label("Open website", systemImage: "arrow.up.right")
                }
                .buttonStyle(AccountPillButtonStyle(kind: .soft, tone: Theme.info))
            }
        } expanded: {
            EmptyView()
        }
    }

    private func passwordRow(_ profile: AccountProfile) -> some View {
        AccountMethodRow(
            icon: "lock",
            tone: Theme.success,
            title: "Password",
            detail: AccountCopy.passwordChangedLine(profile.lastPasswordChange)
        ) {
            EmptyView()
        } action: {
            if !changingPassword {
                Button("Change password") { changingPassword = true }
                    .buttonStyle(AccountPillButtonStyle(kind: .soft, tone: Theme.success))
            }
        } expanded: {
            if changingPassword {
                AccountPasswordForm(
                    account: account,
                    onCancel: { changingPassword = false },
                    onChanged: { _ in
                        changingPassword = false
                        passwordChanged = true
                    }
                )
            }
        }
    }

    // MARK: Loading

    private func reload() async {
        load = .loading
        async let config = try? account.telegramConfig()
        do {
            load = .loaded(try await account.profile())
        } catch {
            load = .failed("Your sign-in details didn't load. Nothing has changed — try again.")
        }
        telegram = await config
    }

    /// After the email changed: this page's copy, and the session's (Profile, the gate).
    private func refresh() async {
        if let fresh = try? await account.profile() { load = .loaded(fresh) }
        await session.refreshUser()
    }

    private func siteURL(_ path: String) -> URL? {
        URL(string: path, relativeTo: session.client.config.baseURL)?.absoluteURL
    }
}

/// One way into the account: tile, name, status, one line of detail, the action — and room
/// under it for a form that opens in place.
struct AccountMethodRow<Status: View, Action: View, Expanded: View>: View {
    let icon: String
    let tone: Color
    let title: String
    let detail: String
    @ViewBuilder var status: () -> Status
    @ViewBuilder var action: () -> Action
    @ViewBuilder var expanded: () -> Expanded

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                IconTile(systemName: icon, tone: tone, size: 38)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 7) {
                        Text(title).font(.system(size: 15, weight: .heavy))
                        status()
                    }
                    Text(verbatim: detail)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 8)
                action()
            }
            expanded()
        }
        .cardStyle(padding: 14)
    }
}

/// Current, new, repeat — the web's `PasswordForm`, with its checks made before sending.
struct AccountPasswordForm: View {
    private enum Field: Hashable { case current, new, confirm }

    let account: AccountAPI
    let onCancel: () -> Void
    let onChanged: (PasswordChangeResult) -> Void

    @State private var current = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var revealed = false
    @State private var errors: [String: String] = [:]
    @State private var saving = false
    @FocusState private var focus: Field?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            AccountSecureField(
                label: "Current password",
                text: bind($current, clearing: PasswordChangeCheck.Field.current.rawValue),
                revealed: $revealed,
                error: errors[PasswordChangeCheck.Field.current.rawValue],
                contentType: .password,
                focus: $focus,
                field: Field.current,
                onSubmit: { focus = .new }
            )
            AccountSecureField(
                label: "New password",
                text: bind($new, clearing: PasswordChangeCheck.Field.new.rawValue),
                revealed: $revealed,
                hint: "At least 8 characters — not only numbers, and nothing common.",
                error: errors[PasswordChangeCheck.Field.new.rawValue],
                contentType: .newPassword,
                focus: $focus,
                field: Field.new,
                onSubmit: { focus = .confirm }
            )
            AccountSecureField(
                label: "Repeat the new password",
                text: bind($confirm, clearing: PasswordChangeCheck.Field.confirm.rawValue),
                revealed: $revealed,
                error: errors[PasswordChangeCheck.Field.confirm.rawValue],
                contentType: .newPassword,
                submitLabel: .go,
                focus: $focus,
                field: Field.confirm,
                onSubmit: { Task { await submit() } }
            )

            if let detail = errors["detail"] {
                Text(detail)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Not the web's "You stay signed in here": for the app the server cannot tell this
            // phone from the others, so it is signed out with them.
            Text("Changing it signs you out on every device, this phone too. You'll sign in again with the new password.")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 10) {
                Button {
                    Task { await submit() }
                } label: {
                    Text(saving ? "Updating…" : "Update password")
                }
                .buttonStyle(AccountPillButtonStyle(kind: .solid, tone: Theme.accent))
                .disabled(saving)

                Button("Cancel", action: onCancel)
                    .buttonStyle(AccountPillButtonStyle(kind: .quiet, tone: Theme.accent))
                    .disabled(saving)
                Spacer(minLength: 0)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Theme.accentSoft))
    }

    private func bind(_ value: Binding<String>, clearing key: String) -> Binding<String> {
        Binding(
            get: { value.wrappedValue },
            set: {
                value.wrappedValue = $0
                errors[key] = nil
                errors["detail"] = nil
            }
        )
    }

    private func submit() async {
        guard !saving else { return }
        let local = PasswordChangeCheck.problems(current: current, new: new, confirm: confirm)
        errors = Dictionary(uniqueKeysWithValues: local.map { ($0.key.rawValue, $0.value) })
        guard local.isEmpty else { return }
        focus = nil
        saving = true
        defer { saving = false }
        do {
            // Never retried: a second attempt after a lost answer would meet the NEW password
            // as "not your current one".
            let result = try await account.changePassword(current: current, new: new)
            current = ""
            new = ""
            confirm = ""
            onChanged(result)
        } catch {
            errors = AccountCopy.passwordFailure(error)
        }
    }
}

/// After a password change: the phone's session is gone server-side, so say so and sign in again.
///
/// Without this the access token would keep working for up to three hours and then the
/// renewal would be refused — the student would meet "Your session has expired" in the middle
/// of something else, with no idea why.
struct AccountPasswordChangedView: View {
    @Environment(Session.self) private var session
    @State private var leaving = false

    var body: some View {
        StateScreen(
            icon: "checkmark.shield",
            tone: Theme.success,
            title: "Password changed",
            message: "For your security, every device signed in to your account has been signed out — this phone too. Sign in again with your new password."
        ) {
            Button {
                leaving = true
                Task { await session.signOut() }
            } label: {
                Group {
                    if leaving { ProgressView().tint(.white) } else { Text("Sign in again") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(leaving)
        }
    }
}
