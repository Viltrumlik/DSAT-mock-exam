import SwiftUI
import MasterSATKit

private struct HeroBounce { var scale = 1.0 }

/// This week's homework as a ring: done against all of it. It draws itself in on arrival,
/// moves when work is handed in, and bounces when the week is done.
struct TodayHero: View {
    let progress: TodayPlan.Progress
    let loaded: Bool
    /// Bumped by Today when the week has just been finished.
    let bounce: Int
    /// The homework did not load and nothing is cached: the ring knows nothing about the week,
    /// so it claims nothing — least of all "nothing due".
    var failed = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawn = 0.0

    private var tone: Color { progress.isComplete ? NewLook.green : NewLook.blue }

    /// Neither loaded nor failed: the week is on its way.
    private var pending: Bool { !loaded && !failed }

    private var headline: String {
        if failed { return "This week" }
        if !loaded { return "This week" }
        if progress.total == 0 { return "Nothing due this week" }
        if progress.isComplete { return "All done this week" }
        return "\(progress.total - progress.done) to go this week"
    }

    private var subline: String {
        if failed { return "Your homework didn't load. Try again below." }
        if !loaded || progress.total == 0 { return "Homework due by Sunday shows up here." }
        return "\(progress.done) of \(progress.total) handed in"
    }

