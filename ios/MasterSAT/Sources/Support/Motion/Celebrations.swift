import SwiftUI
import MasterSATKit

/// "+N XP" on its way from the middle of the screen to the header pill that will catch it.
struct XPFlight: Identifiable, Equatable {
    /// The queue's flight id: landing it gives the header back exactly what it carried.
    let id: Int
    let amount: Int
    let from: CGPoint
    let to: CGPoint
    /// The pill it was aimed at — the only one that pulses when it lands.
    let owner: UUID
    /// A caption under the number — what a "while you were away" gain was for.
    let label: String?
}

/// The check that pops where a piece of work was finished.
struct EffortCue: Identifiable, Equatable {
    let id = UUID()
    let work: FinishedWork
    let at: CGPoint
}

/// The coin that bursts where a purchase or a conversion was confirmed.
struct CoinCue: Identifiable, Equatable {
    let id = UUID()
    let at: CGPoint
}

/// A landing, and the pill it landed on.
struct XPLanding: Equatable {
    let count: Int
    let owner: UUID
}

/// The header pill on screen that a flight can land on.
private struct PillTarget: Equatable {
    let rect: CGRect
    let owner: UUID
}

/// Everything celebratory on screen, in one place, drawn by one overlay at the root.
///
/// A finished task (`celebrate`) plays its check, confetti, haptic and announcement at once
/// when the overlay can be seen — and later when it cannot: under the Me sheet, or inside a
/// full-screen cover (`coversCelebrations`). Its XP is the server's word: the header refreshes,
/// the gain is the new total minus the old, and only a positive gain flies — once a header pill
/// is on screen to catch it. Until it lands the gain is HELD, so the pill rolls when it lands
/// rather than before the flight leaves. The rules are `CelebrationQueue`, in the kit.
///
/// Points are GLOBAL coordinates (`.frame(in: .global)`): the overlay ignores the safe area and
/// covers the screen, so the two agree.
@MainActor
@Observable
final class CelebrationCenter {
    enum Size { case task, everything }

    var reduceMotion = false {
        didSet {
            // Nothing may fly any more: give the header back what it was holding.
            if reduceMotion, !oldValue, queue.held > 0 { queue.releaseHeld() }
        }
    }
    private(set) var bursts: [ConfettiBurst] = []
    private(set) var flights: [XPFlight] = []
    /// The check on screen now, if any.
    private(set) var effort: EffortCue?
    /// Bumps once per celebration — the success haptic's trigger.
    private(set) var effortCount = 0
    private(set) var landing: XPLanding?
    /// The coin burst on screen now, if any.
    private(set) var coin: CoinCue?
    /// Bumps once per coin burst — its success haptic's trigger.
    private(set) var coinCount = 0
    private var queue = CelebrationQueue()

    // Bookkeeping nothing renders from.
    @ObservationIgnored private var target: PillTarget?
    /// Everything due this week went in while a sheet or a cover was up: the double confetti
    /// waits for the stage instead of being lost.
    @ObservationIgnored private var allDoneWaiting = false
    @ObservationIgnored private var sheetUp = false
    @ObservationIgnored private var coversUp = 0
    @ObservationIgnored private var stage: CGSize = .zero
    @ObservationIgnored private weak var rewards: RewardsStore?
    @ObservationIgnored private var rewardsAPI: RewardsAPI?

    /// XP earned but not landed yet — and, while an entry's own read is still out, any rise a
    /// refresh that beat it has already brought (`CelebrationQueue.held(xpNow:)`), so the pill
    /// never shows a gain a flight is about to bring and then dips. Every pill shows
    /// `xp − heldXP`. Under Reduce Motion nothing flies, so nothing is held.
    var heldXP: Int { reduceMotion ? queue.held : queue.held(xpNow: rewards?.xp) }

    /// The XP the header shows now — what a task's gain is measured from.
    var xpNow: Int? { rewards?.xp }

    private var covered: Bool { sheetUp || coversUp > 0 }

    private var budget: MotionBudget {
        MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
    }

    private var stageCentre: CGPoint { CGPoint(x: stage.width / 2, y: stage.height * 0.45) }
    private var flightOrigin: CGPoint { CGPoint(x: stage.width / 2, y: stage.height * 0.6) }

    /// The header numbers a celebration refreshes and measures. Called once, by the root.
    func connect(rewards: RewardsStore, api: RewardsAPI) {
        self.rewards = rewards
        rewardsAPI = api
    }

    // MARK: - Finished work

