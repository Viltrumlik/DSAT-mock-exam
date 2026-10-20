import SwiftUI
import MasterSATKit

/// "+N XP" on its way from where it was earned to the header pill.
struct XPFlight: Identifiable, Equatable {
    let id = UUID()
    let amount: Int
    let from: CGPoint
    let to: CGPoint
}

/// Everything celebratory on screen, in one place, drawn by one overlay at the root.
///
/// Points are GLOBAL coordinates (`.frame(in: .global)`), which is what the overlay draws
/// in because it ignores the safe area. A flight is only ever started for XP the server
/// confirmed — this class does not decide that, its callers do.
@MainActor
@Observable
final class CelebrationCenter {
    enum Size { case task, everything }

    var reduceMotion = false
    private(set) var bursts: [ConfettiBurst] = []
    private(set) var flights: [XPFlight] = []
    /// Bumps when a flight lands; the XP pill pulses on it.
    private(set) var landedCount = 0
    private var xpTarget: CGRect = .zero

    private var budget: MotionBudget {
        MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
    }

    func confetti(at point: CGPoint, size: Size = .task) {
        let count = budget.confetti(size == .task ? 44 : 80)
        guard count > 0 else { return }
        bursts.append(.make(x: point.x, y: point.y, count: count, power: size == .task ? 1 : 1.25))
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(ConfettiBurst.lifetime + 0.2))
            self?.bursts.removeAll { $0.isFinished(at: .now) }
        }
    }

    func flyXP(_ amount: Int, from point: CGPoint) {
        guard amount > 0, budget.allowsFlights, xpTarget != .zero else { return }
        flights.append(XPFlight(amount: amount, from: point, to: CGPoint(x: xpTarget.midX, y: xpTarget.midY)))
    }

    func landed(_ flight: XPFlight) {
        flights.removeAll { $0.id == flight.id }
        landedCount += 1
    }

    func setXPTarget(_ rect: CGRect) {
        if rect != xpTarget { xpTarget = rect }
    }

    /// What a celebration says to VoiceOver, since it cannot be seen.
    func announce(_ text: String) {
        AccessibilityNotification.Announcement(text).post()
    }
}

/// The overlay that draws the confetti and the flights. Never takes a touch.
struct CelebrationLayer: View {
    @Environment(CelebrationCenter.self) private var center

    var body: some View {
        ZStack {
            ConfettiCanvas(bursts: center.bursts)
            ForEach(center.flights) { flight in
                XPFlightView(flight: flight) { center.landed(flight) }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

struct ConfettiCanvas: View {
    let bursts: [ConfettiBurst]

    static let palette: [Color] = [Theme.accent, Theme.success, Theme.amber, Theme.subjectEnglish, Theme.danger, Theme.info]

    var body: some View {
        TimelineView(.animation(minimumInterval: nil, paused: bursts.isEmpty)) { timeline in
            Canvas { context, _ in
                for burst in bursts {
                    let t = timeline.date.timeIntervalSince(burst.start)
                    guard t >= 0, t < ConfettiBurst.lifetime else { continue }
                    let fade = burst.opacity(at: t)
                    for particle in burst.particles {
                        let point = burst.position(of: particle, at: t)
                        var piece = context
                        piece.opacity = fade
                        piece.translateBy(x: point.x, y: point.y)
                        piece.rotate(by: .radians(particle.spin * t))
                        piece.fill(Self.shape(particle), with: .color(Self.palette[particle.colorIndex % Self.palette.count]))
                    }
                }
            }
        }
    }

    private static func shape(_ particle: ConfettiParticle) -> Path {
        let s = particle.size
        switch particle.shape {
        case 0: return Path(roundedRect: CGRect(x: -s / 2, y: -s * 0.8, width: s, height: s * 1.6), cornerRadius: 2)
        case 1: return Path(ellipseIn: CGRect(x: -s / 2, y: -s / 2, width: s, height: s))
        default: return Path(roundedRect: CGRect(x: -s * 0.7, y: -s / 4, width: s * 1.4, height: s / 2), cornerRadius: 1)
        }
    }
}

struct XPFlightView: View {
    let flight: XPFlight
    let onLand: @MainActor () -> Void

    @State private var phase = 0

    var body: some View {
        Text("+\(flight.amount) XP")
            .font(.system(size: 22, weight: .black, design: .rounded))
            .foregroundStyle(Theme.amber)
            .shadow(color: .black.opacity(0.18), radius: 5, y: 2)
            .scaleEffect(phase == 0 ? 0.3 : (phase == 1 ? 1.35 : 0.55))
            .opacity(phase == 2 ? 0.3 : 1)
            .position(phase == 2 ? flight.to : CGPoint(x: flight.from.x - 20, y: flight.from.y - (phase == 0 ? 0 : 54)))
            .task {
                withAnimation(Motion.pop) { phase = 1 }
                try? await Task.sleep(for: .milliseconds(380))
                withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) { phase = 2 } completion: { onLand() }
            }
    }
}
