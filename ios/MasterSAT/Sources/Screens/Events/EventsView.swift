import SwiftUI
import MasterSATKit

/// The site's `/events`: workshops, talks and open days, and the seats the student holds.
///
/// Mount as `EventsView()`. Unlike the web it also shows each event's cover and description:
/// the server sends both and the web simply never drew them (defect #11).
struct EventsView: View {
    @Environment(Session.self) private var session
    @State private var model: EventsModel?

    var body: some View {
        Group {
            if let model {
                EventsScreen(model: model)
            } else {
                Theme.background
            }
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if model == nil { model = EventsModel(api: EventsAPI(client: session.client)) }
        }
    }
}

private struct EventsScreen: View {
    @Bindable var model: EventsModel

    @Environment(\.scenePhase) private var scenePhase
    @State private var cancelling: LearningEvent?
    @State private var confirmingFinalSignUp: LearningEvent?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroHeader(
                    eyebrow: "Events",
                    eyebrowIcon: "calendar",
                    title: "Events",
                    // The web ends "earn XP"; attending pays POINTS (`EVENT_ATTENDED`).
                    blurb: "Workshops, talks and open days at the learning center. Take a seat, turn up, earn points.",
                    tiles: heroTiles
                )
                comingUp
                myEvents
            }
            .padding(16)
        }
        .refreshable { await model.load() }
        .task { await model.load() }
        // Seats fill and the two-hour window closes while the app is away.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.load() } }
        }
        .fullScreenCover(item: $model.presentedTicket) { ticket in
            EventTicketView(ticket: ticket)
        }
        .confirmationDialog(
            "Cancel your seat?",
            isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } }),
            titleVisibility: .visible,
            presenting: cancelling
        ) { event in
            Button("Cancel my seat", role: .destructive) {
                Task { await model.cancel(event) }
            }
            Button("Keep my seat", role: .cancel) {}
        } message: { _ in
            Text("Somebody else can take it. You can sign up again while there are seats left.")
        }
        // A seat taken inside the last two hours can never be given back — said before, not
        // discovered after.
        .alert(
            Text(verbatim: "Sign up for \(confirmingFinalSignUp?.title ?? "this event")?"),
            isPresented: Binding(
                get: { confirmingFinalSignUp != nil },
                set: { if !$0 { confirmingFinalSignUp = nil } }
            ),
            presenting: confirmingFinalSignUp
        ) { event in
            Button("Sign up") { Task { await model.signUp(event) } }
            Button("Not now", role: .cancel) {}
        } message: { _ in
            Text("It starts in less than two hours, so you won't be able to cancel after signing up.")
        }
    }

    /// Only when there is something to take: a "0" in the masthead reads as a scoreboard.
    private var heroTiles: [HeroTile] {
        let open = model.openForSignUp
        guard model.upcomingState == .loaded, open > 0 else { return [] }
        return [HeroTile("Open for sign-up", icon: "calendar", value: CommunityFormat.count(open, "event", "events"))]
    }

    private func requestSignUp(_ event: LearningEvent) {
        if EventRules.signUpIsFinal(event) {
            confirmingFinalSignUp = event
        } else {
            Task { await model.signUp(event) }
        }
    }

    // MARK: - Coming up

    private var comingUp: some View {
        VStack(alignment: .leading, spacing: 8) {
            CardHeading(icon: "calendar", title: "Coming up", subtitle: "Sign up while there are seats")
                .padding(.bottom, 6)
            switch model.upcomingState {
            case .loading:
                CommunitySkeletonRows(count: 2, height: 64)
            case .failed:
                // Not an empty state: "nothing on" would quietly cost the student a seat.
                CommunityErrorNotice(
                    title: "Events didn't load.",
                    message: "They'll be here as soon as the connection comes back."
                ) { await model.load() }
            case .loaded where model.upcoming.isEmpty:
                DashedEmpty(
                    title: "Nothing coming up",
                    hint: "When the learning center puts an event on, it shows up here."
                )
            case .loaded:
                VStack(spacing: 0) {
                    ForEach(Array(model.upcoming.enumerated()), id: \.element.id) { index, event in
                        if index > 0 { Divider() }
                        EventRowView(
                            event: event,
                            model: model,
                            onSignUp: { requestSignUp(event) },
                            onCancel: { cancelling = event }
                        )
                    }
                }
            }
        }
        .cardStyle(padding: 18)
    }

    // MARK: - My events

    private var myEvents: some View {
        VStack(alignment: .leading, spacing: 8) {
            CardHeading(icon: "ticket", title: "My events", subtitle: "Ones you've been to")
                .padding(.bottom, 6)
            switch model.mineState {
            case .loading:
                CommunitySkeletonRows(count: 1, height: 56)
            case .failed:
                CommunityErrorNotice(title: "Your events didn't load.", message: "Try again in a moment.") {
                    await model.load()
                }
            case .loaded where model.past.isEmpty:
                DashedEmpty(title: "Nothing yet", hint: "Events you've been to will be listed here.")
            case .loaded:
                VStack(spacing: 0) {
                    ForEach(Array(model.past.enumerated()), id: \.element.id) { index, event in
                        if index > 0 { Divider() }
                        PastEventRow(event: event)
                    }
                }
            }
        }
        .cardStyle(padding: 18)
    }
}

// MARK: - Rows

