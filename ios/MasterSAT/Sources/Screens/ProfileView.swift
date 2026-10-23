import SwiftUI
import UIKit
import MasterSATKit

/// The Me sheet, opened from the avatar in every tab's header — the web's `/profile`, in its
/// order and its words: who you are (the hero, with the sheet's close button), then three tabs.
///
/// - **Overview** does things: its four figures open their pages, Your goal sets the target and
///   the test day, Homework to do opens the homework, Midterms & certificates opens each result,
///   the checklist opens the step it names (or says the profile is all set), and Payments holds
///   its place, coming soon.
/// - **Classes** shows each class's next lesson, teacher and way in, then its classmates.
/// - **Settings** is the web's section menu.
///
/// Under the tabs, on every tab: My progress, then Sign out.
///
/// The tabs stay pinned under the sheet's top edge while the page scrolls, so another tab is
/// always one tap away. Which tab is open lives in `AppRouter` (`meTab`): the sheet reopens on
/// the tab last open in this launch, and a link into Me picks its own.
///
/// The sheet's root is a stack root, so everything it opens is pushed as a value it declares
/// here — `Route` for the account pages and the class page, `AssignmentListing` for a homework,
/// `AppLink` for the rest — which a link into the Me sheet can pop, and which SwiftUI never
/// drops the way it can a closure destination pushed from a root. Back lands on the tab and
/// the place the student left: the root stays put under what it pushed. Only the goal, the
/// email check, a class's Telegram group and a certificate open as sheets over it.
///
/// Every panel loads and fails on its own (`ProfileModel`), and a failure is never drawn as
/// "nothing here". The hero draws from the session's copy of the account at once, so the page
/// is never blank while the rest arrives.
struct ProfileView: View {
    let user: CurrentUser
    @Binding var path: NavigationPath
    @Binding var tab: MeTab
    let onClose: () -> Void

    /// Pages no `AppLink` names.
    enum Route: Hashable {
        case accountDetails, appearance, notifications, signIn, devices, about
        /// One of the student's classes, opened on the copy the Classes tab already holds.
        case classroom(id: Int)
    }

    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model = ProfileModel()
    @State private var shown = false
    @State private var showingGoal = false
    @State private var verifyingEmail = false
    @State private var confirmingSignOut = false
    @State private var certificate: MeCertificate?
    @State private var telegramClass: Classroom?
    /// The class whose Telegram sheet was last open — re-read when it closes, because the
    /// join itself happens in Telegram and the site only hears of it afterwards.
    @State private var telegramClassId: Int?
    @State private var toast: RewardsToastMessage?
    /// The hero has scrolled away and the tabs are pinned under the top edge.
    @State private var tabsPinned = false
    /// The pinned tabs' height, which a scroll to a panel must clear.
    @State private var tabBarHeight: CGFloat = 0

    /// Where the tabs rest when the hero is in view.
    private static let tabsAnchor = "me.tabs"

