import SwiftUI
import MasterSATKit

/// The event invitation a student meets shortly after the shell appears — the app's half of
/// the website's `EventInviteDialog`.
///
/// An event happens once, on a date, with a fixed number of seats, so a student who does not
/// hear about it in time cannot act on it later: that is what earns the interruption. The
/// rules that keep it a prompt and not a nag are the website's, and the reasons are too:
///
///   * **One prompt at a time.** It waits out its own 2.2 s — long enough for the shell to
///     settle, and for anything else that is opening to have committed to it — and only then
///     looks at the stage. If the Me sheet, the certificate sheet or onboarding's intro has
///     the screen, it looks again every second rather than stacking a second scrim on top.
///   * **Never on the Events screen.** Interrupting somebody to recommend the page they are
///     reading is how a prompt teaches people to dismiss prompts.
///   * **Once per launch, per event** (`EventInviteMemory`), marked when the card is actually
///     seen — a student who never saw it has not been asked.
///   * **A failed load shows nothing.** A card cannot honestly name an event it did not load.
///
/// Drawn as an empty view in `RootTabView`'s `.background { }`, for `RewardsRefresher`'s
/// reason: the polling and the loaded event live here, so a change to either rebuilds this
/// and not the tab view, whose rebuild would take the navigation stacks with it.
///
/// The waiting is here; the SHEET is not. It is the router's third sheet, presented by
/// `RootTabView` beside the Me and certificate sheets, because a sheet presented from this
/// zero-size view is a second host presenting at the same time: a deep link arriving while
/// the invitation was up set `showingMe` against an already-presenting view, SwiftUI dropped
/// the Me sheet and left the flag true, and every later tap on the avatar did nothing.
struct EventInvitePrompt: View {
    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router
    @Environment(AppPrompts.self) private var prompts
    /// Only to ask whether a cover has the screen — never rendered from, so this view does not
    /// rebuild with the celebrations.
    @Environment(CelebrationCenter.self) private var celebrations
    @State private var model = EventInviteModel()

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .task {
                await model.run(
                    api: EventsAPI(client: session.client),
                    stageIsClear: stageIsClear,
                    // Handed to the router, which presents it: the one host, the one sheet
                    // at a time.
                    present: { router.eventInvite = $0 }
                )
            }
    }

    /// Whether the screen is free for one more thing to ask for it.
    ///
    /// Every one of these is READ on each pass of the loop, never observed: rendering from them
    /// would rebuild the shell, and `CelebrationCenter.isCovered` could not be observed anyway
    /// (the count behind it is `@ObservationIgnored`). Asking at the moment of the check is what
    /// makes a cover opened long after the first pass — a vocab game, the assessment runner,
    /// Live Quiz, the story viewer — count just as much as one that was up at the start.
    @MainActor
    private func stageIsClear() -> Bool {
        !router.showingMe
            && router.certificate == nil
            && router.eventInvite == nil
            && !celebrations.isCovered
            && !prompts.isTourShowing
            && !EventsScreenPresence.shared.isOpen
    }
}

/// The waiting, and nothing else: the event it settles on is handed to the router, which
/// owns every sheet. Nothing here is rendered from, so it is a plain class — an observable
/// one would only invite a future reader to draw from it and bring the tab view's rebuild
/// back with them.
@MainActor
final class EventInviteModel {
    /// Long enough for the page behind it to settle, short enough to still read as
    /// "on sign-in" — the website's own 2200 ms.
    private static let openDelay: Duration = .milliseconds(2200)
    /// How often to look again while something else still has the screen.
    private static let recheck: Duration = .seconds(1)

    private let memory = EventInviteMemory()
    /// One run per launch. `.task` runs again whenever the view it is on is rebuilt with a new
    /// identity, and a second run would ask about a second event in the same sitting.
    private var hasRun = false

    func run(
        api: EventsAPI,
        stageIsClear: @escaping @MainActor () -> Bool,
        present: @escaping @MainActor (LearningEvent) -> Void
    ) async {
        guard !hasRun else { return }
        hasRun = true

        let events: [LearningEvent]
        do {
            events = try await api.upcoming()
        } catch {
            // Silence, deliberately: an invitation is worth an interruption only when it can
            // name the event and the seats left.
            return
        }
        guard let featured = EventInviteRules.featured(events, shown: memory.shownIds) else { return }

        do { try await Task.sleep(for: Self.openDelay) } catch { return }

        while !Task.isCancelled {
            if stageIsClear() {
                // Marked as it opens, not as it was chosen.
                memory.remember(featured.id)
                present(featured)
                return
            }
            do { try await Task.sleep(for: Self.recheck) } catch { return }
        }
    }
}

/// Whether the Events screen is on screen right now.
///
/// A `NavigationPath` cannot be read back, so the only honest answer comes from the page
/// itself saying when it is up. A SET of the pages currently up, rather than a count: the
/// page can appear on a second tab before the first one's disappearance arrives, so a flag
/// would end up stuck false — and a count, which this was, ran the other way. `opened()` had
/// no ceiling, so a single unmatched `onAppear` (a page rebuilt with a new identity, a
/// disappearance SwiftUI never sent) left the count above zero for the life of the process
/// and the invitation never fired again. Keyed by the view's own token, a repeated `opened()`
/// from the same page changes nothing.
@MainActor
final class EventsScreenPresence {
    static let shared = EventsScreenPresence()

    private var open: Set<UUID> = []

    var isOpen: Bool { !open.isEmpty }

    func opened(_ token: UUID) { open.insert(token) }

    func closed(_ token: UUID) { open.remove(token) }
}

extension View {
    /// Put on the Events page: while it is up, the event invitation holds off.
    func marksEventsScreenOpen() -> some View {
        modifier(EventsScreenPresenceMarker())
    }
}

/// A modifier rather than two closures on the call site, because the token has to be state:
/// one identity per living view, so the `onDisappear` clears exactly what its own `onAppear`
/// set and nothing else's.
private struct EventsScreenPresenceMarker: ViewModifier {
    @State private var token = UUID()

    func body(content: Content) -> some View {
        content
            .onAppear { EventsScreenPresence.shared.opened(token) }
            .onDisappear { EventsScreenPresence.shared.closed(token) }
    }
}
