import SwiftUI
import UIKit
import MasterSATKit

/// The Profile tab — the web's `/profile`, rebuilt on the site on 2026-09-12 and 2026-09-14,
/// in its order and its words: who you are (the hero), then three tabs.
///
/// - **Overview** does things: its figures open their pages, its checklist opens the step it
///   names, homework to do opens the homework, and Payments holds its place, coming soon.
/// - **Classes** shows each class's next lesson, teacher and way in, then its classmates.
/// - **Settings** is the web's section menu. Study goal and Appearance are not in it: the
///   goal is set from Overview (and Home), and the app follows the phone's own light/dark.
///
/// Under the tabs, on every tab: the rows the web's account menu carries on a phone —
/// Surveys and Events — and Sign out.
///
/// Every panel loads and fails on its own (`ProfileModel`), and a failure is never drawn as
/// "nothing here". The hero draws from the session's copy of the account at once, so the page
/// is never blank while the rest arrives.
struct ProfileView: View {
    let user: CurrentUser

    enum Tab: Hashable { case overview, classes, settings }

    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var model = ProfileModel()
    @State private var tab: Tab = .overview
    @State private var showingGoal = false
    @State private var verifyingEmail = false
    @State private var confirmingSignOut = false
    @State private var telegramClass: Classroom?
    /// The class whose Telegram sheet was last open — re-read when it closes, because the
    /// join itself happens in Telegram and the site only hears of it afterwards.
    @State private var telegramClassId: Int?
    @State private var toast: RewardsToastMessage?

    /// The session's account, or what was just saved here while the session catches up.
    private var current: CurrentUser { model.savedUser ?? user }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        hero
                        PillTabs(items: tabs, selection: $tab)
                        switch tab {
                        case .overview: overview
                        case .classes: classes(proxy)
                        case .settings: settings
                        }
                        moreRows
                    }
                    .padding(16)
                }
            }
            .background(Theme.background)
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await model.refreshAll(session) }
            // Not `.task`: a push cancels a task, and a cancelled load would read as a failed one.
            .onAppear { Task { await model.appeared(session) } }
            .onChange(of: tab) { _, now in
                if now == .classes { Task { await model.openClasses(session) } }
            }
            // The session caught up with a save made here (or with an edit made elsewhere).
            .onChange(of: user) { model.savedUser = nil }
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
            .sheet(item: $telegramClass, onDismiss: {
                if let id = telegramClassId { Task { await model.loadGroup(id, session: session) } }
            }) { room in
                ClassroomTelegramSheet(classroomId: room.id, className: room.name, initialState: model.groups[room.id]) { state in
                    model.groups[room.id] = state
                }
            }
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
            onCopyUsername: copyUsername
        )
    }

    private func copyUsername() {
        let username = identity.username
        guard !username.isEmpty else { return }
        UIPasteboard.general.string = username
        toast = .accountSuccess(ProfileWording.copied(username: username))
    }

    // MARK: - Tabs

    private var tabs: [PillTabs<Tab>.Item] {
        [
            .init(tab: .overview, title: "Overview", icon: "person.crop.circle"),
            .init(tab: .classes, title: "Classes", icon: "graduationcap", count: model.memberClasses?.count),
            .init(tab: .settings, title: "Settings", icon: "gearshape"),
        ]
    }

    private var overview: some View {
        ProfileOverviewTab(
            user: current,
            identity: identity,
            model: model,
            onSetGoal: { showingGoal = true },
            onConfirmEmail: { verifyingEmail = true },
            onPickExamDate: pickExamDate,
            onRetry: { load in Task { await retry(load) } }
        )
    }

    private func classes(_ proxy: ScrollViewProxy) -> some View {
        ProfileClassesTab(
            model: model,
            selfId: current.id,
            onRetry: { load in Task { await retry(load) } },
            onClassmates: { room in
                Task { await model.select(room.id, session: session) }
                withAnimation(.easeInOut(duration: 0.3)) {
                    proxy.scrollTo(ProfileClassesTab.classmatesAnchor, anchor: .top)
                }
            },
            onTelegram: { room, button in
                switch button {
                case .join:
                    telegramClassId = room.id
                    telegramClass = room
                case .link(let raw): if let url = URL(string: raw) { openURL(url) }
                case .none: break
                }
            }
        )
    }

    private var settings: some View {
        ProfileSettingsTab(emailNeedsConfirming: !identity.emailConfirmed)
    }

    // MARK: - Under the tabs

    /// The web's account menu on a phone — Surveys and Events are always there, never gated
    /// on a count: for a student who has answered every survey this row is the only way to
    /// the surveys page. Then Sign out.
    private var moreRows: some View {
        VStack(spacing: 10) {
            ProfileLinkRow(
                icon: "list.clipboard",
                title: "Surveys",
                subtitle: "Tell the learning center how it's going",
                badge: model.openSurveys.flatMap { $0 > 0 ? "\($0) open" : nil }
            ) {
                SurveysListView()
            }
            ProfileLinkRow(
                icon: "calendar",
                title: "Events",
                subtitle: "What's coming up, and your tickets",
                badge: model.openEvents.flatMap { $0 > 0 ? "\($0) open" : nil }
            ) {
                EventsView()
            }
            Button("Sign out") { confirmingSignOut = true }
                .buttonStyle(PrimaryButtonStyle(tone: Theme.danger, fullWidth: true))
                .padding(.top, 6)
        }
        .padding(.top, 8)
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
        case .rewards: await model.loadRewards(session)
        case .homework: await model.loadHomework(session)
        case .attempts: await model.loadAttempts(session)
        case .examDates: await model.loadExamDates(session)
        case .classes: await model.retryClasses(session)
        case .schedule: await model.loadSchedule(session)
        case .people: await model.loadSelectedPeople(session, force: true)
        }
    }
}

/// Which panel's "Try again" was pressed.
enum ProfileRetry {
    case account, rewards, homework, attempts, examDates, classes, schedule, people
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
private struct ProfileHeroCard: View {
    let identity: ProfileIdentity
    let onConfirmEmail: () -> Void
    let onCopyUsername: () -> Void

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
                        Text(verbatim: "Profile · \(identity.role)").font(.system(size: 12, weight: .heavy))
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
                NavigationLink {
                    AccountDetailsView()
                } label: {
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
    }
}

// MARK: - Rows

/// A row that opens a page: the tile, what it is, one line on what is behind it, and a count
/// when there is something open.
private struct ProfileLinkRow<Destination: View>: View {
    let icon: String
    let title: String
    let subtitle: String
    var badge: String?
    @ViewBuilder let destination: () -> Destination

    var body: some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: 13) {
                IconTile(systemName: icon, tone: Theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                if let badge {
                    Text(badge)
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Theme.accentSoft))
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
            .cardStyle()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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

struct AvatarView: View {
    let user: CurrentUser

    var body: some View {
        Group {
            if let raw = user.profileImageURL, let url = URL(string: raw) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initials
                }
            } else {
                initials
            }
        }
        .frame(width: 52, height: 52)
        .clipShape(Circle())
        .overlay(Circle().stroke(.white.opacity(0.5), lineWidth: 2))
    }

    private var initials: some View {
        ZStack {
            Circle().fill(.white.opacity(0.22))
            Text(user.initials).font(.system(size: 18, weight: .heavy)).foregroundStyle(.white)
        }
    }
}
