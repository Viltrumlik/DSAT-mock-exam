import SwiftUI
import MasterSATKit

/// The profile's Overview — the web's `OverviewTab.tsx`, in the order it stacks on a phone:
/// the four figures, Your goal (with Latest results), Homework to do, Midterms & certificates,
/// Finish your profile (or the "all set" panel), and Payments.
///
/// Each panel reads its own load from `ProfileModel` and fails on its own; the numbers open
/// the pages they come from, as values the sheet's root declares.
struct ProfileOverviewTab: View {
    let user: CurrentUser
    let identity: ProfileIdentity
    let model: ProfileModel
    let onSetGoal: () -> Void
    let onConfirmEmail: () -> Void
    let onPickExamDate: (String?) -> Void
    let onCertificate: (MeCertificate) -> Void
    let onRetry: @MainActor (ProfileRetry) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ProfileFigures(model: model, onRetry: onRetry)
            ProfileGoalPanel(
                user: user,
                model: model,
                onSetGoal: onSetGoal,
                onPickExamDate: onPickExamDate,
                onRetry: onRetry
            )
            ProfileHomeworkPanel(model: model, onRetry: onRetry)
            MeMidtermsPanel(
                model: model,
                onRetry: { await onRetry(.midterms) },
                onCertificate: onCertificate
            )
            ProfileChecklistPanel(
                content: checklist,
                user: user,
                model: model,
                onSetGoal: onSetGoal,
                onConfirmEmail: onConfirmEmail,
                onPickExamDate: onPickExamDate,
                onRetry: onRetry
            )
            ProfilePaymentsPanel(model: model, onRetry: onRetry)
        }
    }

    /// Needs the fresh `/users/me/` — the phone and Telegram are only there — so it waits for
    /// it, and says so when it did not come. Something always stands here (the steps, or the
    /// "all set" panel), so its placeholder holds the place rather than jumping the page.
    private var checklist: ProfileChecklistPanel.Content {
        guard let account = model.account.value else {
            return model.account.isFailed ? .failed : .loading
        }
        let items = ProfileChecklistPanel.items(
            user: user, identity: identity, account: account, telegram: model.telegramSignIn
        )
        return items.contains { !$0.done } ? .missing(items) : .allSet(items)
    }
}

// MARK: - The four figures

/// XP, Strikes, Points and Homework — each opens the page it comes from; the "!" beside the
/// first three opens what the number is. Two to a row; one to a row at the accessibility sizes,
/// where half the page is too narrow for a figure and its line.
private struct ProfileFigures: View {
    let model: ProfileModel
    let onRetry: @MainActor (ProfileRetry) async -> Void

    private static let failedLine = "Couldn't load this just now."

    private var summary: ProfileHomework.Summary? {
        model.homework.value.map { ProfileHomework.summarise($0) }
    }

    var body: some View {
        let mine = model.rewards.value
        let counting = model.rewards.isPending
        VStack(spacing: 10) {
            AdaptiveStack(rowAlignment: .top, spacing: 10) {
                ProfileStatTile(
                    tone: ProfileTone.primary,
                    icon: "trophy.fill",
                    label: "XP",
                    value: mine.map { ScoreText.string($0.xp) } ?? (counting ? "…" : "—"),
                    detail: mine != nil ? "Earned by turning up and doing the work." : (counting ? "Counting…" : Self.failedLine),
                    cta: "Leaderboard",
                    link: .leaderboard,
                    explainer: .xp
                )
                ProfileStatTile(
                    tone: ProfileTone.amber,
                    icon: "flame.fill",
                    label: "Strikes",
                    value: mine.map { ScoreText.string($0.strikes) } ?? (counting ? "…" : "—"),
                    detail: mine.map { ProfileWording.strikesDetail(currentStreak: $0.currentStreak, bestStreak: $0.bestStreak) }
                        ?? (counting ? "Counting…" : Self.failedLine),
                    cta: "Shop",
                    link: .shop,
                    explainer: .strike
                )
            }
            .fixedSize(horizontal: false, vertical: true)

            AdaptiveStack(rowAlignment: .top, spacing: 10) {
                ProfileStatTile(
                    tone: ProfileTone.emerald,
                    icon: "sparkles",
                    label: "Points",
                    value: mine.map { ScoreText.string($0.points) } ?? (counting ? "…" : "—"),
                    detail: mine.map { ProfileWording.coinsDetail($0.coins) } ?? (counting ? "Counting…" : Self.failedLine),
                    cta: "Points & coins",
                    link: .points,
                    explainer: .points
                )
                ProfileStatTile(
                    tone: ProfileTone.sky,
                    icon: "checklist",
                    label: "Homework",
                    value: summary.map(ProfileWording.homeworkValue) ?? (model.homework.isPending ? "…" : "—"),
                    detail: summary.map(ProfileWording.homeworkDetail)
                        ?? (model.homework.isPending ? "Counting…" : Self.failedLine),
                    cta: "All homework",
                    link: .assessments
                )
            }
            .fixedSize(horizontal: false, vertical: true)

            // The homework figure's failure is answered by the Homework panel's own "Try
            // again"; the rewards have no panel of their own, so they get this one.
            if model.rewards.isFailed {
                ClassroomErrorState(
                    title: "Your XP, strikes and points didn't load.",
                    message: ErrorState.nothingLost
                ) { await onRetry(.rewards) }
                .cardStyle(padding: 8)
            }
        }
    }
}

/// One of the student's own figures. The whole tile opens the page the figure comes from; the
/// "!" sits above it and opens its explainer instead.
private struct ProfileStatTile: View {
    let tone: Color
    let icon: String
    let label: String
    let value: String
    let detail: String
    let cta: String
    let link: AppLink
    var explainer: RewardsExplainer?

