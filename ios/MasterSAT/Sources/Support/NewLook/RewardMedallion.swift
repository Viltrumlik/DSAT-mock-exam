import SwiftUI
import MasterSATKit

/// A reward medallion in its tinted tile — the kit's `.tile-ic` + `.medal`: our own coin
/// pictures (`RewardCoin`, `RewardPoint`) where the design shows a coin, a round blue medal with a
/// glyph for XP, the strike and the leaderboard.
///
/// **Motion (owner: "motion animation bering").** The medallion floats: up 1.5 pt and 4° over
/// three and a half seconds and back. A glint — a soft white band — sweeps across it every few
/// seconds (the kit's `msGlint`: 5.5 s, the sweep in its first 1.2 s). `phase` staggers the glint
/// so four cards side by side do not flash at once.
///
/// Under Reduce Motion and in Low Power both hold still (`MotionBudget.allowsLoopingLottie`, the
/// rule every endless loop in the app keeps). The view tree is the same either way: the setting
/// only picks the values and drops the animation — nothing is swapped in or out.
struct RewardMedallion: View {
    enum Kind: Sendable {
        /// `RewardCoin`, on bronze.
        case coin
        /// `RewardPoint`, on blue.
        case point
        /// A blue medal with the bolt.
        case xp
        /// A blue medal with the flame — lessons attended in a row.
        case strike
        /// A bronze medal with the trophy.
        case rank
        /// A bronze medal with the shopping bag (the Shop rail's heading).
        case shop

        var tone: NewLook.Tone {
            switch self {
            case .coin, .rank, .shop: .bronze
            case .point, .xp, .strike: .blue
            }
        }

        var asset: String? {
            switch self {
            case .coin: "RewardCoin"
            case .point: "RewardPoint"
            default: nil
            }
        }

        var glyph: String {
            switch self {
            case .coin, .point: ""
            case .xp: "bolt.fill"
            case .strike: "flame.fill"
            case .rank: "trophy.fill"
            case .shop: "bag.fill"
            }
        }
    }

    let kind: Kind
    /// The tile's side; the medal inside is 31/44 of it (a coin picture, 36/44).
    var size: CGFloat = 44
    /// Seconds the glint waits before its first sweep, so cards side by side take turns.
    var phase: Double = 0
    /// Whether the medallion moves at all — off for a still copy (a list row).
    var moves = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var floating = false
    @State private var sweeping = false

    private var budgetAllows: Bool {
        moves && MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
            .allowsLoopingLottie
    }

    private var medalSide: CGFloat { size * (kind.asset == nil ? 31 / 44 : 36 / 44) }

    var body: some View {
        RoundedRectangle(cornerRadius: size * 14 / 44, style: .continuous)
            .fill(kind.tone.fill)
            .frame(width: size, height: size)
            .overlay {
                medal
                    .overlay { glint }
                    .clipShape(Circle())
                    // Scoped to the float's own two properties, as `ShieldWatermark` scopes its
                    // drift: a repeat applied to the whole update would repeat whatever else
                    // changed in it.
                    .animation(budgetAllows ? .easeInOut(duration: 3.5).repeatForever(autoreverses: true) : nil) {
                        $0.offset(y: floating ? -1.5 : 0).rotationEffect(.degrees(floating ? -4 : 0))
                    }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onAppear { start() }
            .onDisappear {
                floating = false
                sweeping = false
            }
            .onChange(of: budgetAllows) { _, _ in start() }
    }

    @ViewBuilder private var medal: some View {
        if let asset = kind.asset {
            Image(asset)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: medalSide, height: medalSide)
        } else {
            Circle()
                .fill(kind.tone == .bronze ? NewLook.bronze : NewLook.blue)
                .overlay {
                    Circle().strokeBorder(kind.tone == .bronze ? NewLook.bronzeRing : NewLook.blueRing, lineWidth: 2)
                }
                .overlay {
                    Image(systemName: kind.glyph)
                        .font(.system(size: medalSide * 0.55, weight: .bold))
                        .foregroundStyle(.white)
                }
                .frame(width: medalSide, height: medalSide)
                .shadow(color: .black.opacity(0.25), radius: 1, y: 1)
        }
    }

    /// The kit's `.medal::after`: a white band, 45 % wide, tilted 25°, crossing from −160 % to
    /// +360 % of its own width in the first 1.2 s of every 5.5 s. Off the medal (and clipped away)
    /// the rest of the time.
    private var glint: some View {
        let band = medalSide * 0.45
        return LinearGradient(
            colors: [.white.opacity(0), .white.opacity(0.55), .white.opacity(0)],
            startPoint: .leading,
            endPoint: .trailing
        )
        .frame(width: band, height: medalSide * 1.6)
        .rotationEffect(.degrees(25))
        .frame(width: medalSide, height: medalSide, alignment: .leading)
        .animation(
            budgetAllows
                ? .easeInOut(duration: 1.2).delay(4.3).repeatForever(autoreverses: false)
                : nil
        ) {
            $0.offset(x: sweeping ? band * 3.6 : -band * 1.6)
        }
    }

    private func start() {
        let allowed = budgetAllows
        if floating != allowed { floating = allowed }
        guard allowed else {
            if sweeping { sweeping = false }
            return
        }
        guard !sweeping else { return }
        // The first sweep waits `phase` (plus the loop's own 4.3 s), so four cards take turns.
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(phase))
            // Held still meanwhile? `start` runs again on that change and lowers it; a band left
            // at its far end is off the medal, so a late write here shows nothing either way.
            if !Task.isCancelled { sweeping = true }
        }
    }
}
