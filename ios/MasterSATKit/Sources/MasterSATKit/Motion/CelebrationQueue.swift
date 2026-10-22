import Foundation

/// A piece of work the app celebrates every time it is finished — effort, never a score.
public enum FinishedWork: String, Sendable, CaseIterable, Equatable {
    case homework, assessment, vocabSession, survey

    /// What VoiceOver says, since the check and the confetti cannot be seen.
    public var announcement: String {
        switch self {
        case .homework: return "Homework handed in. Well done."
        case .assessment: return "Assessment handed in. Well done."
        case .vocabSession: return "Round finished. Well done."
        case .survey: return "Survey sent. Thank you."
        }
    }
}

/// Celebrations waiting for the student to be able to see them.
///
/// A task can finish where the root overlay cannot be seen — inside the assessment runner or a
/// word game (full-screen covers), or under the Me sheet. Its check and confetti then wait until
/// the stage is clear. Its "+N XP" waits longer: for the post-task refresh to confirm a gain, for
/// the check to have played, and for a header pill on screen to catch it. Until it lands the gain
/// is HELD: the header shows the old number and rolls when the flight lands.
public struct CelebrationQueue: Sendable, Equatable {
    public struct Flight: Sendable, Equatable, Identifiable {
        public let id: Int
        public let amount: Int
        /// A caption under "+N XP" — set by a "while you were away" gain, nil for a task's.
        public let label: String?
    }

    struct Entry: Sendable, Equatable {
        let id: Int
        /// Nil for a "while you were away" gain: nothing was handed in, so there is no check.
        let work: FinishedWork?
        let xpBefore: Int?
        var effortShown: Bool
        /// Nil while the refresh is out; 0 once it said nothing was earned, or nothing may fly.
        var gain: Int?
        var label: String?
    }

    private(set) var entries: [Entry] = []
    private(set) var flying: [Flight] = []
    private var nextID = 1
    /// The total gains have been claimed up to, so two tasks whose refreshes read the same total
    /// do not both claim the same gain. It follows the total DOWN as well as up: after a take-back
    /// the XP above the total now is not there to be claimed, and a later rise through that band
    /// is new XP — held at the old high-water mark it was under-counted (a real +15 read as +5).
    ///
    /// Only the header's own totals move it: a task's read (`resolve`) and the total a task is
    /// handed in at (`record`) — never an away baseline (`recordAway`), which is what the pill
    /// SHOWED, held XP taken off, and lowering to it would fly a held gain twice.
    private var measuredUpTo: Int?

    public init() {}

    /// XP the header holds back: confirmed, and not landed yet.
    public var held: Int {
        entries.reduce(0) { $0 + ($1.gain ?? 0) } + flying.reduce(0) { $0 + $1.amount }
    }

    /// XP the header holds back, given the total `/rewards/me/` last said (`xpNow`).
    ///
    /// `held` is the confirmed gains whose flight has not landed. This adds the gains that are
    /// not confirmed yet: while an entry still waits for its refresh, every XP above the lowest
    /// total a pending entry will measure from is a gain a flight is about to bring, so it is
    /// held too. A refresh that lands before its entry resolves then shows the old total
    /// instead of the new one, and nothing dips back when the entry resolves (phase 2 hand-off).
    ///
    /// So every entry that is recorded MUST be resolved: an entry left pending holds the header
    /// back for good. `resolve(id, xpAfter: nil, ...)` abandons one (a failed read) — it
    /// measures nothing and stops holding.
    public func held(xpNow: Int?) -> Int {
        guard let xpNow, let floor = pendingFloor else { return held }
        return held + max(0, xpNow - floor)
    }

    /// The lowest total a pending entry will measure its gain from (`resolve`'s floor).
    private var pendingFloor: Int? {
        entries
            .filter { $0.gain == nil }
            .compactMap { entry in entry.xpBefore.map { max($0, measuredUpTo ?? $0) } }
            .min()
    }

    public var isEmpty: Bool { entries.isEmpty && flying.isEmpty }

    /// An entry's read is still out: what it will bring is not known yet, so a place or a total
    /// read now could be ahead of the header.
    public var awaitsRead: Bool { entries.contains { $0.gain == nil } }

    /// A check and confetti still waiting for the stage.
    public var hasHiddenEffort: Bool { entries.contains { !$0.effortShown } }

    /// A confirmed gain not yet in the air.
    public var hasConfirmedGain: Bool { entries.contains { ($0.gain ?? 0) > 0 } }

    public func isFlying(_ id: Int) -> Bool { flying.contains { $0.id == id } }

