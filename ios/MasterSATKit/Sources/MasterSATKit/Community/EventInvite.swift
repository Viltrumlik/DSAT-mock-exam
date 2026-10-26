import Foundation

// Which event is worth interrupting a student for, and whether they have already been asked
// about it. The web's `EventInviteDialog` + `lib/eventInvitePrompt`, ported as rules so the
// app target only draws the card.

/// Picking the one event an invitation may name.
public enum EventInviteRules {
    /// The soonest event the student could still take a seat at, skipping the ones they have
    /// already been shown this launch.
    ///
    /// `/events/` arrives ordered by start, so the first open row IS the soonest — but the
    /// list is sorted here all the same: a prompt that named the second-soonest event because
    /// the server's ordering changed would send somebody to the wrong date. An event with no
    /// readable start sorts last; it can still be signed up for, but it cannot win over one
    /// that knows when it begins.
    ///
    /// Nil for an empty list (a failed load arrives here as one — a card cannot honestly name
    /// an event it did not load) and when every candidate has already been seen.
    /// Whether this account is one to invite to a seat at all.
    ///
    /// Seats are a student's, and `can_sign_up` is not a role check — the server leaves that to
    /// the client, which is why the web gates its dialog on `isStudentSiteRole`. Without this, a
    /// teacher signing in on their phone was offered a student's seat (owner, 2026-10-26).
    /// Public learners count: events are one of the two things they see.
    ///
    /// An unknown or missing role is NOT invited. A role this build does not recognise is more
    /// likely a new staff role than a new kind of student, and the cost of staying quiet is one
    /// missed prompt.
    public static func mayBeInvited(role: String?) -> Bool {
        switch (role ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "student", "public_student": return true
        default: return false
        }
    }

    public static func featured(_ events: [LearningEvent], shown: Set<Int> = []) -> LearningEvent? {
        events
            .filter { $0.canSignUp && !shown.contains($0.id) }
            .min { left, right in
                switch (left.startDate, right.startDate) {
                case let (l?, r?): return l == r ? left.id < right.id : l < r
                case (nil, _?): return false
                case (_?, nil): return true
                case (nil, nil): return left.id < right.id
                }
            }
    }
}

/// Which invitations this launch has already put on screen.
///
/// Per launch, in memory — the app's answer to the web's `sessionStorage`. A relaunch is a
/// new sign-in moment and the seat is still worth one interruption; remembering it on disk
/// would silence an event for good on that phone. Keyed per event id, never one flag, so this
/// week's open day cannot swallow next month's.
@MainActor
public final class EventInviteMemory {
    private var shown: Set<Int> = []

    public init() {}

    /// Every id asked about so far — what `featured(_:shown:)` takes.
    public var shownIds: Set<Int> { shown }

    /// Recorded when the card is actually SEEN, not when it is chosen: a student who signs in
    /// and puts the phone away before the card opens has not been asked.
    public func remember(_ eventId: Int) {
        shown.insert(eventId)
    }

    public func wasShown(_ eventId: Int) -> Bool {
        shown.contains(eventId)
    }
}
