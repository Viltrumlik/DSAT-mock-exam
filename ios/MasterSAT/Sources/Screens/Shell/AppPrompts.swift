import SwiftUI

/// Whether something that owns the whole screen is already asking the student for something.
///
/// One flag, deliberately: the prompts a student can meet on the first screen after signing in
/// have to take turns, and a flag they all read is cheaper than each one learning about the
/// others. `ios-onboarding`'s `TourCoordinator` is its SINGLE writer — it sets this true while
/// the onboarding intro cover or a per-tab tip card is up, and false again once both are down.
///
/// This branch only READS it (`EventInvitePrompt` waits while it is true). Nothing here writes
/// it yet; the one-line join-up belongs to whichever of the two branches merges second.
@MainActor
@Observable
final class AppPrompts {
    /// The onboarding intro, or one of its tip cards, has the screen.
    var isTourShowing = false

    init() {}
}