/// One upcoming event: its cover and words, when and where, then the one action it allows.
private struct EventRowView: View {
    let event: LearningEvent
    let model: EventsModel
    let onSignUp: () -> Void
    let onCancel: () -> Void

    @State private var expanded = false

    private var isBusy: Bool { model.busy.contains(event.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let cover = event.coverImageURL {
                // Fitted, never cropped: these are posters, and cropping one is how the date
                // at the bottom of it disappears.
                CommunityRemoteImage(urlString: cover, placeholderHeight: 150)
                    .frame(maxWidth: .infinity, maxHeight: 220)
                    .background(Theme.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                    .accessibilityHidden(true)
            }

            HStack(alignment: .top, spacing: 12) {
                IconTile(systemName: "calendar", size: 40)
                VStack(alignment: .leading, spacing: 5) {
                    Text(event.title)
                        .font(.system(size: 16, weight: .heavy))
                        .fixedSize(horizontal: false, vertical: true)
                    EventWhenWhere(event: event)
                }
                Spacer(minLength: 0)
            }

            if !event.description.isEmpty { description }

            actions

            if event.holdsSeat { ticket }

            // Its own line, so a sign-up refusal never hides a failed ticket, or the reverse.
            if let error = model.rowErrors[event.id] {
                Text(error)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 14)
    }

    private var description: some View {
        let isLong = event.description.count > 160
            || event.description.filter { $0 == "\n" }.count >= 3
        return VStack(alignment: .leading, spacing: 4) {
            Text(event.description)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(expanded || !isLong ? nil : 3)
                .fixedSize(horizontal: false, vertical: true)
            if isLong {
                Button(expanded ? "Show less" : "Show more") {
                    withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
                }
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.accent)
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private var actions: some View {
        switch EventRules.state(of: event) {
        case .open(let seatsLeft):
            HStack(spacing: 12) {
                Text(CommunityFormat.count(seatsLeft, "seat left", "seats left"))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer(minLength: 8)
                Button(action: onSignUp) {
                    HStack(spacing: 7) {
                        if isBusy { ProgressView().tint(.white) }
                        Text("Sign up")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isBusy)
            }
        case .signedUp(let canCancel) where canCancel:
            HStack(spacing: 12) {
                Label("You're signed up", systemImage: "ticket")
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundStyle(Theme.success)
                Spacer(minLength: 8)
                Button(action: onCancel) {
                    HStack(spacing: 7) {
                        if isBusy { ProgressView() }
                        Text("Cancel")
                    }
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(isBusy)
            }
        case .signedUp:
            Label("You're signed up · can't cancel within 2 hours", systemImage: "ticket")
                .font(.system(size: 13, weight: .heavy))
                .foregroundStyle(Theme.textSecondary)
        case .full:
            Chip(text: "Full")
        case .started:
            // The web says "Full" here even with seats left; it has simply started.
            Chip(text: "Started")
        }
    }

    /// Offered whether or not the cancel window is still open — the seat is the seat.
    private var ticket: some View {
        let loading = model.ticketLoading == event.id
        let code = event.myRegistration?.ticketCode ?? ""
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                Button {
                    Task { await model.openTicket(event) }
                } label: {
                    HStack(spacing: 7) {
                        if loading {
                            ProgressView()
                        } else {
                            Image(systemName: "ticket")
                        }
                        // Rendering takes the server a few seconds; say what the wait is for.
                        Text(loading ? "Preparing your ticket…" : "Download ticket")
                    }
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(model.ticketLoading != nil)

                if !code.isEmpty {
                    Text("Ticket \(code)")
                        .font(.system(size: 12, weight: .bold))
                        .tracking(1.5)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            if model.ticketFailed.contains(event.id) {
                Text("Couldn't download the ticket. Try again.")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.danger)
            }
        }
    }
}

/// A finished event and how it went.
private struct PastEventRow: View {
    let event: LearningEvent

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile(systemName: "calendar", size: 40)
            VStack(alignment: .leading, spacing: 5) {
                Text(event.title)
                    .font(.system(size: 15, weight: .heavy))
                    .fixedSize(horizontal: false, vertical: true)
                EventWhenWhere(event: event)
                outcome
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
    }

    @ViewBuilder private var outcome: some View {
        switch EventRules.outcome(of: event) {
        case .attended(let points) where points > 0:
            // The number comes from the award itself, never a figure written in here — and
            // it is points, which the web mislabels as XP.
            HStack(spacing: 5) {
                Image(systemName: "star.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.amber)
                Text("Attended · +\(CommunityFormat.count(points, "point", "points"))")
            }
            .font(.system(size: 12, weight: .heavy))
        case .attended:
            Text("Attended")
                .font(.system(size: 12, weight: .heavy))
        case .missed:
            outcomeText("Missed")
        case .notMarked:
            outcomeText("Not marked yet")
        case .eventCancelled:
            outcomeText("Event cancelled")
        }
    }

    private func outcomeText(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .heavy))
            .foregroundStyle(Theme.textSecondary)
    }
}

/// "Tue, Sep 25 · 15:00" and the room, each with its glyph.
private struct EventWhenWhere: View {
    let event: LearningEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let start = event.startDate {
                line(icon: "clock", text: CommunityFormat.when(start))
            }
            if !event.location.isEmpty {
                line(icon: "mappin.and.ellipse", text: event.location)
            }
        }
    }

    private func line(icon: String, text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .semibold))
                .frame(width: 14)
            Text(text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(Theme.textSecondary)
    }
}
