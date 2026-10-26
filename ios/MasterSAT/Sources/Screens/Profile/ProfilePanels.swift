import SwiftUI
import MasterSATKit

// Overview's panels — the web's `OverviewTab.tsx` pieces: Your goal (with Latest results),
// Finish your profile (or "all set"), and Payments. Each reads its own load from
// `ProfileModel` and fails on its own.

/// Which panel's "Try again" was pressed.
enum ProfileRetry {
    case account, rewards, homework, attempts, examDates, midterms, finance, classes, schedule, people
}

// MARK: - Your goal

/// The target score, the test day (where the date is changed) and the latest results.
struct ProfileGoalPanel: View {
    let user: CurrentUser
    let model: ProfileModel
    let onSetGoal: () -> Void
    let onPickExamDate: (String?) -> Void
    let onRetry: @MainActor (ProfileRetry) async -> Void

    var body: some View {
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
            // Two wells side by side; stacked at the accessibility sizes, where each would be half
            // the phone's width.
            AdaptiveStack(rowAlignment: .top, spacing: 10) {
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
                    .appFont(28, weight: .heavy, monospacedDigits: true)
                    .tracking(-0.8)
                if user.targetScore != nil {
                    Text(verbatim: "/ 1600")
                        .appFont(14, weight: .bold)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            Text(verbatim: ProfileGoal.sectionsLine(total: user.targetScore, english: user.targetEnglish, math: user.targetMath))
                .appFont(12.5, weight: .medium)
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
    /// targets — so the date is picked here, from the same list Today's countdown offers.
    private var testDayWell: some View {
        let day = ProfileGoal.testDay(user.satExamDate)
        return ProfileExamDateMenu(
            current: user.satExamDate,
            options: model.examDates,
            isSaving: model.isSavingExamDate,
            onSelect: onPickExamDate,
            onRetry: { Task { await onRetry(.examDates) } }
        ) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 4) {
                    ProfileEyebrow("Test day", tone: ProfileTone.amber)
                    Spacer(minLength: 4)
                    if model.isSavingExamDate {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: "chevron.up.chevron.down")
                            .appFont(9, weight: .bold)
                            .foregroundStyle(ProfileTone.amber)
                            .accessibilityHidden(true)
                    }
                }
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(verbatim: day.value)
                        .appFont(28, weight: .heavy, monospacedDigits: true)
                        .tracking(-0.8)
                        .foregroundStyle(.primary)
                    if let unit = day.unit {
                        Text(verbatim: unit)
                            .appFont(14, weight: .bold)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                Text(verbatim: day.detail)
                    .appFont(12.5, weight: .medium)
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
        .accessibilityLabel("Test day: \([day.value, day.unit].compactMap { $0 }.joined(separator: " ")). \(day.detail)")
        .accessibilityHint("Choose your SAT date")
    }

    /// The three newest scored tests that are not midterms (those have their own panel). Shown
    /// without a link: the app has no page for a mock's or a practice test's result — those are
    /// read on the website, where the test was sat — and a row that opens nothing is better
    /// than one that opens a dead end.
    @ViewBuilder private var latestResults: some View {
        let load = model.attempts
        if load.isPending {
            ProfilePlaceholderRows(count: 2, height: 54)
        } else if load.isFailed {
            ClassroomErrorState(
                title: "Your results didn't load.",
                message: "Nothing is lost — try again in a moment."
            ) { await onRetry(.attempts) }
        } else {
            let rows = ProfileResults.recent(load.value ?? [])
            if rows.isEmpty {
                DashedEmpty(
                    title: "No scores yet",
                    hint: "Your scores show up here after your first practice test."
                )
            } else {
                VStack(spacing: 8) {
                    ForEach(rows) { attempt in
                        ProfileScoreRow(
                            math: ProfileResults.isMath(attempt),
                            title: ProfileResults.title(attempt),
                            detail: ProfileResults.detail(attempt),
                            score: ScoreText.string(attempt.score)
                        )
                        .profileRow()
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }
}

// MARK: - Finish your profile

/// What is still missing from the account, each step with the way to do it; once nothing is,
/// the "all set" panel. A failure when the account it needs did not load — never "all set".
struct ProfileChecklistPanel: View {
    enum Content {
        case loading
        case missing([ProfileChecklist.Item])
        case allSet([ProfileChecklist.Item])
        case failed
    }

    let content: Content
    let user: CurrentUser
    let model: ProfileModel
    let onSetGoal: () -> Void
    let onConfirmEmail: () -> Void
    let onPickExamDate: (String?) -> Void
    let onRetry: @MainActor (ProfileRetry) async -> Void

    /// The steps, once the fresh `/users/me/` is in — the phone and Telegram are only there.
    static func items(user: CurrentUser, identity: ProfileIdentity, account: AccountProfile, telegram: TelegramSignInConfig?) -> [ProfileChecklist.Item] {
        ProfileChecklist.items(
            ProfileChecklist.Input(
                realEmail: identity.email,
                emailVerified: identity.emailVerified,
                targetScore: user.targetScore,
                examDate: user.satExamDate,
                photoURL: identity.photoURL,
                telegramLinked: account.telegramLinked,
                phone: account.phoneNumber
            ),
            telegramAvailable: telegram?.canConnect == true
        )
    }

    var body: some View {
        switch content {
        case .loading:
            ProfilePanel(icon: "person.crop.circle.badge.checkmark", tone: ProfileTone.violet, title: "Finish your profile") {
                LoadingSkeleton(rows: 3, height: 52)
            }
        case .missing(let items):
            missingPanel(items)
        case .allSet(let items):
            allSetPanel(items)
        case .failed:
            ProfilePanel(icon: "person.crop.circle.badge.checkmark", tone: ProfileTone.violet, title: "Finish your profile") {
                ClassroomErrorState(
                    title: "Your profile isn't loading right now.",
                    message: "Nothing has changed on your account — try again in a moment."
                ) { await onRetry(.account) }
            }
        }
    }

    private func allSetPanel(_ items: [ProfileChecklist.Item]) -> some View {
        ProfilePanel(
            icon: "party.popper",
            tone: ProfileTone.emerald,
            title: "Your profile is all set",
            description: "Everything that makes it useful is filled in."
        ) {
            ProfileFlowLayout(spacing: 8) {
                ForEach(items) { item in
                    ProfileChip(text: item.doneLabel, icon: "checkmark", tone: ProfileTone.emerald)
                }
            }
        }
    }

    private func missingPanel(_ items: [ProfileChecklist.Item]) -> some View {
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
                ProfileFlowLayout(spacing: 12) {
                    ForEach(done) { item in
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark")
                                .appFont(11, weight: .heavy)
                                .foregroundStyle(ProfileTone.emerald)
                                .accessibilityHidden(true)
                            Text(verbatim: item.doneLabel)
                        }
                        .appFont(12.5, weight: .semibold)
                        .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        }
    }

    /// The step's way in sits beside its words, and under them at the accessibility sizes, where
    /// a pill beside the words would leave them a word to a line.
    private func checklistRow(_ item: ProfileChecklist.Item) -> some View {
        AdaptiveStack(spacing: 12, columnSpacing: 10) {
            HStack(spacing: 12) {
                Circle()
                    .strokeBorder(ProfileTone.violet.opacity(0.45), lineWidth: 2)
                    .frame(width: 20, height: 20)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: item.label)
                        .appFont(13.5, weight: .bold)
                    Text(verbatim: item.hint)
                        .appFont(12, weight: .medium)
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .combine)
            AdaptiveSpacer()
            checklistAction(item)
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .profileWell(ProfileTone.violet, radius: 11, opacity: 0.08)
    }

    /// Each step goes where it is done: the email flow opens right here, the goal sheet and
    /// the date menu too, the rest push their settings page — as values, which the sheet's root
    /// declares (`ProfileView.Route`).
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
                onRetry: { Task { await onRetry(.examDates) } }
            ) {
                Text(verbatim: item.action)
                    .appFont(13, weight: .bold)
                    .foregroundStyle(ProfileTone.violet)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(ProfileTone.violet.opacity(0.13)))
                    // Drawn like its sibling pills, reached like them: 44 pt.
                    .hitTarget(44)
            }
        case .photo, .phone:
            NavigationLink(value: ProfileView.Route.accountDetails) { Text(verbatim: item.action) }
                .buttonStyle(style)
        case .telegram:
            // Connecting is a browser flow the app cannot finish; Sign-in & password says how
            // to do it on the website.
            NavigationLink(value: ProfileView.Route.signIn) { Text(verbatim: item.action) }
                .buttonStyle(style)
        }
    }
}

// MARK: - Payments

/// The student's own money at the learning center, as lc-up keeps it — the web's
/// `PaymentsPanel`: what they owe or have in credit, the monthly price of their groups, and
/// their latest payments.
///
/// Plain on purpose (owner, 2026-10-14): a few lines and a list, no tinted box and no
/// coloured edge. An account lc-up has not been told about says so and shows nothing else;
/// a load that failed says THAT, because "no payments" and "we could not read your payments"
/// are different things to someone wondering whether they still owe for the month.
struct ProfilePaymentsPanel: View {
    let model: ProfileModel
    let onRetry: @MainActor (ProfileRetry) async -> Void

    @Environment(\.dynamicTypeSize) private var typeSize

    /// The web truncates a row to its line; at the accessibility sizes, where the figure has
    /// moved below the words anyway, the words are allowed to wrap instead of being cut.
    private var rowLines: Int { typeSize.isAccessibilitySize ? 3 : 1 }

    var body: some View {
        ProfilePanel(
            icon: "wallet.pass",
            tone: ProfileTone.violet,
            title: "Payments",
            description: "Your balance and payments at the learning center."
        ) {
            content
        }
    }

    @ViewBuilder private var content: some View {
        let load = model.finance
        if load.isPending {
            LoadingSkeleton(rows: 3, height: 18, label: "Loading your payments")
        } else if load.isFailed {
            ClassroomErrorState(
                title: "Your payments didn't load.",
                message: "Nothing has changed — try again in a moment."
            ) { await onRetry(.finance) }
        } else {
            switch load.value {
            case .linked(let finance):
                figures(finance)
            // Unlinked, and the belt-and-braces nil: neither is a failure, and neither
            // claims the student is paid up.
            case .unlinked, .none:
                Text("Your payments will show here once your learning center links your account.")
                    .appFont(13, weight: .medium)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// The figures and the list, spaced by hand: the due sentence belongs to the summary it
    /// explains, and the panel's own 16-pt gap would set it adrift between the two blocks.
    private func figures(_ finance: MyFinance) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                switch FinanceRules.balanceLine(finance) {
                case .owes(let amount):
                    line("You owe", amount, tone: ProfileTone.rose)
                case .inCredit(let amount):
                    line("In credit", amount)
                case .allPaid:
                    line("Balance", "All paid")
                case .none:
                    EmptyView()
                }
                if finance.monthlyCost > 0 {
                    line("Monthly price", UZS.format(finance.monthlyCost))
                    ForEach(FinanceRules.groupBreakdown(finance)) { group in
                        line(group.name, UZS.format(group.monthlyCost), size: 12.5)
                            .padding(.leading, 12)
                    }
                }
                if let due = FinanceRules.dueSentence(finance) {
                    Text(verbatim: due)
                        .appFont(12.5, weight: .medium)
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 2)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                ProfileEyebrow("Recent payments")
                payments(FinanceRules.recentPayments(finance))
            }
        }
    }

    @ViewBuilder private func payments(_ rows: [FinancePayment]) -> some View {
        if rows.isEmpty {
            Text("No payments recorded yet.")
                .appFont(13, weight: .medium)
                .foregroundStyle(Theme.textSecondary)
        } else {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, payment in
                    if index > 0 { Divider() }
                    paymentRow(payment)
                }
            }
        }
    }

