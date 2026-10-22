import SwiftUI
import MasterSATKit

/// The trophy card: the student moved up the board while they were away.
///
/// Drawn by the root above the tabs and the tab bar — not a `.sheet`: a third sheet would fight
/// the router's one-sheet rule and the Me sheet's queue. It appears only once the stage is clear
/// and any XP flight has landed (`CelebrationCenter.rankUp`). A tap outside it, "Nice!" or "See
/// the board" puts it away. Takes touches only while it is up.
struct RankUpOverlay: View {
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(AppRouter.self) private var router

    var body: some View {
        ZStack(alignment: .bottom) {
            if let rise = celebrations.rankUp {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { celebrations.dismissRankUp() }
                    .accessibilityHidden(true)
                    .transition(.opacity)
                RankUpCard(
                    rise: rise,
                    reduceMotion: celebrations.reduceMotion,
                    onBoard: {
                        celebrations.dismissRankUp()
                        // Fresh: a Rewards root already open would not reload, and the hero must
                        // show the place this card named.
                        router.showFresh(.rewards)
                    },
                    onClose: { celebrations.dismissRankUp() }
                )
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
                .transition(celebrations.reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .animation(celebrations.reduceMotion ? Motion.focus : Motion.bouncy, value: celebrations.rankUp)
        .sensoryFeedback(trigger: celebrations.rankUp) { _, new in new == nil ? nil : .success }
        .allowsHitTesting(celebrations.rankUp != nil)
    }
}

/// The card itself — look B, the trophy over a star burst. Under Reduce Motion a still trophy
/// (its rest frame, the full cup) and no burst.
struct RankUpCard: View {
    let rise: Rise
    let reduceMotion: Bool
    let onBoard: () -> Void
    let onClose: () -> Void

    /// VoiceOver's cursor, on the line that says the news.
    @AccessibilityFocusState private var newsFocused: Bool

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                if !reduceMotion {
                    LottieClip(.starBurst, playback: .once).frame(width: 230, height: 230)
                }
                LottieClip(.trophy, playback: reduceMotion ? .still : .once).frame(width: 130, height: 130)
            }
            .frame(height: 150)
            .accessibilityHidden(true)

            VStack(spacing: 4) {
                // A place is an identifier, not a quantity: never "#1,204". Its own words are the
                // announcement — the cursor lands here and reads them (see the task below).
                Text(verbatim: "You moved up to #\(rise.to)")
                    .font(.system(size: 24, weight: .heavy, design: .rounded))
                    .accessibilityFocused($newsFocused)
                Text(verbatim: "Overall · all time · up from #\(rise.from)")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    // The dots are pauses, not words.
                    .accessibilityLabel("Overall, all time, up from #\(rise.from)")
            }
            .multilineTextAlignment(.center)

            HStack(spacing: 10) {
                Button("Nice!", action: onClose)
                    .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                Button("See the board", action: onBoard)
                    .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .chunky(Theme.amber)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        // VoiceOver's two-finger scrub puts it away, as it does a sheet.
        .accessibilityAction(.escape, onClose)
        // The card does not wait to be found: the cursor comes to it. Lowered first so a second
        // rise, which swaps `rise` under this same view, moves it again; and after a beat, because
        // a cursor set in the frame the card is inserted in finds nothing there yet.
        .task(id: rise) {
            newsFocused = false
            try? await Task.sleep(for: .milliseconds(150))
            if !Task.isCancelled { newsFocused = true }
        }
    }
}