    /// A piece of work is in. `xpBefore` is `xpNow` read when the work started; `point` is where
    /// the confetti leaves from when it plays at once (the button), else the screen's centre.
    ///
    /// Contract: call once per piece of work; never on a failed submit. Every call plays its own
    /// check and queues its own XP gain, so the caller calls it only after the server confirmed
    /// the work, from a one-shot point (a flag, or the not-done to done transition) that a
    /// re-render, a double tap or a retried callback cannot fire twice.
    func celebrate(_ work: FinishedWork, xpBefore: Int?, at point: CGPoint? = nil) {
        let entry = queue.record(work, xpBefore: xpBefore, stageVisible: !covered)
        if entry.playNow { playEffort(work, at: point) }
        Task { [weak self] in
            guard let self else { return }
            var after: Int?
            if let rewards = self.rewards, let api = self.rewardsAPI {
                after = await rewards.refresh(using: api)
            }
            // Animated: a failed read (nil) or a gain that is not one gives back the rise this
            // entry was holding (`heldXP`), and the pill rolls to it rather than jumping.
            withAnimation(Motion.snappy) {
                _ = self.queue.resolve(entry.id, xpAfter: after, allowsFlights: self.budget.allowsFlights)
            }
            self.flyIfReady()
        }
    }

    /// Everything due this week is in: double confetti. The hero bounces on its own. Under a
    /// sheet or a cover it waits, and plays the moment the stage is clear.
    func allDone() {
        guard !covered else {
            allDoneWaiting = true
            return
        }
        playAllDone()
    }

    private func playAllDone() {
        confetti(at: CGPoint(x: stage.width * 0.3, y: stage.height * 0.4), size: .everything)
        confetti(at: CGPoint(x: stage.width * 0.7, y: stage.height * 0.4), size: .everything)
        effortCount += 1
        announce("Everything due this week is done.")
    }

    /// A purchase or a conversion went through — the server said so. A coin bursts where it was
    /// confirmed (else mid-screen), with a success haptic. Called once per confirmed purchase or
    /// conversion by the page that made it; the page's own message says what happened, so this
    /// says nothing to VoiceOver. Under a sheet or a cover it is skipped — the overlay sits under
    /// them (the Me sheet pushes Shop and Points too) — and the page's message still lands.
    func coinBurst(at point: CGPoint?) {
        guard !covered else { return }
        let cue = CoinCue(at: point ?? stageCentre)
        coin = cue
        coinCount += 1
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.6))
            if self?.coin?.id == cue.id { self?.coin = nil }
        }
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

    /// What a celebration says to VoiceOver, since it cannot be seen.
    func announce(_ text: String) {
        AccessibilityNotification.Announcement(text).post()
    }

    // MARK: - What can be seen

    func setStage(_ size: CGSize) {
        if stage != size { stage = size }
    }

    /// The Me sheet or the certificate came up (the router says so at once), or has gone (its
    /// `onDismiss` says so, once it has left the screen).
    func setSheetUp(_ up: Bool) {
        guard sheetUp != up else { return }
        sheetUp = up
        if !covered { stageCleared() }
    }

    func coverAppeared() { coversUp += 1 }

    func coverDisappeared() {
        guard coversUp > 0 else { return }
        coversUp -= 1
        if !covered { stageCleared() }
    }

    /// A tab root's pill came on screen, so no cover is up — whatever a cover that never
    /// reported leaving left behind.
    func pillAppeared() {
        guard coversUp > 0 else { return }
        coversUp = 0
        if !covered { stageCleared() }
    }

    func setXPTarget(_ rect: CGRect, owner: UUID) {
        let next = PillTarget(rect: rect, owner: owner)
        guard target != next else { return }
        let arrived = target == nil
        target = next
        if arrived { flyIfReady() }
    }

    func clearXPTarget(owner: UUID) {
        if target?.owner == owner { target = nil }
    }

    // MARK: - Flights

    func landed(_ flight: XPFlight) {
        guard let index = flights.firstIndex(where: { $0.id == flight.id }) else { return }
        flights.remove(at: index)
        withAnimation(Motion.snappy) { queue.land(flight.id) }
        landing = XPLanding(count: (landing?.count ?? 0) + 1, owner: flight.owner)
    }

    private func stageCleared() {
        if queue.hasHiddenEffort {
            for work in queue.takeEfforts(stageVisible: true) { playEffort(work, at: nil) }
        }
        if allDoneWaiting {
            allDoneWaiting = false
            playAllDone()
        }
        flyIfReady()
    }

    private func playEffort(_ work: FinishedWork, at point: CGPoint?) {
        let cue = EffortCue(work: work, at: point ?? stageCentre)
        effort = cue
        effortCount += 1
        confetti(at: cue.at)
        announce(work.announcement)
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.9))
            if self?.effort?.id == cue.id { self?.effort = nil }
        }
    }

    private func flyIfReady() {
        guard queue.hasConfirmedGain, let pill = target,
              let flight = queue.takeFlight(stageVisible: !covered, pillVisible: true, allowsFlights: budget.allowsFlights)
        else { return }
        flights.append(XPFlight(
            id: flight.id,
            amount: flight.amount,
            from: flightOrigin,
            to: CGPoint(x: pill.rect.midX, y: pill.rect.midY),
            owner: pill.owner,
            label: flight.label
        ))
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.5))
            self?.settle(flight.id)
        }
    }

    /// The backstop: a flight whose view went away before it landed still gives its XP back.
    /// The flight itself goes either way — Reduce Motion can clear the queue's side mid-air
    /// (`releaseHeld`), and a flight left in `flights` would hang on screen with no one to land it.
    private func settle(_ id: Int) {
        if let index = flights.firstIndex(where: { $0.id == id }) { flights.remove(at: index) }
        // Animated, as `landed` is: the pill rolls up rather than jumping.
        if queue.isFlying(id) { withAnimation(Motion.snappy) { queue.land(id) } }
    }
}