    /// A task was finished. Its check plays now only when the stage can be seen; otherwise
    /// `takeEfforts` hands it out later. The id MUST be resolved (see `held(xpNow:)`), so the
    /// result is not discardable.
    ///
    /// `xpBefore` is never below the header's total now (`XPDelta.baseline`), so one under the
    /// claimed mark means the total fell since that mark was read: the mark comes down to it.
    public mutating func record(_ work: FinishedWork, xpBefore: Int?, stageVisible: Bool) -> (id: Int, playNow: Bool) {
        if let xpBefore, let mark = measuredUpTo, xpBefore < mark { measuredUpTo = xpBefore }
        let id = nextID
        nextID += 1
        entries.append(Entry(id: id, work: work, xpBefore: xpBefore, effortShown: stageVisible, gain: nil, label: nil))
        return (id, stageVisible)
    }

    /// "While you were away": XP the student has not seen, measured from what the header last
    /// showed them (`xpSeen`, nil on the first launch) by the read that is about to go out.
    /// Recorded BEFORE that read, so a rise landing meanwhile is held at once. No check, no
    /// confetti — only a flight, once `resolve` says what was gained.
    ///
    /// The id MUST be resolved (see `held(xpNow:)`), so the result is not discardable.
    ///
    /// A task that resolves before this entry absorbs the away gain: its read raises
    /// `measuredUpTo` past this entry's floor, so the gain is counted once, never twice. The part
    /// of the rise the task did not measure (below its own start) is then not flown — it lands
    /// silently when the pill catches up.
    public mutating func recordAway(xpSeen: Int?) -> Int {
        let id = nextID
        nextID += 1
        entries.append(Entry(id: id, work: nil, xpBefore: xpSeen, effortShown: true, gain: nil, label: nil))
        return id
    }

    /// The checks still to show, now that the stage can be seen. Each is handed out once.
    public mutating func takeEfforts(stageVisible: Bool) -> [FinishedWork] {
        guard stageVisible else { return [] }
        var shown: [FinishedWork] = []
        for index in entries.indices where !entries[index].effortShown {
            entries[index].effortShown = true
            if let work = entries[index].work { shown.append(work) }
        }
        dropSettled()
        return shown
    }

    /// The refresh after a task came back. Nothing earned — or no flights allowed — holds nothing.
    /// `label` captions the flight (a "while you were away" gain names what was earned). Returns
    /// the gain it measured — also under Reduce Motion, where nothing is held, so the app can
    /// still say it to VoiceOver.
    ///
    /// `xpAfter` is the header's total once the read is in — the newest the app holds (the store
    /// takes answers in request order), so it becomes the claimed mark whichever way it moved: up
    /// past what this entry claims, or down after a take-back.
    @discardableResult
    public mutating func resolve(_ id: Int, xpAfter: Int?, allowsFlights: Bool, label: String? = nil) -> Int {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return 0 }
        let floor = entries[index].xpBefore.map { max($0, measuredUpTo ?? $0) }
        let gain = XPDelta.gain(before: floor, after: xpAfter)
        if let xpAfter { measuredUpTo = xpAfter }
        entries[index].gain = allowsFlights ? gain : 0
        if let label { entries[index].label = label }
        dropSettled()
        return gain
    }

    /// One flight carrying every confirmed gain whose check has played — when the stage can be
    /// seen and a pill is on screen to catch it. Without flights, gives everything back.
    public mutating func takeFlight(stageVisible: Bool, pillVisible: Bool, allowsFlights: Bool) -> Flight? {
        guard allowsFlights else {
            if held > 0 { releaseHeld() }
            return nil
        }
        guard stageVisible, pillVisible else { return nil }
        let ready = entries.filter { $0.effortShown && ($0.gain ?? 0) > 0 }
        guard !ready.isEmpty else { return nil }
        let readyIDs = Set(ready.map(\.id))
        entries.removeAll { readyIDs.contains($0.id) }
        let flight = Flight(
            id: nextID,
            amount: ready.reduce(0) { $0 + ($1.gain ?? 0) },
            label: ready.last(where: { $0.label != nil })?.label
        )
        nextID += 1
        flying.append(flight)
        return flight
    }

    /// The flight reached its pill: what it carried is no longer held.
    public mutating func land(_ id: Int) {
        flying.removeAll { $0.id == id }
    }

    /// Flights became impossible (Reduce Motion): nothing is held back any more.
    public mutating func releaseHeld() {
        for index in entries.indices where (entries[index].gain ?? 0) > 0 {
            entries[index].gain = 0
        }
        flying.removeAll()
        dropSettled()
    }

    /// An entry is finished with once its check has played and nothing is left to fly.
    private mutating func dropSettled() {
        entries.removeAll { $0.effortShown && $0.gain == 0 }
    }
}
