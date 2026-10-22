import SwiftUI
import MasterSATKit

// The Me sheet's own panels — the web's `OverviewTab.tsx` pieces the one page keeps: Your goal
// (with Latest results), Finish your profile, and Payments, coming soon. Each reads its own load
// from `ProfileModel` and fails on its own.

/// Which panel's "Try again" was pressed.
enum ProfileRetry {
    case account, attempts, examDates, midterms
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
                    .appFont(28, weight: .heavy)
                    .monospacedDigit()
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
                        .appFont(28, weight: .heavy)
                        .monospacedDigit()
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
                Text("Your scores show up here after your first practice test.")
                    .appFont(13, weight: .medium)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .profileWell(ProfileTone.primary, radius: 11)
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

/// What is still missing from the account, each step with the way to do it — shown only while
/// a step is missing (`items`), and as a failure when the account it needs did not load.
struct ProfileChecklistPanel: View {
    enum Content {
        case missing([ProfileChecklist.Item])
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
        case .missing(let items):
            missingPanel(items)
        case .failed:
            ProfilePanel(icon: "person.crop.circle.badge.checkmark", tone: ProfileTone.violet, title: "Finish your profile") {
                ClassroomErrorState(
                    title: "Your profile isn't loading right now.",
                    message: "Nothing has changed on your account — try again in a moment."
                ) { await onRetry(.account) }
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

    private func checklistRow(_ item: ProfileChecklist.Item) -> some View {
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
            Spacer(minLength: 8)
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
                    .contentShape(Capsule())
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

/// Payments, before there is anything to pay here — the owner asked for the block with
/// "Coming soon" inside it, so the place exists before the feature does. It shows what is
/// coming and no figures at all: a made-up amount on a student's own profile would read as a
/// real bill.
struct ProfilePaymentsPanel: View {
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
                .appFont(12, weight: .heavy)
                .foregroundStyle(ProfileTone.violet)
                .padding(.horizontal, 11)
                .padding(.vertical, 5)
                .background(Capsule().fill(ProfileTone.violet.opacity(0.13)))
        } content: {
            VStack(spacing: 8) {
                ForEach(Self.previews) { row in
                    HStack(spacing: 12) {
                        Image(systemName: row.icon)
                            .appFont(14, weight: .semibold)
                            .foregroundStyle(ProfileTone.violet)
                            .frame(width: 18)
                            .accessibilityHidden(true)
                        Text(verbatim: row.label)
                            .appFont(13, weight: .semibold)
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
                .appFont(12.5, weight: .medium)
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
