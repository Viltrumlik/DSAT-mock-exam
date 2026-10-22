import SwiftUI
import UIKit
import MasterSATKit

/// The Me sheet, opened from the avatar in every tab's header — one page, top to bottom: who
/// you are (the hero, with the sheet's close button), Your goal, My progress, Midterms &
/// certificates, the settings rows, Finish your profile while a step is still missing,
/// Payments (coming soon), and Sign out.
///
/// The sheet's root is a stack root, so everything it opens is pushed as a value it declares
/// here — `Route` for the account pages, `AppLink` for the rest — which a link into the Me
/// sheet can pop, and which SwiftUI never drops the way it can a closure destination pushed
/// from a root. Only the goal, the email check and a certificate open as sheets over it.
///
/// Every panel loads and fails on its own (`ProfileModel`), and a failure is never drawn as
/// "nothing here". The hero draws from the session's copy of the account at once, so the page
/// is never blank while the rest arrives.
struct ProfileView: View {
    let user: CurrentUser
    @Binding var path: NavigationPath
    let onClose: () -> Void

    /// The account pages, which no `AppLink` names.
    enum Route: Hashable { case accountDetails, notifications, signIn, devices, about }

    @Environment(Session.self) private var session
    @State private var model = ProfileModel()
    @State private var shown = false
    @State private var showingGoal = false
    @State private var verifyingEmail = false
    @State private var confirmingSignOut = false
    @State private var certificate: MeCertificate?
    @State private var toast: RewardsToastMessage?

    /// The session's account, or what was just saved here while the session catches up.
    private var current: CurrentUser { model.savedUser ?? user }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    hero.stagger(0, shown: shown)
                    ProfileGoalPanel(
                        user: current,
                        model: model,
                        onSetGoal: { showingGoal = true },
                        onPickExamDate: pickExamDate,
                        onRetry: { await retry($0) }
                    )
                    .stagger(1, shown: shown)
                    AccountMenuRow(
                        icon: "chart.line.uptrend.xyaxis", tone: Theme.accent,
                        title: "My progress", hint: "How you're doing, beside your group",
                        route: AppLink.progress
                    )
                    .stagger(2, shown: shown)
                    MeMidtermsPanel(
                        model: model,
                        onRetry: { await retry(.midterms) },
                        onCertificate: { certificate = $0 }
                    )
                    .stagger(3, shown: shown)
                    ProfileSettingsRows(emailNeedsConfirming: !identity.emailConfirmed)
                        .stagger(4, shown: shown)
                    checklist
                    ProfilePaymentsPanel()
                        .stagger(6, shown: shown)
                    Button("Sign out") { confirmingSignOut = true }
                        .buttonStyle(PrimaryButtonStyle(tone: Theme.danger, fullWidth: true))
                        .padding(.top, 6)
                        .stagger(7, shown: shown)
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .accountDetails: AccountDetailsView()
                case .notifications: NotificationSettingsView()
                case .signIn: AccountSignInView()
                case .devices: AccountDevicesView()
                case .about: AccountAboutView()
                }
            }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
            // Detached: six requests run under it, and the page re-renders as each lands.
            .detachedRefresh { await model.refreshAll(session) }
            // Not `.task`: a push cancels a task, and a cancelled load would read as a failed one.
            .onAppear {
                if !shown { shown = true }
                Task { await model.appeared(session) }
            }
            .onChange(of: user) { model.sessionCaughtUp() }
            .sheet(isPresented: $showingGoal) {
                let start = ProfileGoal.sectionTargets(
                    total: current.targetScore, english: current.targetEnglish, math: current.targetMath
                )
                GoalSheet(english: start.english ?? 700, math: start.math ?? 700) { english, math in
                    if !(await model.saveGoal(english: english, math: math, session: session)) {
                        toast = .accountNotice(AccountCopy.detailsFailed)
                    }
                }
                .presentationDetents([.height(430)])
            }
            .sheet(isPresented: $verifyingEmail) {
                AccountEmailVerificationSheet(currentEmail: identity.email) { _ in
                    toast = .accountSuccess(AccountCopy.emailConfirmed)
                    await session.refreshUser()
                    await model.loadAccount(session)
                }
            }
            // Over the Me sheet, not through `AppRouter`: its certificate sheet would close Me.
            .sheet(item: $certificate) { MidtermCertificateSheet(code: $0.code, title: $0.title) }
            .confirmationDialog("Sign out of MasterSAT?", isPresented: $confirmingSignOut) {
                Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                Button("Cancel", role: .cancel) {}
            }
            .rewardsToast($toast)
        }
    }

    // MARK: - Who this is

    /// The session's account for the goal and the name; the fresh `/users/me/` for what only
    /// it carries — the phone and Telegram — once it is in.
    private var identity: ProfileIdentity {
        ProfileIdentity(user: current, account: model.account.value)
    }

    private var hero: some View {
        ProfileHeroCard(
            identity: identity,
            onConfirmEmail: { verifyingEmail = true },
            onCopyUsername: copyUsername,
            onClose: onClose
        )
    }

    private func copyUsername() {
        let username = identity.username
        guard !username.isEmpty else { return }
        UIPasteboard.general.string = username
        toast = .accountSuccess(ProfileWording.copied(username: username))
    }

    // MARK: - Finish your profile

    /// Only while a step is missing — a finished checklist need not take space — or when the
    /// account it is worked out from failed to load, which must not read as "all done".
    /// Nothing while that account is on its way: the panel may not be wanted at all.
    @ViewBuilder private var checklist: some View {
        if let content = checklistContent {
            // Staggered inside the branch: the panel can arrive after the entrance has run.
            ProfileChecklistPanel(
                content: content,
                user: current,
                model: model,
                onSetGoal: { showingGoal = true },
                onConfirmEmail: { verifyingEmail = true },
                onPickExamDate: pickExamDate,
                onRetry: { await retry($0) }
            )
            .stagger(5, shown: shown)
        }
    }

    private var checklistContent: ProfileChecklistPanel.Content? {
        if let account = model.account.value {
            let items = ProfileChecklistPanel.items(
                user: current, identity: identity, account: account, telegram: model.telegramSignIn
            )
            return items.contains { !$0.done } ? .missing(items) : nil
        }
        return model.account.isFailed ? .failed : nil
    }

    // MARK: - Actions

    private func pickExamDate(_ date: String?) {
        Task {
            if !(await model.saveExamDate(date, session: session)) {
                toast = .accountNotice(AccountCopy.detailsFailed)
            }
        }
    }

    private func retry(_ load: ProfileRetry) async {
        switch load {
        case .account: await model.loadAccount(session)
        case .attempts: await model.loadAttempts(session)
        case .examDates: await model.loadExamDates(session)
        case .midterms: await model.loadMidterms(session)
        }
    }
}