    var body: some View {
        // The ring beside the week's words; above them at the accessibility sizes.
        AdaptiveStack(spacing: 18) {
            ZStack {
                Circle().stroke(NewLook.blue50, lineWidth: 11)
                Circle()
                    .trim(from: 0, to: drawn)
                    .stroke(tone, style: StrokeStyle(lineWidth: 11, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                if progress.isComplete {
                    Image(systemName: "checkmark")
                        .appFont(26, weight: .heavy)
                        .capDynamicType()
                        .foregroundStyle(tone)
                } else {
                    Text(loaded && !failed && progress.total > 0 ? "\(progress.done)/\(progress.total)" : "—")
                        .appDisplayFont(20, monospacedDigits: true)
                        // The dash of a week not known yet is quiet (the kit's `--faint`).
                        .foregroundStyle(loaded && !failed ? NewLook.ink : NewLook.muted)
                        .capDynamicType()
                        .contentTransition(.numericText())
                        // A fixed ring: "12/12" at a large text size shrinks to fit inside the
                        // stroke rather than run over it.
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .padding(.horizontal, 11)
                }
            }
            .frame(width: 88, height: 88)
            .keyframeAnimator(initialValue: HeroBounce(), trigger: bounce) { content, value in
                content.scaleEffect(value.scale)
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    SpringKeyframe(1.16, duration: 0.18, spring: .snappy)
                    SpringKeyframe(1.0, duration: 0.55, spring: .bouncy(duration: 0.55, extraBounce: 0.3))
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("This week")
                    .newLookCaps()
                Text(headline)
                    .appDisplayFont(20)
                    .tracking(-0.3)
                    .foregroundStyle(NewLook.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subline)
                    .appFont(14, weight: .medium)
                    .foregroundStyle(NewLook.ink4)
            }
            // On its way (mockup 90): two lines' worth of shape where the words will land. The
            // words stay in place underneath, hidden, so the card is already its full height.
            .opacity(pending ? 0 : 1)
            .overlay(alignment: .leading) {
                SkeletonClock(running: pending) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("This week").newLookCaps()
                        SkeletonLine(fraction: 0.8, height: 18)
                        SkeletonLine(fraction: 0.58, height: 12)
                    }
                }
                .opacity(pending ? 1 : 0)
            }
            AdaptiveSpacer()
        }
        .newLookCard(padding: 18)
        .onAppear { draw(progress.fraction) }
        .onChange(of: progress) { _, now in draw(now.fraction) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    /// While the week is still on its way the ring knows nothing, so it says only that — not
    /// "This week: This week", the placeholder headline read twice.
    private var spoken: String {
        if failed { return "This week: your homework didn't load." }
        if !loaded { return "This week's homework, loading" }
        return "This week: \(headline). \(subline)"
    }

    private func draw(_ fraction: Double) {
        guard drawn != fraction else { return }
        withAnimation(reduceMotion ? Motion.focus : Motion.bouncy) { drawn = fraction }
    }
}

/// Nothing owed and nothing left today. The page's one piece of art: it settles on a tick, once,
/// so a finished day looks finished rather than busy.
struct AllDoneCard: View {
    var body: some View {
        VStack(spacing: 10) {
            StateArt(.allDone)
            Text("You're all caught up")
                .appDisplayFont(17)
                .foregroundStyle(NewLook.ink)
            Text("New work from your teachers shows up here.")
                .appFont(13, weight: .medium)
                .foregroundStyle(NewLook.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .newLookCard(padding: 20, radius: 22)
    }
}

/// Today's lessons did not load. Said quietly, beside the work that did: a missing list must not
/// read as "no lessons tonight".
struct LessonsUnavailableRow: View {
    let retry: @MainActor () async -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.circle")
                .appFont(13, weight: .semibold)
                .foregroundStyle(Theme.warning)
                .accessibilityHidden(true)
            Text("Today's lessons didn't load.")
                .appFont(12, weight: .semibold)
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
            Button {
                Task { await retry() }
            } label: {
                Text("Try again")
                    .appFont(12, weight: .bold)
                    .foregroundStyle(Theme.accent)
                    // Drawn 12 pt, tappable 44; the quiet row stays quiet.
                    .hitTarget()
            }
            .buttonStyle(PressBounce())
        }
        .padding(.horizontal, 4)
    }
}

/// A midterm score released since the student last looked — until it is opened or put off.
struct FreshResultCard: View {
    let midterm: MidtermListing
    let onOpen: @MainActor () -> Void
    let onLater: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                NewLookTile(systemName: "rosette", tone: .green)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Your result is in")
                        .appDisplayFont(17)
                        .tracking(-0.3)
                        .foregroundStyle(NewLook.ink)
                    Text(midterm.title)
                        .appFont(13, weight: .medium)
                        .foregroundStyle(NewLook.ink4)
                }
                Spacer(minLength: 0)
            }
            if let score = midterm.score {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(ScoreText.string(score))
                        .appDisplayFont(40, monospacedDigits: true)
                        .tracking(-1)
                        .foregroundStyle(NewLook.blueText)
                    if let ceiling = midterm.scoreCeiling {
                        Text("of \(ScoreText.string(ceiling))")
                            .appFont(14, weight: .semibold)
                            .foregroundStyle(NewLook.ink4)
                    }
                }
            }
            AdaptiveStack(spacing: 10) {
                Button("See your report", action: onOpen)
                    .buttonStyle(NewLookButtonStyle(kind: .primary, size: .block))
                Button("Later", action: onLater)
                    .buttonStyle(NewLookButtonStyle(kind: .tint))
            }
        }
        .newLookCard(padding: 18, radius: 22)
    }
}

/// The SAT date, compact. Setting it lives in the Me sheet, which this opens.
struct SATCountdownRow: View {
    let examDate: String?
    let onOpen: @MainActor () -> Void

    private var day: ProfileGoal.TestDay { ProfileGoal.testDay(examDate) }

    private var title: String {
        if let unit = day.unit { return "SAT · \(day.value) \(unit)" }
        if day.value == "Today" { return "SAT · it's exam day" }
        return "Your SAT date"
    }

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 12) {
                NewLookTile(systemName: "calendar", tone: .blue)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .appDisplayFont(17)
                        .tracking(-0.3)
                        .foregroundStyle(NewLook.ink)
                    Text(day.detail)
                        .appFont(13, weight: .medium)
                        .foregroundStyle(NewLook.ink4)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(NewLook.chevron)
                    .accessibilityHidden(true)
            }
            .newLookCard(padding: 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressBounce())
        .accessibilityHint("Opens your profile, where the SAT date is set")
    }
}