    var body: some View {
        NavigationLink(value: link) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    IconTile(systemName: icon, tone: tone, size: 32)
                    ProfileEyebrow(label)
                    // Room for the "!" laid over this corner.
                    Spacer(minLength: explainer == nil ? 0 : 26)
                }
                Text(verbatim: value)
                    .appFont(26, weight: .heavy, monospacedDigits: true)
                    .tracking(-0.6)
                    .foregroundStyle(tone)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .padding(.top, 12)
                Text(verbatim: detail)
                    .appFont(12, weight: .medium)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 5)
                Spacer(minLength: 10)
                HStack(spacing: 4) {
                    Text(verbatim: cta)
                    Image(systemName: "arrow.right").appFont(10, weight: .bold)
                        .accessibilityHidden(true)
                }
                .appFont(12.5, weight: .bold)
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

// MARK: - Homework to do

/// The next pieces to start, the most urgent first — at most four, then how many more. "Done"
/// is Today's (`ProfileHomework.summarise` on `HomeworkProgress.isDone`), so a homework finished
/// there is gone from here too.
private struct ProfileHomeworkPanel: View {
    let model: ProfileModel
    let onRetry: @MainActor (ProfileRetry) async -> Void

    private var summary: ProfileHomework.Summary? {
        model.homework.value.map { ProfileHomework.summarise($0) }
    }

    var body: some View {
        ProfilePanel(
            icon: "checklist",
            tone: ProfileTone.amber,
            title: "Homework to do",
            description: "The next pieces to start, the most urgent first."
        ) {
            NavigationLink(value: AppLink.assessments) {
                HStack(spacing: 4) {
                    Text("All homework")
                    Image(systemName: "arrow.right").appFont(11, weight: .bold)
                        .accessibilityHidden(true)
                }
            }
            .buttonStyle(AccountPillButtonStyle(kind: .quiet, tone: ProfileTone.primary))
        } content: {
            content
        }
    }

    @ViewBuilder private var content: some View {
        let load = model.homework
        if load.isPending {
            LoadingSkeleton(rows: 3, height: 58)
        } else if load.isFailed {
            ClassroomErrorState(
                title: "Your homework didn't load.",
                message: "Nothing has changed on it — try again in a moment."
            ) { await onRetry(.homework) }
        } else if let summary {
            let shown = Array(summary.toDo.prefix(4))
            if summary.total == 0 {
                // Nothing set is not an achievement: the empty slot, not the caught-up well.
                DashedEmpty(title: "No homework yet", hint: ProfileWording.homeworkEmpty(summary))
            } else if shown.isEmpty {
                HStack(spacing: 12) {
                    IconTile(systemName: "checkmark", tone: ProfileTone.emerald, size: 34)
                    Text(verbatim: ProfileWording.homeworkEmpty(summary))
                        .appFont(13.5, weight: .bold)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(14)
                .profileWell(ProfileTone.emerald, opacity: 0.09)
            } else {
                VStack(spacing: 8) {
                    ForEach(shown) { row in
                        ProfileHomeworkRow(row: row)
                    }
                }
            }
            let more = summary.toDo.count - shown.count
            if more > 0 {
                NavigationLink(value: AppLink.assessments) {
                    Text(verbatim: "\(more) more to do")
                        .appFont(12.5, weight: .bold)
                        .foregroundStyle(Theme.accent)
                        .hitTarget(44)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// One homework still to do: its name, when it is due — "Catch up · Tue" once the date has
/// passed, never "Overdue" — and where it is from. A class's homework opens its page; one with
/// no class opens the homework list, where it lives.
private struct ProfileHomeworkRow: View {
    let row: AssignmentListing

    var body: some View {
        if row.classroomId != nil {
            NavigationLink(value: row) { label }.buttonStyle(.plain)
        } else {
            NavigationLink(value: AppLink.assessments) { label }.buttonStyle(.plain)
        }
    }

    private var label: some View {
        let detail = ProfileHomework.rowDetail(row)
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 5) {
                Text(verbatim: row.title.isEmpty ? "Homework" : row.title)
                    .appFont(13.5, weight: .bold)
                    .foregroundStyle(.primary)
                    .titleLineLimit(2)
                    .multilineTextAlignment(.leading)
                // The class drops under the date at the accessibility sizes.
                AdaptiveStack(spacing: 6, columnSpacing: 4) {
                    ProfileDueChip(dueAt: row.dueAt)
                    if !detail.isEmpty {
                        Text(verbatim: detail)
                            .appFont(12, weight: .medium)
                            .foregroundStyle(Theme.textSecondary)
                            .titleLineLimit(1)
                    }
                }
            }
            Spacer(minLength: 6)
            Image(systemName: "chevron.right")
                .appFont(12, weight: .bold)
                .foregroundStyle(Theme.textLabel)
                .accessibilityHidden(true)
        }
        .profileRow()
        .accessibilityElement(children: .combine)
    }
}

/// When a piece of homework is due, in the colour of where it stands: amber to catch up on,
/// the student's blue for a date ahead, violet when there is no date at all.
private struct ProfileDueChip: View {
    let dueAt: String?

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let due = DueLabel.text(dueAt)
        let tone = due.map { $0.late ? ProfileTone.amber : ProfileTone.primary } ?? ProfileTone.violet
        Text(verbatim: due?.text ?? "No due date")
            .appFont(11, weight: .heavy)
            .foregroundStyle(tone)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(tone.opacity(0.13)))
            // Whole while it fits; never wider than the row at the accessibility sizes.
            .fixedSize(horizontal: !typeSize.isAccessibilitySize, vertical: true)
    }
}