/// Who the profile is about, from the two copies of the account the app holds: the session's
/// (`CurrentUser` — at hand at once, and the goal's source) and the page's fresh `/users/me/`
/// (`AccountProfile` — the only one carrying the phone and Telegram).
struct ProfileIdentity {
    let id: Int
    let name: String
    let username: String
    let role: String
    let photoURL: String?
    /// The address to show, or `""` when there is none.
    let email: String
    let emailVerified: Bool
    /// Nil until `/users/me/` has answered: unknown is not "none".
    let phone: String?
    let telegramLinked: Bool?

    init(user: CurrentUser, account: AccountProfile?) {
        id = user.id
        let first = account?.firstName ?? user.firstName ?? ""
        let last = account?.lastName ?? user.lastName ?? ""
        let handle = (account?.username ?? user.username ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let full = "\(first) \(last)".trimmingCharacters(in: .whitespacesAndNewlines)
        name = full.isEmpty ? (handle.isEmpty ? user.displayName : handle) : full
        username = handle
        role = ProfileWording.roleLabel(account?.role ?? user.role)
        // Once `/users/me/` has answered, its "no photo" is an answer too — a photo just
        // removed must not come back from the session's older copy.
        let photo = account.map { $0.profileImageURL } ?? user.profileImageURL
        photoURL = photo.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
        email = (account?.realEmail ?? user.email).trimmingCharacters(in: .whitespacesAndNewlines)
        emailVerified = account?.emailVerified ?? user.emailVerified ?? false
        phone = account.map { $0.phoneNumber.trimmingCharacters(in: .whitespacesAndNewlines) }
        telegramLinked = account?.telegramLinked
    }

    /// Present and proved — the only state the site calls confirmed.
    var emailConfirmed: Bool { !email.isEmpty && emailVerified }
}

// MARK: - The hero

/// Who this is, on a white panel like every other page's hero on the site — the web's
/// `ProfileHero`: the photo, "Profile · Student", the name and handle, what is on the account
/// (a confirmed email, or an amber way to confirm one; Telegram; the phone), then Edit profile
/// and Copy username.
///
/// The sheet's close button sits in its top-trailing corner. It is part of the root page, not
/// laid over the sheet, so a pushed page keeps its own back button and nothing covers a toolbar.
private struct ProfileHeroCard: View {
    let identity: ProfileIdentity
    let onConfirmEmail: () -> Void
    let onCopyUsername: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 14) {
                AccountAvatar(url: identity.photoURL, name: identity.name, size: 72)
                    .padding(4)
                    .background(
                        RoundedRectangle(cornerRadius: 80 * 0.3, style: .continuous).fill(Theme.accent.opacity(0.1))
                    )
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 5) {
                        Image(systemName: "person.crop.circle").font(.system(size: 11, weight: .bold))
                            .accessibilityHidden(true)
                        Text(verbatim: "Profile · \(identity.role)").font(.system(size: 12, weight: .heavy))
                            .accessibilityLabel("Profile, \(identity.role)")
                    }
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Theme.accentSoft))

                    Text(verbatim: identity.name)
                        .font(.system(size: 25, weight: .heavy))
                        .tracking(-0.6)
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                    if !identity.username.isEmpty {
                        Text(verbatim: "@\(identity.username)")
                            .font(.system(size: 14.5, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                    }
                }
            }
            // The close button's corner: a long name wraps before it reaches it.
            .padding(.trailing, 30)

            ProfileFlowLayout(spacing: 8) {
                if identity.emailConfirmed {
                    ProfileChip(text: identity.email, icon: "envelope.fill", tone: ProfileTone.emerald)
                } else {
                    // Not a warning: an action, in the colour of things that are still to do.
                    ProfileChip(
                        text: identity.email.isEmpty ? "Add your email" : "Confirm your email",
                        icon: "envelope.badge",
                        tone: ProfileTone.amber,
                        action: onConfirmEmail
                    )
                }
                if identity.telegramLinked == true {
                    ProfileChip(text: "Telegram connected", icon: "paperplane.fill", tone: ProfileTone.sky)
                }
                if let phone = identity.phone, !phone.isEmpty {
                    ProfileChip(text: phone, icon: "phone.fill", tone: ProfileTone.violet)
                }
            }

            HStack(spacing: 8) {
                NavigationLink(value: ProfileView.Route.accountDetails) {
                    Label("Edit profile", systemImage: "pencil")
                }
                .buttonStyle(AccountPillButtonStyle(kind: .solid, tone: Theme.accent))

                if !identity.username.isEmpty {
                    Button(action: onCopyUsername) {
                        Label("Copy username", systemImage: "doc.on.doc")
                    }
                    .buttonStyle(AccountPillButtonStyle(kind: .soft, tone: Theme.accent))
                }
                Spacer(minLength: 0)
            }
        }
        .cardStyle(padding: 20)
        // The page's colours as one thin edge: the student's own blue, what is coming, what
        // is done.
        .overlay(alignment: .top) {
            LinearGradient(
                colors: [ProfileTone.primary, ProfileTone.violet, ProfileTone.emerald],
                startPoint: .leading,
                endPoint: .trailing
            )
            .frame(height: 4)
            .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .overlay(alignment: .topTrailing) { closeButton }
        // A container, so the close button's sort priority orders it among the hero's own parts.
        .accessibilityElement(children: .contain)
    }

    /// A 32-pt circle in a 44-pt target — a thumb's size, whatever the circle's.
    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 32, height: 32)
                .background(Theme.surface2, in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressBounce())
        .padding(6)
        .accessibilityLabel("Close")
        // Laid over the hero, it would come after the hero's chips and buttons: the way out of the
        // sheet is the first thing VoiceOver finds, not the last of the hero.
        .accessibilitySortPriority(1)
    }
}

struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
            Text(value)
                .font(.system(size: 14, weight: .bold))
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 11)
    }
}
