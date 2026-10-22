import SwiftUI
import Lottie
import MasterSATKit

/// The bundled motion graphics, by file name (Resources/Lottie/<rawValue>.json).
///
/// Every file carries a `rest` marker, written by ios/tools/lottie/make-lottie.mjs: the frame a
/// still picture of it shows. A clip that ends on its finished picture rests on its last frame;
/// the two bursts end faded out, so they rest where the whole picture is still on screen, and the
/// generator moves that marker whenever their keyframes move.
enum LottieAsset: String, CaseIterable {
    case strikeFlame = "strike-flame"
    case taskComplete = "task-complete"
    case trophy
    /// One-shot burst for a purchase or a conversion that went through. It ends blank, so its
    /// still picture is the coin, whole.
    case coinBurst = "coin-burst"
    /// One-shot burst behind the trophy when the student moved up a place. It ends blank, so its
    /// still picture is the glow, the rays and the ring of stars.
    case starBurst = "star-burst"
    /// The empty and error states' art (`StateArt`): each plays once and settles on its finished
    /// picture, so a page that is empty or failed looks settled, not busy.
    case allDone = "all-done"
    case noTasks = "no-tasks"
    case noWords = "no-words"
    case offline
    case error

    /// Whether `LottieClip(_:)` repeats it when the caller does not say. The first three keep the
    /// blanket default they always had; a burst that repeated would re-burst forever, and a
    /// state's art that repeated would make an empty page look busy.
    var loopsByDefault: Bool {
        switch self {
        case .strikeFlame, .taskComplete, .trophy: true
        case .coinBurst, .starBurst, .allDone, .noTasks, .noWords, .offline, .error: false
        }
    }
}

/// A Lottie, played the way the student's settings allow.
///
/// - `loop` plays forever. Under Reduce Motion or in Low Power Mode it shows its `rest` picture,
///   still (`MotionBudget.allowsLoopingLottie`): a loop never finishes, so it is the motion the
///   battery gives up.
/// - `once` plays through once. Under Reduce Motion it shows nothing, but keeps the frame its
///   caller gave it, so nothing around it moves: the bursts it is for end blank anyway.
/// - `settle` plays once and holds its last frame. Under Reduce Motion it shows its `rest`
///   picture, still: a state's art has something to say even when it does not move.
/// - `still` always shows the `rest` picture.
///
/// One `LottieView` whatever the settings: they pick its playback, never which view is drawn.
struct LottieClip: View {
    enum Playback { case loop, once, settle, still }

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

    /// Read as the celebrations read it (`CelebrationCenter`): at the moment of drawing.
    private var budget: MotionBudget {
        MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
    }

    private static let rest = LottiePlaybackMode.paused(at: .marker("rest"))
    private static let playOnce = LottiePlaybackMode.playing(.fromProgress(0, toProgress: 1, loopMode: .playOnce))

    private var mode: LottiePlaybackMode {
        switch playback {
        case .loop: budget.allowsLoopingLottie ? .playing(.fromProgress(0, toProgress: 1, loopMode: .loop)) : Self.rest
        case .once: reduceMotion ? .paused(at: .frame(0)) : Self.playOnce
        case .settle: reduceMotion ? Self.rest : Self.playOnce
        case .still: Self.rest
        }
    }

    var body: some View {
        LottieView(animation: .named(asset.rawValue))
            .playbackMode(mode)
            .resizable()
            // `LottieView` reads its animation once, when it first appears: a clip handed another
            // asset in place (a failure's art turning to the offline art) needs a new view.
            .id(asset)
            .opacity(playback == .once && reduceMotion ? 0 : 1)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
