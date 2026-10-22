import SwiftUI
import Lottie

/// The bundled motion graphics, by file name (Resources/Lottie/<rawValue>.json).
enum LottieAsset: String, CaseIterable {
    case strikeFlame = "strike-flame"
    case taskComplete = "task-complete"
    case trophy
}

/// A Lottie, played the way the student's settings allow.
///
/// With Reduce Motion on, a looping clip shows its last frame, still; a one-shot shows
/// nothing at all — the static screen around it already says what happened.
struct LottieClip: View {
    let asset: LottieAsset
    var loops: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(_ asset: LottieAsset, loops: Bool = true) {
        self.asset = asset
        self.loops = loops
    }

    var body: some View {
        Group {
            if reduceMotion {
                if loops {
                    LottieView(animation: .named(asset.rawValue))
                        .playbackMode(.paused(at: .progress(1)))
                        .resizable()
                }
            } else if loops {
                LottieView(animation: .named(asset.rawValue))
                    .looping()
                    .resizable()
            } else {
                LottieView(animation: .named(asset.rawValue))
                    .playing(loopMode: .playOnce)
                    .resizable()
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