    /// The session's account, or what was just saved here while the session catches up.
    private var current: CurrentUser { model.savedUser ?? user }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                        hero
                            .stagger(0, shown: shown)
                            .padding(.bottom, 2)
                        Color.clear
                            .frame(height: 0)
                            .id(Self.tabsAnchor)
                            .onGeometryChange(for: Bool.self) { $0.frame(in: .scrollView).minY < 0 } action: { pinned in
                                if tabsPinned != pinned { tabsPinned = pinned }
                            }
                        Section {
                            // A stable container: the tab's branch flips under it, the entrance
                            // does not.
                            VStack(alignment: .leading, spacing: 16) {
                                tabContent(proxy)
                                underTheTabs
                            }
                            .padding(.top, 8)
                            .stagger(2, shown: shown)
                        } header: {
                            tabBar.stagger(1, shown: shown)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 16)
                }
                .onChange(of: tab) { _, now in
                    if now == .classes { Task { await model.openClasses(session) } }
                    // With the tabs pinned, the new tab starts at its own top, just under them —
                    // not part-way down, wherever the old tab had been scrolled to.
                    guard tabsPinned else { return }
                    var instant = Transaction()
                    instant.disablesAnimations = true
                    withTransaction(instant) { proxy.scrollTo(Self.tabsAnchor, anchor: .top) }
                }
            }
            .background(Theme.background)
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .accountDetails: AccountDetailsView()
                case .appearance: AppearanceView()
                case .notifications: NotificationSettingsView()
                case .signIn: AccountSignInView()
                case .devices: AccountDevicesView()
                case .about: AccountAboutView()
                case .classroom(let id):
                    if let room = model.memberClass(id) {
                        ClassroomDetailView(classroom: room)
                    } else {
                        LearnMoreClassroomView(classroomId: id)
                    }
                }
            }
            .navigationDestination(for: AssignmentListing.self) { HomeworkDetailView(assignment: $0) }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
            // Detached: a dozen requests run under it, and the page re-renders as each lands.
            .detachedRefresh { await model.refreshAll(session) }
            // Not `.task`: a push cancels a task, and a cancelled load would read as a failed one.
            .onAppear {
                if !shown { shown = true }
                Task { await model.appeared(session) }
                // The sheet can open straight onto Classes, the tab last left open. Beside the
                // first load, not after it: a class list on its way brings the tab's pieces.
                if tab == .classes { Task { await model.openClasses(session) } }
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
                .noBarClearance()
            }
            .sheet(item: $telegramClass, onDismiss: {
                if let id = telegramClassId { Task { await model.loadGroup(id, session: session) } }
            }) { room in
                ClassroomTelegramSheet(classroomId: room.id, className: room.name, initialState: model.groups[room.id]) { state in
                    model.setGroup(state, for: room.id)
                }
                .noBarClearance()
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

    // MARK: - Tabs

    private var tabs: [PillTabs<MeTab>.Item] {
        [
            .init(tab: .overview, title: "Overview", icon: "person.crop.circle"),
            .init(tab: .classes, title: "Classes", icon: "graduationcap", count: model.memberClasses?.count),
            .init(tab: .settings, title: "Settings", icon: "gearshape"),
        ]
    }

    /// On the page's own ground, reaching past the page's margins: pinned, the cards scroll
    /// under it and must not show at its sides. The room above the pills clears the sheet's
    /// grabber once they are pinned to the top edge.
    private var tabBar: some View {
        PillTabs(items: tabs, selection: tabSelection)
            .padding(.top, 14)
            .padding(.bottom, 8)
            .background(Theme.background.padding(.horizontal, -16))
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                if tabBarHeight != height { tabBarHeight = height }
            }
    }

    /// The router's tab, written only when it changes: re-tapping the open pill would otherwise
    /// write an equal value, and every write to the router notifies the root.
    private var tabSelection: Binding<MeTab> {
        Binding(get: { tab }, set: { next in if tab != next { tab = next } })
    }

    @ViewBuilder private func tabContent(_ proxy: ScrollViewProxy) -> some View {
        switch tab {
        case .overview:
            ProfileOverviewTab(
                user: current,
                identity: identity,
                model: model,
                onSetGoal: { showingGoal = true },
                onConfirmEmail: { verifyingEmail = true },
                onPickExamDate: pickExamDate,
                onCertificate: { certificate = $0 },
                onRetry: { await retry($0) }
            )
        case .classes:
            ProfileClassesTab(
                model: model,
                selfId: current.id,
                onRetry: { await retry($0) },
                onClassmates: { room in
                    Task { await model.select(room.id, session: session) }
                    withAnimation(reduceMotion ? Motion.focus : Motion.snappy) {
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
                },
                classmatesLift: tabBarHeight + 8
            )
        case .settings:
            ProfileSettingsTab(emailNeedsConfirming: !identity.emailConfirmed)
        }
    }

    // MARK: - Under the tabs

    /// My progress, then Sign out — on every tab. Surveys and Events moved to the Explore tab.
    private var underTheTabs: some View {
        VStack(spacing: 10) {
            AccountMenuRow(
                icon: "chart.line.uptrend.xyaxis", tone: Theme.accent,
                title: "My progress", hint: "How you're doing, beside your group",
                route: AppLink.progress
            )
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
        case .midterms: await model.loadMidterms(session)
        case .classes: await model.retryClasses(session)
        case .schedule: await model.loadSchedule(session)
        case .people: await model.loadSelectedPeople(session, force: true)
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
///
/// At the accessibility sizes it is a column: the photo above the name, the close button on a
/// row of its own above both, the buttons wrapping. Nothing in it may be wider than the phone:
/// one fixed-width piece once widened the page's whole column, and the ScrollView centred it,
/// cutting the photo off at the left and the close button off at the right.
private struct ProfileHeroCard: View {
    let identity: ProfileIdentity
    let onConfirmEmail: () -> Void
    let onCopyUsername: () -> Void
    let onClose: () -> Void

    @Environment(\.dynamicTypeSize) private var typeSize

    private var stacked: Bool { typeSize.isAccessibilitySize }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if stacked {
                // Its own row: in the corner it would sit on the name. The circle lines up with
                // the content's edge; the target reaches into the card's padding.
                closeButton.padding(-6)
            }
            AdaptiveStack(spacing: 14, columnSpacing: 12) {
                AccountAvatar(url: identity.photoURL, name: identity.name, size: 72)
                    .padding(4)
                    .background(
                        RoundedRectangle(cornerRadius: 80 * 0.3, style: .continuous).fill(Theme.accent.opacity(0.1))
                    )
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 5) {
                        Image(systemName: "person.crop.circle").appFont(11, weight: .bold)
                            .accessibilityHidden(true)
                        Text(verbatim: "Profile · \(identity.role)").appFont(12, weight: .heavy)
                            .accessibilityLabel("Profile, \(identity.role)")
                    }
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Theme.accentSoft))

                    Text(verbatim: identity.name)
                        .appFont(25, weight: .heavy)
                        .tracking(-0.6)
                        .foregroundStyle(.primary)
                        .titleLineLimit(2)
                        .minimumScaleFactor(0.8)
                        .accessibilityAddTraits(.isHeader)
                    if !identity.username.isEmpty {
                        Text(verbatim: "@\(identity.username)")
                            .appFont(14.5, weight: .medium)
                            .foregroundStyle(Theme.textSecondary)
                            .titleLineLimit(1)
                    }
                }
            }
            // The close button's corner: a long name wraps before it reaches it. Stacked, the
            // button has its own row and the name the whole width.
            .padding(.trailing, stacked ? 0 : 30)

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

            // Wrapping, not squeezed: side by side they cut "Copy username" mid-word at the
            // largest sizes.
            ProfileFlowLayout(spacing: 8) {
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
            }
        }
        .cardStyle(padding: 20)
        // The page's colours as one thin edge: the student's own blue, what is coming, what
        // is done.
        .cardToneBar(
            LinearGradient(
                colors: [ProfileTone.primary, ProfileTone.violet, ProfileTone.emerald],
                startPoint: .leading,
                endPoint: .trailing
            ),
            height: 4
        )
        .overlay(alignment: .topTrailing) {
            if !stacked { closeButton.padding(6) }
        }
        // A container, so the close button's sort priority orders it among the hero's own parts.
        .accessibilityElement(children: .contain)
    }

    /// A 32-pt circle in a 44-pt target — a thumb's size, whatever the circle's.
    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .appFont(14, weight: .bold)
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 32, height: 32)
                .background(Theme.surface2, in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressBounce())
        .accessibilityLabel("Close")
        .capDynamicType(label: "Close", systemImage: "xmark")
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
                .appFont(14, weight: .semibold)
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
            Text(value)
                .appFont(14, weight: .bold)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 11)
    }
}
