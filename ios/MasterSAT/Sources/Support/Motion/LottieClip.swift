import SwiftUI
import Lottie

/// The bundled motion graphics, by file name (Resources/Lottie/<rawValue>.json).
enum LottieAsset: String, CaseIterable {
    case strikeFlame = "strike-flame"
    case taskComplete = "task-complete"
    case trophy
    /// One-shot burst for a purchase or a conversion that went through; its last frame is blank,
    /// so `.still` shows its rest frame (the coin, whole). Never loops by default.
    case coinBurst = "coin-burst"
    /// One-shot burst behind the trophy when the student moved up a place; its last frame is
    /// blank, so `.still` shows its rest frame (glow, rays and the ring of stars). Never loops by
    /// default.
    case starBurst = "star-burst"

    /// Where a still picture of this asset rests, 0...1 through the file: `.still`, and the
    /// paused picture under Reduce Motion. The first three end on their finished picture; the two
    /// bursts end faded out, so they rest on the frame where the whole picture is opaque and at
    /// full size. coin-burst: frame 54.6 of 84 (the flip ended at 50, the fade starts at 60,
    /// the small coins and sparks are gone). star-burst: frame 56 of 100 (the stars have flown
    /// out and are still full size, rays and glow at full opacity). If a burst's keyframes change
    /// in ios/tools/lottie/make-lottie.mjs, pick its frame again.
    var restProgress: Double {
        switch self {
        case .strikeFlame, .taskComplete, .trophy: 1
        case .coinBurst: 0.65
        case .starBurst: 0.56
        }
    }

    /// Whether `LottieClip(_:)` repeats it when the caller does not say. The first three keep the
    /// blanket default they always had; a burst that repeated would re-burst forever.
    var loopsByDefault: Bool {
        switch self {
        case .strikeFlame, .taskComplete, .trophy: true
        case .coinBurst, .starBurst: false
        }
    }
}

/// A Lottie, played the way the student's settings allow.
///
/// `loop` plays forever (Reduce Motion: the asset's rest frame, still); `once` plays through once
/// (Reduce Motion: nothing — but it keeps the frame its caller gave it, so nothing around it
/// moves); `still` always shows the asset's rest frame (`LottieAsset.restProgress`: the last
/// frame, except for the bursts, which end faded out).
struct LottieClip: View {
    enum Playback { case loop, once, still }

    let asset: LottieAsset
    let playback: Playback

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// `loops` nil: the asset's own default (`LottieAsset.loopsByDefault`).
    init(_ asset: LottieAsset, loops: Bool? = nil) {
        self.init(asset, playback: (loops ?? asset.loopsByDefault) ? .loop : .once)
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
                    .playbackMode(.paused(at: .progress(asset.restProgress)))
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
