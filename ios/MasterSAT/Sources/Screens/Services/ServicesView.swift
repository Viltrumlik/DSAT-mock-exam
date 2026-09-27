import SwiftUI
import MasterSATKit

/// Services — what the learning center does for a student that is not a lesson. The native
/// counterpart of the site's `/services`.
///
/// Three cards, and deliberately not the same kind of thing: support opens its calendar, the
/// SAT card opens a checklist that ends by handing the student to a person, and college
/// admission is not built yet and says so plainly — it is the one card that is not a button,
/// because a card that looks tappable and does nothing teaches students the app is unreliable.
///
/// Each service wears its own colour, as on the site: support emerald, registration blue,
/// admission violet. The two that open something show what they open onto — the student's
/// next support hour, and the soonest SAT date on offer.
struct ServicesView: View {
    @Environment(Session.self) private var session

    @State private var bookings: ServicesLoadState<[SupportBooking]> = .loading
    @State private var examDates: ServicesLoadState<[ExamDateOption]> = .loading
    @State private var showingChecklist = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                NavigationLink {
                    SupportBookingView()
                } label: {
                    ServiceCard(
                        tone: Theme.success,
                        icon: "lifepreserver",
                        title: "Support booking",
                        description: "Book an hour with a support teacher, or bring a classmate into one you already have."
                    ) {
                        supportFact
                    } action: {
                        ServiceAction(title: "Open the calendar", tone: Theme.success)
                    }
                }
                .buttonStyle(.plain)

                Button {
                    showingChecklist = true
                } label: {
                    ServiceCard(
                        tone: Theme.accent,
                        icon: "pencil.line",
                        title: "Register for the SAT",
                        description: "What you need ready before you register, and the registrar who finishes it with you."
                    ) {
                        registerFact
                    } action: {
                        ServiceAction(title: "See what you need", tone: Theme.accent)
                    }
                }
                .buttonStyle(.plain)

                ServiceCard(
                    tone: Theme.subjectEnglish,
                    icon: "graduationcap",
                    title: "College admission",
                    description: "Help with applications, essays and deadlines. We're building this now."
                ) {
                    EmptyView()
                } action: {
                    ServicesTonePill(text: "Coming soon", icon: "hourglass", tone: Theme.subjectEnglish)
                }
                .accessibilityElement(children: .combine)
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        // Runs again whenever the page comes back into view — coming back from the calendar
        // with a new booking is exactly when "Your next hour" has changed.
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showingChecklist) {
            SatChecklistSheet(dates: examDates) { await loadExamDates() }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            PageTitle("Services")
            Text("Booking a teacher, registering for the exam, and getting into university.")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, 4)
    }

    // MARK: - Facts

    /// "Nothing booked yet" is only said once the bookings have actually loaded; a failed
    /// request says it failed, and makes no claim either way.
    @ViewBuilder private var supportFact: some View {
        switch bookings {
        case .loading:
            ServiceFact(tone: Theme.success, icon: "calendar.badge.clock", label: "Your next hour", value: "Tomorrow, 15:00")
                .redacted(reason: .placeholder)
        case .failed:
            ServiceFact(
                tone: Theme.warning,
                icon: "exclamationmark.triangle",
                label: "Your next hour",
                value: "Couldn't check your bookings",
                sub: "Pull down to try again."
            )
        case .loaded(let list):
            if let next = SupportSchedule.nextHourSummary(in: list) {
                ServiceFact(
                    tone: Theme.success,
                    icon: "calendar.badge.clock",
                    label: "Your next hour",
                    value: next.when,
                    sub: next.teacher.isEmpty ? nil : "with \(next.teacher)"
                )
            } else {
                ServiceFact(tone: Theme.success, icon: "calendar.badge.clock", label: "Your next hour", value: "Nothing booked yet")
            }
        }
    }

    /// A missing date list is not "none on offer" — the two send a student to different places.
    @ViewBuilder private var registerFact: some View {
        switch examDates {
        case .loading:
            ServiceFact(tone: Theme.accent, icon: "calendar", label: "Next test date", value: "October 3")
                .redacted(reason: .placeholder)
        case .failed:
            ServiceFact(
                tone: Theme.warning,
                icon: "exclamationmark.triangle",
                label: "Next test date",
                value: "Couldn't load the dates",
                sub: "Pull down to try again."
            )
        case .loaded(let dates):
            ServiceFact(
                tone: Theme.accent,
                icon: "calendar",
                label: "Next test date",
                value: ServicesExamDates.earliest(dates).map { ServicesExamDates.label(for: $0) } ?? "None open just now"
            )
        }
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        async let sessions: Void = loadBookings()
        async let dates: Void = loadExamDates()
        _ = await (sessions, dates)
    }

    @MainActor
    private func loadBookings() async {
        do {
            bookings = .loaded(try await SupportAPI(client: session.client).bookings())
        } catch {
            // A refresh that fails keeps what the page already knew; only a first load turns
            // into the failure line. A cancelled request (the page left) says nothing at all.
            guard !Task.isCancelled, bookings.value == nil else { return }
            bookings = .failed(ServicesError.message(error))
        }
    }

    @MainActor
    private func loadExamDates() async {
        // A retry from the checklist shows itself working rather than sitting on the error.
        if examDates.isFailed { examDates = .loading }
        do {
            examDates = .loaded(try await session.student.examDates())
        } catch {
            guard !Task.isCancelled, examDates.value == nil else { return }
            examDates = .failed(ServicesError.message(error))
        }
    }
}

// MARK: - Card anatomy

/// One service: its colour on the top edge and the icon tile, the title, a line on what it
/// is for, one live fact, and what it opens.
private struct ServiceCard<Fact: View, Action: View>: View {
    let tone: Color
    let icon: String
    let title: String
    let description: String
    @ViewBuilder var fact: () -> Fact
    @ViewBuilder var action: () -> Action

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            IconTile(systemName: icon, tone: tone, size: 46)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 17, weight: .heavy))
                    .tracking(-0.2)
                    .foregroundStyle(Color.primary)
                Text(description)
                    .font(.system(size: 13.5, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            fact()
            action()
        }
        .cardStyle(padding: 18)
        // The accent edge — what tells the three apart at a glance. Clipped to the card's own
        // corners; an overlay is hit-testable, so it is taken out of hit testing.
        .overlay {
            VStack(spacing: 0) {
                LinearGradient(
                    colors: [tone, tone.opacity(0.4), tone.opacity(0)],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .frame(height: 4)
                Spacer(minLength: 0)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .allowsHitTesting(false)
        }
        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
    }
}

/// One fact about the service, in a well of the card's own tint.
private struct ServiceFact: View {
    let tone: Color
    let icon: String
    let label: String
    let value: String
    var sub: String?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tone)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(label.uppercased())
                    .font(.system(size: 10.5, weight: .heavy))
                    .tracking(0.9)
                    .foregroundStyle(tone)
                Text(value)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color.primary)
                    .fixedSize(horizontal: false, vertical: true)
                if let sub {
                    Text(sub)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(tone.opacity(0.09))
        )
    }
}

/// What the card opens, as the site's tinted pill. The whole card takes the tap; the pill says
/// where it goes.
private struct ServiceAction: View {
    let title: String
    let tone: Color

    var body: some View {
        HStack(spacing: 6) {
            Text(title).font(.system(size: 13.5, weight: .bold))
            Image(systemName: "arrow.right").font(.system(size: 12, weight: .bold))
        }
        .foregroundStyle(tone)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Capsule().fill(tone.opacity(0.13)))
    }
}
