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
struct EventInvitePrompt: View {
    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router
    @Environment(AppPrompts.self) private var prompts
    @Environment(\.openURL) private var openURL
    @State private var model = EventInviteModel()

    var body: some View {
        @Bindable var model = model
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .task {
                await model.run(api: EventsAPI(client: session.client), stageIsClear: stageIsClear)
            }
            .sheet(item: $model.invitation) { event in
                EventInviteSheet(
                    event: event,
                    api: EventsAPI(client: session.client),
                    onSeeAllEvents: {
                        model.invitation = nil
                        // Through the router, as every route in this app is: `show` closes the
                        // other sheets and lands on Explore's Events page at its root.
                        router.open(.events, baseURL: session.client.config.baseURL) { openURL($0) }
                    },
                    onClose: { model.invitation = nil }
                )
            }
    }

    /// Whether the screen is free for one more thing to ask for it.
    ///
    /// The router's own observable state and `AppPrompts` — not `CelebrationCenter`'s cover
    /// count, which is private to it: a view gating on that would read it once and never hear
    /// that it changed. Read fresh on each pass of the loop rather than observed, so nothing
    /// here rebuilds the shell.
    @MainActor
    private func stageIsClear() -> Bool {
        !router.showingMe
            && router.certificate == nil
            && !prompts.isTourShowing
            && !EventsScreenPresence.shared.isOpen
    }
}

/// The waiting, and the event that came out of it.
@MainActor
@Observable
final class EventInviteModel {
    /// Long enough for the page behind it to settle, short enough to still read as
    /// "on sign-in" — the website's own 2200 ms.
    private static let openDelay: Duration = .milliseconds(2200)
    /// How often to look again while something else still has the screen.
    private static let recheck: Duration = .seconds(1)

    /// The event on screen. Bound to the sheet, so closing it clears this.
    var invitation: LearningEvent?

    /// Nothing renders from either of these, so they stay out of observation.
    @ObservationIgnored private let memory = EventInviteMemory()
    /// One run per launch. `.task` runs again whenever the view it is on is rebuilt with a new
    /// identity, and a second run would ask about a second event in the same sitting.
    @ObservationIgnored private var hasRun = false

    func run(api: EventsAPI, stageIsClear: @escaping @MainActor () -> Bool) async {
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
                invitation = featured
                return
            }
            do { try await Task.sleep(for: Self.recheck) } catch { return }
        }
    }
}

/// Whether the Events screen is on screen right now.
///
/// A `NavigationPath` cannot be read back, so the only honest answer comes from the page
/// itself saying when it is up. A count rather than a flag: the page can appear on a second
/// tab before the first one's disappearance arrives, and a flag would end up stuck false.
@MainActor
final class EventsScreenPresence {
    static let shared = EventsScreenPresence()

    private var open = 0

    var isOpen: Bool { open > 0 }

    func opened() { open += 1 }

    func closed() { open = max(0, open - 1) }
}

extension View {
    /// Put on the Events page: while it is up, the event invitation holds off.
    ///
    /// `@MainActor` because the presence it touches is: a `View` extension is not isolated by
    /// the protocol, so without this the two closures below would be nonisolated code reaching
    /// main-actor state.
    @MainActor
    func marksEventsScreenOpen() -> some View {
        onAppear { EventsScreenPresence.shared.opened() }
            .onDisappear { EventsScreenPresence.shared.closed() }
    }
}
