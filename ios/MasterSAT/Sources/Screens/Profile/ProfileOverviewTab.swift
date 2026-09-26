import SwiftUI
import MasterSATKit

/// The profile's Overview — the web's `OverviewTab.tsx`, in the order it stacks on a phone:
/// the four figures, Your goal (with Latest results), Homework to do, Finish your profile,
/// and Payments, coming soon.
///
/// Each panel reads its own load from `ProfileModel` and fails on its own; the numbers open
/// the pages they come from.
struct ProfileOverviewTab: View {
    let user: CurrentUser
    let identity: ProfileIdentity
    let model: ProfileModel
    let onSetGoal: () -> Void
    let onConfirmEmail: () -> Void
    let onPickExamDate: (String?) -> Void
    let onRetry: (ProfileRetry) -> Void

    private var summary: ProfileHomework.Summary? {
        model.homework.value.map { ProfileHomework.summarise($0) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            statTiles
            goalPanel
            homeworkPanel
            checklistPanel
            ProfilePaymentsPanel()
        }
    }

    // MARK: - The four figures

    private static let failedLine = "Couldn't load this just now."

    private var statTiles: some View {
        let mine = model.rewards.value
        let counting = model.rewards.isPending
        return VStack(spacing: 10) {
            HStack(spacing: 10) {
                ProfileStatTile(
                    tone: ProfileTone.primary,
                    icon: "trophy.fill",
                    label: "XP",
                    value: mine.map { ScoreText.string($0.xp) } ?? (counting ? "…" : "—"),
                    detail: mine != nil ? "Earned by turning up and doing the work." : (counting ? "Counting…" : Self.failedLine),
                    cta: "Leaderboard",
                    explainer: .xp
                ) {
                    LeaderboardView()
                }
                .frame(maxHeight: .infinity)
                ProfileStatTile(
                    tone: ProfileTone.amber,
                    icon: "flame.fill",
                    label: "Strikes",
                    value: mine.map { ScoreText.string($0.strikes) } ?? (counting ? "…" : "—"),
                    detail: mine.map { ProfileWording.strikesDetail(currentStreak: $0.currentStreak, bestStreak: $0.bestStreak) }
                        ?? (counting ? "Counting…" : Self.failedLine),
                    cta: "Shop",
                    explainer: .strike
                ) {
                    ShopView()
                }
                .frame(maxHeight: .infinity)
            }
            .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 10) {
                ProfileStatTile(
                    tone: ProfileTone.emerald,
                    icon: "sparkles",
                    label: "Points",
                    value: mine.map { ScoreText.string($0.points) } ?? (counting ? "…" : "—"),
                    detail: mine.map { ProfileWording.coinsDetail($0.coins) } ?? (counting ? "Counting…" : Self.failedLine),
                    cta: "Points & coins",
                    explainer: .points
                ) {
                    PointsView()
                }
                .frame(maxHeight: .infinity)
                ProfileStatTile(
                    tone: ProfileTone.sky,
                    icon: "checklist",
                    label: "Homework",
                    value: summary.map(ProfileWording.homeworkValue) ?? (model.homework.isPending ? "…" : "—"),
                    detail: summary.map(ProfileWording.homeworkDetail)
                        ?? (model.homework.isPending ? "Counting…" : Self.failedLine),
                    cta: "All homework"
                ) {
                    AssessmentsListView()
                }
                .frame(maxHeight: .infinity)
            }
            .fixedSize(horizontal: false, vertical: true)

            // The homework figure's failure is answered by the Homework panel's own "Try
            // again"; the rewards have no panel of their own, so they get this line.
            if model.rewards.isFailed {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.warning)
                    Text("Your XP, strikes and points didn't load.")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    Button("Try again") { onRetry(.rewards) }
                        .buttonStyle(AccountPillButtonStyle(kind: .soft, tone: Theme.accent))
                        .disabled(model.rewards.isLoading)
                }
                .padding(12)
                .profileWell(Theme.warning, opacity: 0.09)
            }
        }
    }

    // MARK: - Your goal

    private var goalPanel: some View {
        ProfilePanel(
            icon: "target",
            tone: ProfileTone.primary,
            title: "Your goal",
            description: "Where you're aiming, and how your latest tests went."
        ) {
            Button(ProfileGoal.actionTitle(targetScore: user.targetScore), action: onSetGoal)
                .buttonStyle(AccountPillButtonStyle(kind: .soft, tone: ProfileTone.primary))
                .disabled(model.isSavingGoal)
        } content: {
            HStack(alignment: .top, spacing: 10) {
                targetWell
                testDayWell
            }
            .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 10) {
                ProfileEyebrow("Latest results")
                latestResults
            }
            .padding(.top, 4)
        }
    }

    private var targetWell: some View {
        VStack(alignment: .leading, spacing: 8) {
            ProfileEyebrow("Target score", tone: ProfileTone.primary)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(verbatim: ScoreText.string(user.targetScore))
                    .font(.system(size: 28, weight: .heavy))
                    .monospacedDigit()
                    .tracking(-0.8)
                if user.targetScore != nil {
                    Text(verbatim: "/ 1600")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            Text(verbatim: ProfileGoal.sectionsLine(total: user.targetScore, english: user.targetEnglish, math: user.targetMath))
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .profileWell(ProfileTone.primary)
    }

    /// The Test day well is where the date is changed: on the web "Change goal" opens a form
    /// holding the targets and the date together, and the app's goal sheet holds only the
    /// targets — so the date is picked here, from the same list Home's countdown offers.
    private var testDayWell: some View {
        let day = ProfileGoal.testDay(user.satExamDate)
        return ProfileExamDateMenu(
            current: user.satExamDate,
            options: model.examDates,
            isSaving: model.isSavingExamDate,
            onSelect: onPickExamDate,
            onRetry: { onRetry(.examDates) }
        ) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 4) {
                    ProfileEyebrow("Test day", tone: ProfileTone.amber)
                    Spacer(minLength: 4)
                    if model.isSavingExamDate {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(ProfileTone.amber)
                    }
                }
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(verbatim: day.value)
                        .font(.system(size: 28, weight: .heavy))
                        .monospacedDigit()
                        .tracking(-0.8)
                        .foregroundStyle(.primary)
                    if let unit = day.unit {
                        Text(verbatim: unit)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                Text(verbatim: day.detail)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .profileWell(ProfileTone.amber, opacity: 0.09)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .accessibilityLabel("Test day: \(day.value) \(day.unit ?? ""). \(day.detail)")
        .accessibilityHint("Choose your SAT date")
    }

    /// The three newest scored tests that are not midterms. Shown without a link: the app has
    /// no page for a mock's or a practice test's result — those are read on the website, where
    /// the test was sat — and a row that opens nothing is better than one that opens a dead end.
    @ViewBuilder private var latestResults: some View {
        let load = model.attempts
        if load.isPending {
            ProfilePlaceholderRows(count: 2, height: 54)
        } else if load.isFailed {
            ClassroomErrorState(
                title: "Your results didn't load.",
                message: "Nothing is lost — try again in a moment."
            ) { onRetry(.attempts) }
        } else {
            let rows = ProfileResults.recent(load.value ?? [])
            if rows.isEmpty {
                Text("Your scores show up here after your first practice test.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .profileWell(ProfileTone.primary, radius: 11)
            } else {
                VStack(spacing: 8) {
                    ForEach(rows) { attempt in
                        resultRow(attempt)
                    }
                }
            }
        }
    }

    private func resultRow(_ attempt: ProfileAttempt) -> some View {
        let math = ProfileResults.isMath(attempt)
        return HStack(spacing: 12) {
            IconTile(
                systemName: math ? "function" : "book.closed.fill",
                tone: math ? ProfileTone.sky : ProfileTone.emerald,
                size: 34
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: ProfileResults.title(attempt))
                    .font(.system(size: 13.5, weight: .bold))
                    .lineLimit(1)
                Text(verbatim: ProfileResults.detail(attempt))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(verbatim: ScoreText.string(attempt.score))
                .font(.system(size: 20, weight: .heavy))
                .monospacedDigit()
        }
        .profileRow()
        .accessibilityElement(children: .combine)
    }

    // MARK: - Homework to do

    private var homeworkPanel: some View {
        ProfilePanel(
            icon: "checklist",
            tone: ProfileTone.amber,
            title: "Homework to do",
            description: "The next pieces to start, the most urgent first."
        ) {
            NavigationLink {
                AssessmentsListView()
            } label: {
                HStack(spacing: 4) {
                    Text("All homework")
                    Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold))
                }
            }
            .buttonStyle(AccountPillButtonStyle(kind: .quiet, tone: ProfileTone.primary))
        } content: {
            homeworkContent
        }
    }

    @ViewBuilder private var homeworkContent: some View {
        let load = model.homework
        if load.isPending {
            ProfilePlaceholderRows(count: 3, height: 58)
        } else if load.isFailed {
            ClassroomErrorState(
                title: "Your homework didn't load.",
                message: "Nothing has changed on it — try again in a moment."
            ) { onRetry(.homework) }
        } else if let summary {
            let shown = Array(summary.toDo.prefix(4))
            if shown.isEmpty {
                HStack(spacing: 12) {
                    IconTile(systemName: "checkmark", tone: ProfileTone.emerald, size: 34)
                    Text(verbatim: ProfileWording.homeworkEmpty(summary))
                        .font(.system(size: 13.5, weight: .bold))
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(14)
                .profileWell(ProfileTone.emerald, opacity: 0.09)
            } else {
                VStack(spacing: 8) {
                    ForEach(shown) { row in
                        homeworkRow(row)
                    }
                }
            }
            let more = summary.toDo.count - shown.count
            if more > 0 {
                NavigationLink {
                    AssessmentsListView()
                } label: {
                    Text(verbatim: "\(more) more to do")
                        .font(.system(size: 12.5, weight: .bold))
                        .foregroundStyle(Theme.accent)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func homeworkRow(_ row: AssignmentListing) -> some View {
        let due = ProfileHomework.dueLabel(row.dueAt)
        let detail = ProfileHomework.rowDetail(row)
        return NavigationLink {
            if row.classroomId != nil {
                HomeworkDetailView(assignment: row)
            } else {
                AssessmentsListView()
            }
        } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(verbatim: row.title.isEmpty ? "Homework" : row.title)
                        .font(.system(size: 13.5, weight: .bold))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    HStack(spacing: 6) {
                        ProfileDueChip(due: due)
                        if !detail.isEmpty {
                            Text(verbatim: detail)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                        }
                    }
                }
                Spacer(minLength: 6)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
            .profileRow()
        }
        .buttonStyle(.plain)
    }

    // MARK: - Finish your profile

    /// Needs the fresh `/users/me/` — the phone and Telegram are only there — so it waits for
    /// it, and says so when it did not come.
    @ViewBuilder private var checklistPanel: some View {
        let load = model.account
        if let account = load.value {
            let items = ProfileChecklist.items(
                ProfileChecklist.Input(
                    realEmail: identity.email,
                    emailVerified: identity.emailVerified,
                    targetScore: user.targetScore,
                    examDate: user.satExamDate,
                    photoURL: identity.photoURL,
                    telegramLinked: account.telegramLinked,
                    phone: account.phoneNumber
                ),
                telegramAvailable: model.telegramSignIn?.canConnect == true
            )
            if items.contains(where: { !$0.done }) {
                finishPanel(items)
            } else {
                allSetPanel(items)
            }
        } else {
            ProfilePanel(icon: "person.crop.circle.badge.checkmark", tone: ProfileTone.violet, title: "Finish your profile") {
                if load.isFailed {
                    ClassroomErrorState(
                        title: "Your profile isn't loading right now.",
                        message: "Nothing has changed on your account — try again in a moment."
                    ) { onRetry(.account) }
                } else {
                    ProfilePlaceholderRows(count: 3, height: 52)
                }
            }
        }
    }

    private func finishPanel(_ items: [ProfileChecklist.Item]) -> some View {
        let done = items.filter { $0.done }
        return ProfilePanel(
            icon: "person.crop.circle.badge.checkmark",
            tone: ProfileTone.violet,
            title: "Finish your profile",
            description: ProfileChecklist.progress(items)
        ) {
            VStack(spacing: 8) {
                ForEach(items.filter { !$0.done }) { item in
                    checklistRow(item)
                }
            }
            if !done.isEmpty {
                RewardsFlowLayout(spacing: 12) {
                    ForEach(done) { item in
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark")
                                .font(.system(size: 11, weight: .heavy))
                                .foregroundStyle(ProfileTone.emerald)
                            Text(verbatim: item.doneLabel)
                        }
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        }
    }

    private func checklistRow(_ item: ProfileChecklist.Item) -> some View {
        HStack(spacing: 12) {
            Circle()
                .strokeBorder(ProfileTone.violet.opacity(0.45), lineWidth: 2)
                .frame(width: 20, height: 20)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.label)
                    .font(.system(size: 13.5, weight: .bold))
                Text(verbatim: item.hint)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            checklistAction(item)
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .profileWell(ProfileTone.violet, radius: 11, opacity: 0.08)
    }

    /// Each step goes where it is done: the email flow opens right here, the goal sheet and
    /// the date menu too, the rest open their page of Settings.
    @ViewBuilder private func checklistAction(_ item: ProfileChecklist.Item) -> some View {
        let style = AccountPillButtonStyle(kind: .soft, tone: ProfileTone.violet)
        switch item.key {
        case .email:
            Button(item.action, action: onConfirmEmail).buttonStyle(style)
        case .goal:
            Button(item.action, action: onSetGoal).buttonStyle(style).disabled(model.isSavingGoal)
        case .exam:
            ProfileExamDateMenu(
                current: user.satExamDate,
                options: model.examDates,
                isSaving: model.isSavingExamDate,
                onSelect: onPickExamDate,
                onRetry: { onRetry(.examDates) }
            ) {
                Text(verbatim: item.action)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(ProfileTone.violet)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(ProfileTone.violet.opacity(0.13)))
                    .contentShape(Capsule())
            }
        case .photo, .phone:
            NavigationLink { AccountDetailsView() } label: { Text(verbatim: item.action) }
                .buttonStyle(style)
        case .telegram:
            // Connecting is a browser flow the app cannot finish; Sign-in & password says how
            // to do it on the website.
            NavigationLink { AccountSignInView() } label: { Text(verbatim: item.action) }
                .buttonStyle(style)
        }
    }

    private func allSetPanel(_ items: [ProfileChecklist.Item]) -> some View {
        ProfilePanel(
            icon: "party.popper",
            tone: ProfileTone.emerald,
            title: "Your profile is all set",
            description: "Everything that makes it useful is filled in."
        ) {
            RewardsFlowLayout(spacing: 8) {
                ForEach(items) { item in
                    ProfileChip(text: item.doneLabel, icon: "checkmark", tone: ProfileTone.emerald)
                }
            }
        }
    }
}

// MARK: - Pieces

/// One of the student's own figures. The whole tile opens the page the figure comes from; the
/// "!" sits above it and opens its explainer instead.
private struct ProfileStatTile<Destination: View>: View {
    let tone: Color
    let icon: String
    let label: String
    let value: String
    let detail: String
    let cta: String
    var explainer: RewardsExplainer?
    @ViewBuilder let destination: () -> Destination

    var body: some View {
        NavigationLink {
            destination()
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    IconTile(systemName: icon, tone: tone, size: 32)
                    ProfileEyebrow(label)
                    Spacer(minLength: explainer == nil ? 0 : 26)
                }
                Text(verbatim: value)
                    .font(.system(size: 26, weight: .heavy))
                    .monospacedDigit()
                    .tracking(-0.6)
                    .foregroundStyle(tone)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .padding(.top, 12)
                Text(verbatim: detail)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 5)
                Spacer(minLength: 10)
                HStack(spacing: 4) {
                    Text(verbatim: cta)
                    Image(systemName: "arrow.right").font(.system(size: 10, weight: .bold))
                }
                .font(.system(size: 12.5, weight: .bold))
                .foregroundStyle(tone)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .cardStyle(padding: 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .topTrailing) {
            if let explainer {
                RewardsExplainButton(explainer: explainer).padding(5)
            }
        }
    }
}

/// When a piece of homework is due, in the colour of how soon.
private struct ProfileDueChip: View {
    let due: ProfileHomework.Due

    private var tone: Color {
        switch due.tone {
        case .catchUp: return ProfileTone.amber
        case .soon: return ProfileTone.primary
        case .later: return ProfileTone.sky
        case .none: return ProfileTone.violet
        }
    }

    var body: some View {
        Text(verbatim: due.text)
            .font(.system(size: 11, weight: .heavy))
            .foregroundStyle(tone)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(tone.opacity(0.13)))
            .fixedSize()
    }
}

/// Payments, before there is anything to pay here — the owner asked for the block with
/// "Coming soon" inside it, so the place exists before the feature does. It shows what is
/// coming and no figures at all: a made-up amount on a student's own profile would read as a
/// real bill.
private struct ProfilePaymentsPanel: View {
    private struct Preview: Identifiable {
        let icon: String
        let label: String
        var id: String { label }
    }

    private static let previews = [
        Preview(icon: "creditcard", label: "Pay for your course online"),
        Preview(icon: "calendar.badge.clock", label: "See when your next payment is due"),
        Preview(icon: "doc.text", label: "Keep every receipt in one place"),
    ]

    var body: some View {
        ProfilePanel(
            icon: "wallet.pass",
            tone: ProfileTone.violet,
            title: "Payments",
            description: "Your course payments, on your profile."
        ) {
            Text("Coming soon")
                .font(.system(size: 12, weight: .heavy))
                .foregroundStyle(ProfileTone.violet)
                .padding(.horizontal, 11)
                .padding(.vertical, 5)
                .background(Capsule().fill(ProfileTone.violet.opacity(0.13)))
        } content: {
            VStack(spacing: 8) {
                ForEach(Self.previews) { row in
                    HStack(spacing: 12) {
                        Image(systemName: row.icon)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(ProfileTone.violet)
                            .frame(width: 18)
                        Text(verbatim: row.label)
                            .font(.system(size: 13, weight: .semibold))
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 13)
                    .padding(.vertical, 11)
                    .profileWell(ProfileTone.violet, radius: 11, opacity: 0.07)
                    .overlay(
                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .strokeBorder(ProfileTone.violet.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                    )
                }
            }
            Text("Until then, payments are made at your learning center as usual.")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .overlay(alignment: .top) {
            LinearGradient(colors: [ProfileTone.violet, ProfileTone.violet.opacity(0.4), .clear], startPoint: .leading, endPoint: .trailing)
                .frame(height: 4)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Payments — coming soon")
    }
}
