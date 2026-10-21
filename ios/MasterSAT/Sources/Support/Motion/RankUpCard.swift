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
                        router.show(.rewards)
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
/// and no burst: the trophy is an SF Symbol there, not the Lottie, because a one-shot clip
/// either plays or is blank when nothing may move (`LottieClip.Playback`), and the star burst
/// ends faded out.
struct RankUpCard: View {
    let rise: Rise
    let reduceMotion: Bool
    let onBoard: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                if reduceMotion {
                    Image(systemName: "trophy.fill")
                        .font(.system(size: 84, weight: .bold))
                        .foregroundStyle(Theme.amber)
                        .frame(width: 130, height: 130)
                } else {
                    LottieClip(.starBurst, playback: .once).frame(width: 230, height: 230)
                    LottieClip(.trophy, playback: .once).frame(width: 130, height: 130)
                }
            }
            .frame(height: 150)
            .accessibilityHidden(true)

            VStack(spacing: 4) {
                // A place is an identifier, not a quantity: never "#1,204".
                Text(verbatim: "You moved up to #\(rise.to)")
                    .font(.system(size: 24, weight: .heavy, design: .rounded))
                Text(verbatim: "Overall · all time · up from #\(rise.from)")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
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
    }
}
