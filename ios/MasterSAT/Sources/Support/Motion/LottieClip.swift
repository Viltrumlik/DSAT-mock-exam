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
/// `loop` plays forever (Reduce Motion: its last frame, still); `once` plays through once
/// (Reduce Motion: nothing — but it keeps the frame its caller gave it, so nothing around it
/// moves); `still` always shows the last frame.
struct LottieClip: View {
    enum Playback { case loop, once, still }

    let asset: LottieAsset
    let playback: Playback

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(_ asset: LottieAsset, loops: Bool = true) {
        self.init(asset, playback: loops ? .loop : .once)
    }

    init(_ asset: LottieAsset, playback: Playback) {
        self.asset = asset
        self.playback = playback
    }

    var body: some View {
        Group {
            switch (playback, reduceMotion) {
            case (.still, _), (.loop, true):
                LottieView(animation: .named(asset.rawValue))
                    .playbackMode(.paused(at: .progress(1)))
                    .resizable()
            case (.loop, false):
                LottieView(animation: .named(asset.rawValue))
                    .looping()
                    .resizable()
            case (.once, false):
                LottieView(animation: .named(asset.rawValue))
                    .playing(loopMode: .playOnce)
                    .resizable()
            case (.once, true):
                Color.clear
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
