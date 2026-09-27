import SwiftUI
import MasterSATKit

/// Proving an email address: the address, a six-digit code mailed to it, then the code.
///
/// The web's `EmailVerificationModal`, step for step and in its words. The same flow is
/// inlined in the profile-completion screen, as the web inlines it in its gate, so it is one
/// view with two hosts rather than two copies that drift.
struct AccountEmailCodeFlow: View {
    enum Step { case address, code }
    private enum Focus: Hashable { case email, code }

    let initialEmail: String
    /// The gate keeps "Confirm your email" through both steps; the sheet, like the web's
    /// modal, retitles the second one "Enter the code".
    var fixedTitle: String?
    /// Mirrors the flow's own busy state, so a host can stop being dismissed mid-request.
    @Binding var isBusy: Bool
    /// Called once the server has confirmed the address, with the address it now holds.
    let onVerified: @MainActor (String) async -> Void

    @Environment(Session.self) private var session
    @State private var step: Step = .address
    @State private var email = ""
    /// The address the live code was sent to. Confirming always names this one, whatever the
    /// address box says by then.
    @State private var sentTo = ""
    @State private var code = ""
    @State private var error: String?
    @State private var busy = false
    @State private var sentAt: Date?
    @State private var lifetimeMinutes = EmailCodeEntry.defaultLifetimeMinutes
    @State private var seeded = false
    @FocusState private var focus: Focus?

    private var account: AccountAPI { AccountAPI(client: session.client) }

    private var title: String {
        if let fixedTitle { return fixedTitle }
        return step == .address ? "Confirm your email" : "Enter the code"
    }

    private var description: String {
        step == .address
            ? "We'll send a 6-digit code to make sure this address reaches you."
            : "We sent a code to \(sentTo). It expires in \(lifetimeMinutes) minutes."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(verbatim: title)
                    .font(.system(size: 24, weight: .heavy))
                    .tracking(-0.5)
                // Verbatim: the sentence carries an email address, which a LocalizedStringKey
                // would turn into a link.
                Text(verbatim: description)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let error {
                AuthAlert(tone: .danger, message: error)
            }

            switch step {
            case .address: addressStep
            case .code: codeStep
            }

            HStack(alignment: .top, spacing: 7) {
                Image(systemName: "checkmark.shield")
                    .font(.system(size: 13, weight: .semibold))
                    .padding(.top, 1)
                Text("Confirming sets this as the address for your account.")
                    .font(.system(size: 13, weight: .medium))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(Theme.textSecondary)
        }
        .onAppear {
            guard !seeded else { return }
            seeded = true
            email = initialEmail
        }
        .onChange(of: busy) { _, value in isBusy = value }
    }

    // MARK: Steps

    private var addressStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            AccountTextField(
                label: "Email address",
                icon: "envelope",
                text: Binding(get: { email }, set: { email = $0; error = nil }),
                prompt: "name@example.com",
                contentType: .emailAddress,
                keyboard: .emailAddress,
                capitalization: .never,
                submitLabel: .send,
                focus: $focus,
                field: Focus.email,
                onSubmit: { if !busy { Task { await send() } } }
            )
            Button {
                Task { await send() }
            } label: {
                Group {
                    if busy { ProgressView().tint(.white) } else { Text("Send code") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(busy)
        }
    }

    private var codeStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            TextField(text: Binding(
                get: { code },
                set: { code = EmailCodeEntry.sanitize($0); error = nil }
            ), prompt: Text(verbatim: "••••••")) {
                Text("Verification code")
            }
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .focused($focus, equals: .code)
            .multilineTextAlignment(.center)
            .font(.system(size: 30, weight: .bold, design: .rounded).monospacedDigit())
            .tracking(10)
            .padding(.vertical, 14)
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(focus == .code ? Theme.accent : Theme.separator.opacity(0.7), lineWidth: 2)
            )
            .accessibilityLabel("Verification code")

            Button {
                Task { await confirm() }
            } label: {
                Group {
                    if busy { ProgressView().tint(.white) } else { Text("Confirm") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(busy || !EmailCodeEntry.isComplete(code))

            HStack {
                Button("Use a different address") {
                    step = .address
                    error = nil
                    focus = .email
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .disabled(busy)

                Spacer(minLength: 8)

                // Redrawn once a second only while the cooldown runs.
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let left = EmailCodeEntry.cooldownRemaining(sentAt: sentAt, now: context.date)
                    Button(left > 0 ? "Resend in \(left)s" : "Resend code") {
                        Task { await send(resending: true) }
                    }
                    .font(.system(size: 13, weight: .semibold).monospacedDigit())
                    .foregroundStyle(left > 0 || busy ? Theme.textLabel : Theme.accent)
                    .disabled(busy || left > 0)
                }
            }
        }
    }

    // MARK: Actions

    private func send(resending: Bool = false) async {
        let target = resending ? sentTo : email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else {
            error = AccountCopy.emailRequired
            return
        }
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let sent = try await account.requestEmailCode(target)
            lifetimeMinutes = sent.expiresInMinutes
            sentTo = target
            sentAt = Date()
            code = ""
            step = .code
            focus = .code
        } catch {
            self.error = AccountCopy.emailRequestFailure(error)
        }
    }

    private func confirm() async {
        guard EmailCodeEntry.isComplete(code) else {
            error = AccountCopy.codeRequired
            return
        }
        guard !busy else { return }
        busy = true
        error = nil
        do {
            let confirmed = try await account.confirmEmailCode(email: sentTo, code: code)
            await onVerified(confirmed.email.isEmpty ? sentTo : confirmed.email)
            busy = false
        } catch {
            self.error = AccountCopy.emailConfirmFailure(error)
            code = ""
            focus = .code
            busy = false
        }
    }
}

/// The flow as its own sheet — "Add email", "Confirm", "Change" in Sign-in & password, and the
/// settings page's nudge.
struct AccountEmailVerificationSheet: View {
    let currentEmail: String
    /// Runs before the sheet closes: refresh what the address changed, say so.
    let onVerified: @MainActor (String) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false

    var body: some View {
        NavigationStack {
            ScrollView {
                AccountEmailCodeFlow(initialEmail: currentEmail, isBusy: $busy) { confirmed in
                    await onVerified(confirmed)
                    dismiss()
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.background)
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }.disabled(busy)
                }
            }
        }
        // Mid-request, closing would strand a sent code or a half-confirmed address.
        .interactiveDismissDisabled(busy)
    }
}
