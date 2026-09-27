import SwiftUI
import MasterSATKit

/// The profile-completion gate: the web's `ProfileCompletionGate`, as a whole screen.
///
/// Shown in place of the app while `ProfileCompletion.isRequired(for:)` holds — the server says
/// `profile_complete: false` with `missing_fields`. Names under three characters, or an email
/// that is missing or unconfirmed. Nothing in the API refuses an incomplete profile; the gate
/// is the only thing that asks, so it cannot be dismissed — only completed, or left by signing
/// out (there is no password reset anywhere, so a code that never arrives must not trap anyone).
///
/// It disappears on its own: every save hands the server's fresh verdict back to the session
/// (`Session.refreshUser()`), and once nothing is missing the gate's condition stops holding.
/// `onDone` fires after that refresh, for a host that presents this itself.
struct CompleteProfileView: View {
    let user: CurrentUser
    let onDone: () -> Void

    @Environment(Session.self) private var session

    @State private var step: ProfileCompletion.Step
    @State private var missing: [String]
    @State private var firstName: String
    @State private var lastName: String
    @State private var username: String
    @State private var busy = false
    @State private var emailBusy = false
    @State private var error: String?
    @State private var finished = false
    @State private var finishing = false
    @FocusState private var focus: AccountField?

    init(user: CurrentUser, onDone: @escaping () -> Void) {
        self.user = user
        self.onDone = onDone
        let missing = user.missingFields ?? []
        _missing = State(initialValue: missing)
        _step = State(initialValue: ProfileCompletion.firstStep(missing: missing))
        // All three are always shown and pre-filled, so a name Telegram guessed wrong can be
        // corrected here, not only the ones the server flagged.
        _firstName = State(initialValue: user.firstName ?? "")
        _lastName = State(initialValue: user.lastName ?? "")
        _username = State(initialValue: user.username ?? "")
    }

    private var account: AccountAPI { AccountAPI(client: session.client) }
    private var emailMissing: Bool { ProfileCompletion.needsEmail(missing) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                BrandMark(height: 36, tint: Theme.accent)

                if finished {
                    finishedStep
                } else {
                    switch step {
                    case .names: namesStep
                    case .email: emailStep
                    }
                }

                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top, spacing: 7) {
                        Image(systemName: "checkmark.shield")
                            .font(.system(size: 13, weight: .semibold))
                            .padding(.top, 1)
                        Text("You can't use the rest of the app until this is done.")
                            .font(.system(size: 13, weight: .medium))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .foregroundStyle(Theme.textSecondary)

                    Divider()

                    Button {
                        Task { await session.signOut() }
                    } label: {
                        Label("Not now — log out", systemImage: "rectangle.portrait.and.arrow.right")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(Theme.textSecondary)
                    .disabled(busy || emailBusy || finishing)
                }
            }
            .padding(24)
            .frame(maxWidth: 480, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background.ignoresSafeArea())
    }

    // MARK: Steps

    private var namesStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Complete your profile")
                    .font(.system(size: 26, weight: .heavy))
                    .tracking(-0.6)
                Text("Check these are right — they name you on results and certificates. You can change them.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let error {
                AuthAlert(tone: .danger, message: error)
            }

            VStack(alignment: .leading, spacing: 14) {
                AccountTextField(
                    label: AccountField.firstName.label,
                    text: binding($firstName),
                    contentType: .givenName,
                    focus: $focus,
                    field: AccountField.firstName,
                    onSubmit: { focus = .lastName }
                )
                AccountTextField(
                    label: AccountField.lastName.label,
                    text: binding($lastName),
                    contentType: .familyName,
                    focus: $focus,
                    field: AccountField.lastName,
                    onSubmit: { focus = .username }
                )
                AccountTextField(
                    label: AccountField.username.label,
                    icon: "at",
                    text: binding($username),
                    contentType: .username,
                    capitalization: .never,
                    submitLabel: .go,
                    focus: $focus,
                    field: AccountField.username,
                    onSubmit: { if !busy { Task { await saveNames() } } }
                )
            }

            Button {
                Task { await saveNames() }
            } label: {
                Group {
                    if busy { ProgressView().tint(.white) } else { Text(emailMissing ? "Save and continue" : "Save") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(busy)

            if emailMissing {
                Text("Next, confirm your email address with a code.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private var emailStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            AccountEmailCodeFlow(
                initialEmail: user.email.trimmingCharacters(in: .whitespacesAndNewlines),
                fixedTitle: "Confirm your email",
                isBusy: $emailBusy
            ) { _ in
                await afterEmailConfirmed()
            }

            Button {
                step = .names
                error = nil
            } label: {
                Label("Edit your name", systemImage: "arrow.left")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(Theme.textSecondary)
            .disabled(emailBusy)
        }
    }

    /// Everything is in. Normally the gate lifts before this is ever seen; it stays only when
    /// the session's copy could not be refreshed (offline), and then Continue tries again.
    private var finishedStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            IconTile(systemName: "checkmark.seal.fill", tone: Theme.success, size: 56)
            Text("Your profile is all set")
                .font(.system(size: 26, weight: .heavy))
                .tracking(-0.6)
            Button {
                Task { await finish() }
            } label: {
                Group {
                    if finishing { ProgressView().tint(.white) } else { Text("Continue") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(finishing)
        }
    }

    private func binding(_ value: Binding<String>) -> Binding<String> {
        Binding(get: { value.wrappedValue }, set: { value.wrappedValue = $0; error = nil })
    }

    // MARK: Actions

    private func saveNames() async {
        guard !busy else { return }
        if let problem = ProfileCompletion.nameProblem(firstName: firstName, lastName: lastName, username: username) {
            error = problem
            return
        }
        focus = nil
        busy = true
        error = nil
        defer { busy = false }
        do {
            let profile = try await account.updateDetails(AccountDetailsChanges(
                firstName: firstName.trimmingCharacters(in: .whitespacesAndNewlines),
                lastName: lastName.trimmingCharacters(in: .whitespacesAndNewlines),
                username: username.trimmingCharacters(in: .whitespacesAndNewlines)
            ))
            missing = profile.missingFields ?? []
            if ProfileCompletion.needsEmail(missing) {
                step = .email
            } else if !ProfileCompletion.needsNames(missing) {
                await finish()
            }
        } catch {
            self.error = Self.saveFailure(error)
        }
    }

    private func afterEmailConfirmed() async {
        // The confirm answer does not carry the verdict; the profile does.
        if let fresh = try? await account.profile() {
            missing = fresh.missingFields ?? []
        } else {
            missing.removeAll { $0 == "email" }
        }
        if ProfileCompletion.needsNames(missing) {
            step = .names
            return
        }
        await finish()
    }

    private func finish() async {
        guard !finishing else { return }
        finished = true
        finishing = true
        await session.refreshUser()
        finishing = false
        onDone()
    }

    /// The web gate's `apiError`: the server's `detail`, else its first field message, else a
    /// sentence of its own.
    static func saveFailure(_ error: Error) -> String {
        if let fields = AccountCopy.fieldMessages(error) {
            for key in ProfileCompletion.nameFields + ["detail", "non_field_errors"] {
                if let message = fields[key] { return message }
            }
            if let first = fields.sorted(by: { $0.key < $1.key }).first?.value { return first }
        }
        if case .http(let status, let detail)? = error as? APIError {
            if !detail.isEmpty { return detail }
            if status == 429 { return AccountCopy.emailThrottled }
        }
        if case .forbidden(let detail, _)? = error as? APIError, !detail.isEmpty { return detail }
        return "Could not save. Check the values and try again."
    }
}
