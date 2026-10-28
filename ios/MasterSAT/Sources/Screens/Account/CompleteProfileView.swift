import SwiftUI
import MasterSATKit

/// The profile-completion gate: the web's `ProfileCompletionGate`, as a whole screen.
///
/// Shown in place of the app while `ProfileCompletion.isRequired(for:)` holds — the server says
/// `profile_complete: false` with `missing_fields`. Four steps in the website's order: the first
/// password an lc-up account chooses for itself (`lcup/claims.py`), then the number its
/// administrator holds (`lcup/phone_confirm.py`), then names under three characters, then an
/// email that is missing or unconfirmed. Nothing in the API refuses an incomplete profile; the
/// gate is the only thing that asks, so it cannot be dismissed — only completed, or left by
/// signing out (there is no password reset anywhere, so a code that never arrives must not trap
/// anyone).
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
    /// What the server said was missing when the gate opened — the count behind "Step 1 of 3"
    /// (`ProfileCompletion.position`). Fixed for the gate's life, so the total never shrinks
    /// under the student as steps clear.
    private let owedAtStart: [String]

    init(user: CurrentUser, onDone: @escaping () -> Void) {
        self.user = user
        self.onDone = onDone
        let missing = user.missingFields ?? []
        _missing = State(initialValue: missing)
        _step = State(initialValue: ProfileCompletion.firstStep(missing: missing))
        hadNamesStep = ProfileCompletion.needsNames(missing)
        owedAtStart = missing
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
        // The new look (mockup 03): the sign-in's blue top as a compact band, so the front door
        // and these steps read as one flow, with the step chip on it.
        VStack(spacing: 0) {
            AuthCompactBand(step: finished ? nil : ProfileCompletion.position(of: step, owedAtStart: owedAtStart))
            ScrollView {
            VStack(alignment: .leading, spacing: 20) {
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
            .padding(.horizontal, 20)
            .padding(.vertical, 22)
            .frame(maxWidth: 480, alignment: .leading)
            .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(NewLook.page.ignoresSafeArea())
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
                .appDisplayFont(28)
                .tracking(-0.6)
                .foregroundStyle(NewLook.ink)
            Text(verbatim: description)
                .appFont(16, weight: .medium)
                .foregroundStyle(NewLook.ink4)
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
            .buttonStyle(NewLookButtonStyle(kind: .primary, size: .block))
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
            .buttonStyle(NewLookButtonStyle(kind: .primary, size: .block))
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
            .buttonStyle(NewLookButtonStyle(kind: .primary, size: .block))
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
            .buttonStyle(NewLookButtonStyle(kind: .primary, size: .block))
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

    /// The one "what next": every step ends here, and none of them decides for itself.
    ///
    /// This half only fetches. The decision — `nil` is not "done", the unreadable fallback, the
    /// unknown-extra re-derivation — is `ProfileCompletion.outcome(after:missing:lastKnown:)`,
    /// in the kit, where it is tested without a view.
    ///
    /// The verdict is the server's, re-read (`GET /users/me/`, the web's `invalidateMe`) unless
    /// the call that just succeeded already answered with it (`knownMissing`).
    private func advance(from step: ProfileCompletion.Step, knownMissing: [String]? = nil) async {
        // Both a server that cannot be reached and an answer whose `missing_fields` is absent
        // or malformed arrive here as nil: unreadable, never "nothing missing". Reading nil as
        // an empty list is how a student offline gets told their profile is all set.
        // (Written out rather than with `??`, whose right-hand autoclosure cannot await.)
        let fresh: [String]?
        if let knownMissing {
            fresh = knownMissing
        } else {
            fresh = try? await account.profile().missingFields
        }
        let decision = ProfileCompletion.outcome(after: step, missing: fresh, lastKnown: missing)
        missing = decision.missing
        switch decision.outcome {
        case .show(let next): show(next)
        case .finished: await finish()
        }
    }

    /// Whether a refused save was about what the student just typed: Django's verdict on a
    /// password, or a number that is not the one lc-up holds. Those are answers to this form.
    /// Every other failure is about the account or the connection — which is what
    /// `recoveredElsewhere` asks the server about.
    private static func isAboutTheValue(_ error: Error) -> Bool {
        if case .validation(_, _, _)? = error as? APIError { return true }
        if case .wrongNumber? = (error as? PhoneClaimRefusal)?.reason { return true }
        return false
    }

    /// Whether this step's field is already cleared — and if it is, walks on. True when the
    /// student should see the next step instead of the refusal.
    ///
    /// Once a field is gone the server refuses that step for good: "There is no first password
    /// to choose for this account." (`lcup/claims.py`) and `NOTHING_TO_CONFIRM`
    /// (`lcup/phone_confirm.py`). That happens whenever the save landed but its reply did not
    /// (ordinary on a phone), the step was done on another device, or a namesake account's
    /// confirm answered this account's prompt — and the student is then on a form that can
    /// never succeed, which is the trap this whole screen exists to remove.
    ///
    /// **The refusal itself never advances anything** (rulings S1-R5, S1-R8): it only prompts a
    /// fresh `account.profile()` read, and only that list may say a step is done. A 403 from a
    /// host guard or a rule the server grows later finds the field still listed and shows its
    /// sentence, exactly as before.
    ///
    /// This is also what rescues a stale step: `Session.restore()` opens the gate offline from
    /// `UserCache`, whose `missing_fields` is the one from sign-in time, so a relaunch without
    /// a network can show a step the server has long since cleared. Nothing re-reads on its own
    /// when the gate appears, so that step stands until the student tries it once — then this
    /// lifts it, with no second copy of the verdict to keep in step.
    private func recoveredElsewhere(from step: ProfileCompletion.Step) async -> Bool {
        guard let fresh = try? await account.profile().missingFields,
              ProfileCompletion.isCleared(step, in: fresh) else { return false }
        await advance(from: step, knownMissing: fresh)
        return true
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
            // Django's verdict on the password belongs on this form. Anything else may mean
            // there is no first password left to choose (`recoveredElsewhere`).
            if !Self.isAboutTheValue(error), await recoveredElsewhere(from: .password) {
                password = ""
                passwordAgain = ""
                return
            }
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
            // about the account, not the number — and may mean the question is already answered
            // (`recoveredElsewhere`), so the form only speaks when it is still outstanding.
            if Self.isAboutTheValue(error) {
                phoneError = AccountCopy.phoneFailure(error)
            } else if await recoveredElsewhere(from: .phone) {
                // The question was answered elsewhere, so the number typed for it goes with it:
                // a later return to this step must not open on someone else's answer.
                phone = ""
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
            // Nothing was typed here, so every refusal may be the question already answered —
            // a lost reply, or the namesake's own account having answered it.
            if !(await recoveredElsewhere(from: .phone)) {
                self.error = AccountCopy.phoneFailure(error, fallback: AccountCopy.notMeFailed)
            }
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
            // second read; the decision is still `advance`'s alone. An answer without a
            // readable list is not taken for "nothing missing" — nil sends `advance` to
            // `/users/me/` for it.
            await advance(from: .names, knownMissing: profile.missingFields)
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
