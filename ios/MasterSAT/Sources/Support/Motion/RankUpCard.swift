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
                // The kit's `.dim`: navy at 36 %.
                Color(.sRGB, red: 10 / 255, green: 22 / 255, blue: 50 / 255, opacity: 0.36)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { celebrations.dismissRankUp() }
                    .accessibilityHidden(true)
                    .transition(.opacity)
                RankUpCard(
                    rise: rise,
                    reduceMotion: celebrations.reduceMotion,
                    speechRemaining: { celebrations.speechRemaining() },
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
    /// How much longer VoiceOver is expected to be speaking an earlier line (the XP line of the
    /// same return, which no flight delays under Reduce Motion).
    let speechRemaining: @MainActor () -> Duration
    let onBoard: () -> Void
    let onClose: () -> Void

    /// VoiceOver's cursor, on the line that says the news.
    @AccessibilityFocusState private var newsFocused: Bool

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                // Always there: a one-shot burst is blank under Reduce Motion (`LottieClip`), so the
                // setting picks its playback and the tree stays the same.
                LottieClip(.starBurst, playback: .once).frame(width: 230, height: 230)
                LottieClip(.trophy, playback: reduceMotion ? .still : .once).frame(width: 130, height: 130)
            }
            .frame(height: 150)
            .accessibilityHidden(true)

            VStack(spacing: 4) {
                // A place is an identifier, not a quantity: never "#1,204". Its own words are the
                // announcement — the cursor lands here and reads them (see the task below).
                Text(verbatim: "You moved up to #\(rise.to)")
                    .appDisplayFont(24)
                    .tracking(-0.5)
                    .foregroundStyle(NewLook.ink)
                    .accessibilityFocused($newsFocused)
                Text(verbatim: "Overall · all time · up from #\(rise.from)")
                    .appFont(15, weight: .medium)
                    .foregroundStyle(NewLook.muted)
                    // The dots are pauses, not words.
                    .accessibilityLabel("Overall, all time, up from #\(rise.from)")
            }
            .multilineTextAlignment(.center)

            HStack(spacing: 10) {
                Button("Nice!", action: onClose)
                    .buttonStyle(NewLookButtonStyle(kind: .tint, size: .large))
                Button("See the board", action: onBoard)
                    .buttonStyle(NewLookButtonStyle(kind: .primary, size: .large))
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        // The new look's floating card (mockup 16): white, r26, `--sh-pop` — the chunky amber
        // edge is gone.
        .newLookSurface(NewLook.card, radius: 26, shadow: .pop)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        // VoiceOver's two-finger scrub puts it away, as it does a sheet.
        .accessibilityAction(.escape, onClose)
        // The card does not wait to be found: the cursor comes to it, and its title is the whole
        // announcement. Lowered first so a second rise, which swaps `rise` under this same view,
        // moves it again. After a beat, because a cursor set in the frame the card is inserted in
        // finds nothing there yet — and longer while an earlier line is still being spoken (the
        // XP of this return), since a cursor move cuts speech off rather than queueing behind it.
        .task(id: rise) {
            newsFocused = false
            let wait = max(.milliseconds(150), min(speechRemaining(), .seconds(8)))
            try? await Task.sleep(for: wait)
            if !Task.isCancelled { newsFocused = true }
        }
    }
}