extension CGRect {
    /// The middle of a measured control; nil before it has been measured.
    var celebrationPoint: CGPoint? { self == .zero ? nil : CGPoint(x: midX, y: midY) }
}

extension View {
    /// Put on a full-screen cover's content. While it is up the root overlay is hidden behind
    /// it, so a celebration started inside waits, and plays the moment the cover has gone.
    func coversCelebrations(_ center: CelebrationCenter) -> some View {
        onAppear { center.coverAppeared() }
            .onDisappear { center.coverDisappeared() }
    }
}

/// The overlay that draws the confetti, the check and the flights. Never takes a touch.
struct CelebrationLayer: View {
    @Environment(CelebrationCenter.self) private var center

    var body: some View {
        ZStack {
            ConfettiCanvas(bursts: center.bursts)
            if let effort = center.effort {
                TaskCompleteBadge(reduceMotion: center.reduceMotion)
                    .frame(width: 120, height: 120)
                    .position(effort.at)
                    .id(effort.id)
                    .transition(.opacity)
            }
            if let coin = center.coin {
                CoinBurstBadge(reduceMotion: center.reduceMotion)
                    .frame(width: 150, height: 150)
                    .position(coin.at)
                    .id(coin.id)
                    .transition(.opacity)
            }
            ForEach(center.flights) { flight in
                XPFlightView(flight: flight) { center.landed(flight) }
            }
        }
        .animation(.easeOut(duration: 0.25), value: center.effort?.id)
        .animation(.easeOut(duration: 0.25), value: center.coin?.id)
        .onGeometryChange(for: CGSize.self) { $0.size } action: { center.setStage($0) }
        .sensoryFeedback(.success, trigger: center.effortCount)
        .sensoryFeedback(.success, trigger: center.coinCount)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The task-complete check. Under Reduce Motion a still tick, faded in and out by the layer.
struct TaskCompleteBadge: View {
    let reduceMotion: Bool

    var body: some View {
        if reduceMotion {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64, weight: .bold))
                .foregroundStyle(Theme.success)
                .background(Circle().fill(Theme.card).padding(6))
        } else {
            LottieClip(.taskComplete, playback: .once)
        }
    }
}

/// The coin burst. Under Reduce Motion a still coin, faded in and out by the layer.
struct CoinBurstBadge: View {
    let reduceMotion: Bool

    var body: some View {
        if reduceMotion {
            RewardsCoinArt(kind: .coin, size: 72)
        } else {
            LottieClip(.coinBurst, playback: .once)
        }
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
        VStack(spacing: 4) {
            Text("+\(flight.amount) XP")
                .font(.system(size: 22, weight: .black, design: .rounded))
                .foregroundStyle(Theme.amber)
                .shadow(color: .black.opacity(0.18), radius: 5, y: 2)
            // What it was for, while it hangs in the air; gone before it reaches the pill.
            if let label = flight.label {
                Text(label)
                    .font(.system(size: 11, weight: .heavy, design: .rounded))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Theme.card, in: Capsule())
                    .opacity(phase == 1 ? 1 : 0)
            }
        }
        .scaleEffect(phase == 0 ? 0.3 : (phase == 1 ? 1.35 : 0.55))
        .opacity(phase == 2 ? 0.3 : 1)
        .position(phase == 2 ? flight.to : CGPoint(x: flight.from.x - 20, y: flight.from.y - (phase == 0 ? 0 : 54)))
        .task {
            withAnimation(Motion.pop) { phase = 1 }
            do { try await Task.sleep(for: .milliseconds(380)) } catch { return }
            withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) { phase = 2 } completion: { onLand() }
        }
    }
}