    /// The day, then how it was paid and the month it buys, with the figure on the right —
    /// stacked at the accessibility sizes, where the two would be a word to a line.
    private func paymentRow(_ payment: FinancePayment) -> some View {
        let note = FinanceRules.note(payment)
        return AdaptiveStack(rowAlignment: .firstTextBaseline, spacing: 10, columnSpacing: 2) {
            HStack(spacing: 0) {
                Text(verbatim: FinanceRules.payDay(payment.date))
                    .appFont(13, weight: .medium)
                if !note.isEmpty {
                    Text(verbatim: " · \(note)")
                        .appFont(13, weight: .medium)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .lineLimit(rowLines)
            .truncationMode(.tail)
            AdaptiveSpacer()
            Text(verbatim: FinanceRules.amountText(payment))
                .appFont(13, weight: .semibold, monospacedDigits: true)
                .lineLimit(1)
                // At the accessibility sizes the row stacks and the amount takes its own line,
                // where "1,250,000 UZS" is still wider than the panel. A shrunk amount can be
                // read; a truncated one ("1,250,0…") cannot.
                .minimumScaleFactor(0.7)
        }
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// One summary line: what it is on the left, the figure on the right — the web's
    /// `PaymentsLine`.
    private func line(_ label: String, _ value: String, tone: Color? = nil, size: CGFloat = 13) -> some View {
        AdaptiveStack(rowAlignment: .firstTextBaseline, spacing: 10, columnSpacing: 2) {
            Text(verbatim: label)
                .appFont(size, weight: .medium)
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(rowLines)
                .truncationMode(.tail)
            AdaptiveSpacer()
            Text(verbatim: value)
                .appFont(size, weight: .semibold, monospacedDigits: true)
                .foregroundStyle(tone ?? .primary)
                .lineLimit(1)
                // Same reason as the payment row's amount: shrink the figure rather than cut it.
                .minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .combine)
    }
}
