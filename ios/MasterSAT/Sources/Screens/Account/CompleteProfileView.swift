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
    @State private var password = ""
    @State private var passwordAgain = ""
    @State private var revealed = false
    @State private var phone = ""
    @State private var busy = false
    @State private var emailBusy = false
    @State private var error: String?
    /// The phone step's refusal of the number itself, shown under the field because the
    /// server's sentence names the digits it expected. Every other refusal is the form's.
    @State private var phoneError: String?
    @State private var finished = false
    @State private var finishing = false
    @FocusState private var focus: AccountField?
    @FocusState private var claimFocus: ClaimField?

    /// The two lc-up steps' own boxes. `AccountField` names what `/users/me/` holds, and
    /// neither a first password nor the number an administrator holds is one of those.
    private enum ClaimField: Hashable { case newPassword, passwordAgain, phone }

    /// Whether the names were ever this student's to fill. The email step's "Edit your name"
    /// goes back to a step that was part of their gate; for a student whose only outstanding
    /// field was the email it would offer a detour they were never asked to take.
    private let hadNamesStep: Bool

    init(user: CurrentUser, onDone: @escaping () -> Void) {
        self.user = user
        self.onDone = onDone
        let missing = user.missingFields ?? []
        _missing = State(initialValue: missing)
        _step = State(initialValue: ProfileCompletion.firstStep(missing: missing))
        hadNamesStep = ProfileCompletion.needsNames(missing)
        // All three are always shown and pre-filled, so a name Telegram guessed wrong can be
        // corrected here, not only the ones the server flagged.
        _firstName = State(initialValue: user.firstName ?? "")
        _lastName = State(initialValue: user.lastName ?? "")
        _username = State(initialValue: user.username ?? "")
    }

    private var account: AccountAPI { AccountAPI(client: session.client) }
    private var lcup: LcupClaimAPI { LcupClaimAPI(client: session.client) }

    /// What is still outstanding once the names are saved — the whole rest of the gate, not
    /// only the email, so the button says "and continue" for a student who also owes a step
    /// this build has not been taught.
    private var afterNames: ProfileCompletion.Step? {
        ProfileCompletion.next(after: .names, missing: missing)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                BrandMark(height: 36, tint: Theme.accent)

                if finished {
                    finishedStep
                } else {
                    switch step {
                    case .password: passwordStep
                    case .phone: phoneStep
                    case .names: namesStep
                    case .email: emailStep
                    }
                }

                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top, spacing: 7) {
                        Image(systemName: "checkmark.shield")
                            .appFont(13, weight: .semibold)
                            .padding(.top, 1)
                            .accessibilityHidden(true)
                        Text("You can't use the rest of the app until this is done.")
                            .appFont(13, weight: .medium)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .foregroundStyle(Theme.textSecondary)

                    Divider()

                    Button {
                        Task { await session.signOut() }
                    } label: {
                        Label("Not now — log out", systemImage: "rectangle.portrait.and.arrow.right")
                            .appFont(13, weight: .semibold)
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
        // A refusal is spoken once — it changed, so it is news. The same sentence set twice
        // does not re-announce, which is what a student retrying the same wrong number hears.
        .onChange(of: error) { _, now in
            if let now { AccessibilityNotification.Announcement(now).post() }
        }
        .onChange(of: phoneError) { _, now in
            if let now { AccessibilityNotification.Announcement(now).post() }
        }
        // A step is a new page, not a changed control: VoiceOver re-reads from the top.
        .onChange(of: step) { _, _ in AccessibilityNotification.ScreenChanged().post() }
    }

    // MARK: Steps

    /// Every step's headline, in the names step's type.
    private func heading(_ title: String, _ description: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: title)
                .appFont(26, weight: .heavy)
                .tracking(-0.6)
            Text(verbatim: description)
                .appFont(14, weight: .medium)
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// The first password an lc-up account chooses for itself, in the web's English.
    ///
    /// Saving it does NOT end the session (`lcup/claims.py:set_initial_password` writes
    /// `password` and `password_set_at` and nothing else — no revocation, unlike
    /// `/auth/password/change/`), so the gate walks straight on and nothing signs out.
    private var passwordStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            heading(
                "Choose your password",
                "You signed in with a one-time code. Choose your own password — from now on you sign in with your phone number and this password."
            )

            if let error {
                AuthAlert(tone: .danger, message: error)
            }

            VStack(alignment: .leading, spacing: 14) {
                AccountSecureField(
                    label: "New password",
                    text: binding($password),
                    revealed: $revealed,
                    contentType: .newPassword,
                    focus: $claimFocus,
                    field: ClaimField.newPassword,
                    onSubmit: { claimFocus = .passwordAgain }
                )
                AccountSecureField(
                    label: "Type it again",
                    text: binding($passwordAgain),
                    revealed: $revealed,
                    contentType: .newPassword,
                    submitLabel: .go,
                    focus: $claimFocus,
                    field: ClaimField.passwordAgain,
                    onSubmit: { if !busy { Task { await savePassword() } } }
                )
            }

            Button {
                Task { await savePassword() }
            } label: {
                Group {
                    if busy { ProgressView().tint(.white) } else { Text("Save password") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(busy)
            .accessibilityLabel(busy ? "Saving" : "Save password")
        }
    }

    /// The number the administrator holds — Uzbek, verbatim from the web.
    ///
    /// It is the one screen whose words the owner wrote, for the number an administrator holds,
    /// and a second translation would be a second meaning of "o'zingizning raqamingiz".
    private var phoneStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            heading(
                "Telefon raqamingiz",
                "O'zingizning raqamingizni kiriting — administratorga bergan raqamingizni. Raqamni qaysi akkauntda yozsangiz, o'sha akkaunt asosiy bo'ladi va guruhlaringiz unga o'tadi."
            )

            if let error {
                AuthAlert(tone: .danger, message: error)
            }

            AccountTextField(
                label: "Telefon raqami",
                icon: "phone",
                text: binding($phone),
                prompt: "+998 90 123 45 67",
                error: phoneError,
                contentType: .telephoneNumber,
                keyboard: .phonePad,
                capitalization: .never,
                submitLabel: .go,
                focus: $claimFocus,
                field: ClaimField.phone,
                onSubmit: { if !busy { Task { await savePhone() } } }
            )

            Button {
                Task { await savePhone() }
            } label: {
                Group {
                    if busy { ProgressView().tint(.white) } else { Text(verbatim: "Tasdiqlash") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(busy)
            .accessibilityLabel(Text(verbatim: busy ? "Saqlanmoqda" : "Tasdiqlash"))

            // A namesake's way out. Two lines rather than one sentence with the words inside
            // it: at 13 pt the whole line already wraps on a phone, and a tappable run inside
            // a wrapped paragraph is neither a 44 pt target nor one button to VoiceOver.
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: "Shu ism-familiyali boshqa o'quvchi bo'lsangiz:")
                    .appFont(13, weight: .medium)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    Task { await sayNotMe() }
                } label: {
                    Text(verbatim: "Bu men emasman")
                        .appFont(13, weight: .bold)
                        .underline()
                        .frame(minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.textSecondary)
                .disabled(busy)
            }
        }
    }

    private var namesStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Complete your profile")
                    .appFont(26, weight: .heavy)
                    .tracking(-0.6)
                Text("Check these are right — they name you on results and certificates. You can change them.")
                    .appFont(14, weight: .medium)
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
                    if busy { ProgressView().tint(.white) } else { Text(afterNames == nil ? "Save" : "Save and continue") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(busy)
            .accessibilityLabel(busy ? "Saving" : (afterNames == nil ? "Save" : "Save and continue"))

            if afterNames == .email {
                Text("Next, confirm your email address with a code.")
                    .appFont(13, weight: .medium)
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

            // Only for a student the names step belongs to. For one whose email was the whole
            // gate it would offer a detour they were never asked to take.
            if hadNamesStep || ProfileCompletion.needsNames(missing) {
                Button {
                    show(.names)
                } label: {
                    Label("Edit your name", systemImage: "arrow.left")
                        .appFont(13, weight: .semibold)
                }
                .foregroundStyle(Theme.textSecondary)
                .disabled(emailBusy)
            }
        }
    }

    /// Everything is in. Normally the gate lifts before this is ever seen; it stays only when
    /// the session's copy could not be refreshed (offline), and then Continue tries again.
    private var finishedStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            IconTile(systemName: "checkmark.seal.fill", tone: Theme.success, size: 56)
            Text("Your profile is all set")
                .appFont(26, weight: .heavy)
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
            .accessibilityLabel(finishing ? "Continuing" : "Continue")
        }
    }

    private func binding(_ value: Binding<String>) -> Binding<String> {
        Binding(get: { value.wrappedValue }, set: { value.wrappedValue = $0; error = nil; phoneError = nil })
    }

    /// Shows a step: the only place `step` is written, so nothing can arrive on one carrying
    /// the refusal that belonged to the last.
    private func show(_ next: ProfileCompletion.Step) {
        focus = nil
        claimFocus = nil
        error = nil
        phoneError = nil
        step = next
    }

    // MARK: Actions

    /// What the server calls the field this step fills, so an offline advance can drop it
    /// from the local list. The names step fills three.
    private static func fields(of step: ProfileCompletion.Step) -> [String] {
        switch step {
        case .password: return [ProfileCompletion.passwordField]
        case .phone: return [ProfileCompletion.phoneField]
        case .names: return ProfileCompletion.nameFields
        case .email: return ["email"]
        }
    }

    /// The one "what next": every step ends here, and none of them decides for itself.
    ///
    /// The verdict is the server's, re-read (`GET /users/me/`, the web's `invalidateMe`) unless
    /// the call that just succeeded already answered with it (`knownMissing`). When it cannot be
    /// read at all — offline — this step's own fields are dropped locally and the walk goes on
    /// from that, which is what the email step has always done.
    ///
    /// **`nil` is not "done".** It means "no step after this one is outstanding", which is also
    /// what a requirement this build has never heard of looks like: the server's extras are
    /// open-ended (`users/profile_completeness.py`, `register_requirement`). So on `nil` the
    /// decision is re-derived from the fresh list — empty means finished, anything else means
    /// `firstStep`, even if that is this step again. A student then always has a step they can
    /// act on, instead of the gate lifting and remounting under them a moment later.
    ///
    /// **Nothing here reads a refusal.** `PhoneClaimRefusal.nothingToConfirm` is only "that
    /// request got a 403" — a host guard's would otherwise look like "already answered" and skip
    /// the step it was refusing. A step is done when the re-read profile says so, and not before.
    private func advance(from step: ProfileCompletion.Step, knownMissing: [String]? = nil) async {
        if let knownMissing {
            missing = knownMissing
        } else if let fresh = try? await account.profile() {
            missing = fresh.missingFields ?? []
        } else {
            let own = Self.fields(of: step)
            missing.removeAll { own.contains($0) }
        }
        if let next = ProfileCompletion.next(after: step, missing: missing) {
            show(next)
            return
        }
        guard missing.isEmpty else {
            show(ProfileCompletion.firstStep(missing: missing))
            return
        }
        await finish()
    }

    private func savePassword() async {
        guard !busy else { return }
        if let problem = InitialPasswordCheck.problem(password: password, again: passwordAgain) {
            error = problem
            return
        }
        claimFocus = nil
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await lcup.setInitialPassword(password)
            // Not kept around: the next step has no use for it, and the gate may yet be
            // remounted. The session stands — choosing a first password revokes nothing.
            password = ""
            passwordAgain = ""
            await advance(from: .password)
        } catch {
            self.error = AccountCopy.initialPasswordFailure(error)
        }
    }

    private func savePhone() async {
        guard !busy else { return }
        if let problem = PhoneClaimEntry.problem(phone) {
            phoneError = problem
            return
        }
        claimFocus = nil
        busy = true
        error = nil
        phoneError = nil
        defer { busy = false }
        do {
            // `moved` starts a Celery job server-side (`tasks.follow_student`) and there is
            // nothing to wait for: the seats and marks arrive when they arrive.
            _ = try await lcup.confirmPhone(phone.trimmingCharacters(in: .whitespacesAndNewlines))
            phone = ""
            await advance(from: .phone)
        } catch {
            // The number itself was refused: the server's sentence names the digits it holds
            // (`••NN`), so it belongs under the box the student is retyping. Everything else is
            // about the account, not the number, and is the form's to say.
            if case .wrongNumber? = (error as? PhoneClaimRefusal)?.reason {
                phoneError = AccountCopy.phoneFailure(error)
            } else {
                self.error = AccountCopy.phoneFailure(error)
            }
        }
    }

    private func sayNotMe() async {
        guard !busy else { return }
        claimFocus = nil
        busy = true
        error = nil
        phoneError = nil
        defer { busy = false }
        do {
            try await lcup.sayNotMe()
            await advance(from: .phone)
        } catch {
            self.error = AccountCopy.phoneFailure(error, fallback: AccountCopy.notMeFailed)
        }
    }

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
            // The PATCH answers with the fresh verdict itself, so this one step needs no
            // second read; the decision is still `advance`'s alone.
            await advance(from: .names, knownMissing: profile.missingFields ?? [])
        } catch {
            self.error = Self.saveFailure(error)
        }
    }

    private func afterEmailConfirmed() async {
        // The confirm answer does not carry the verdict; the profile does.
        await advance(from: .email)
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
