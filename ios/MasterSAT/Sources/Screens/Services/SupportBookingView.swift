import SwiftUI
import MasterSATKit

/// Support — book an hour with a support teacher from one of your classes. The native
/// counterpart of the site's `/support`, and the target of the support-invite notification.
///
/// The page in the site's order: the hero with the three rules as live facts, the at-the-limit
/// banner, one card per teacher (a day strip over a two-column hour grid), then the student's
/// own sessions. Every hour the student cannot take is still drawn, struck through with its
/// reason — "fully booked" and "withdrawn" are facts about the week a student plans around —
/// except the hours outside the teacher's schedule, which are the shape of the timetable and
/// are left out.
///
/// Tapping an open hour opens a confirm sheet, never a one-tap booking: a booking takes a seat
/// someone else could have had.
struct SupportBookingView: View {
    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase

    @State private var model = SupportBookingModel()
    @State private var pick: SupportPick?
    @State private var cancelling: SupportBooking?
    @State private var inviting: SupportBooking?
    @State private var rating: SupportBooking?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                hero
                if let banner = SupportSchedule.limitBanner(model.calendar.value?.allowance) {
                    limitBanner(title: banner.title, message: banner.message)
                }
                calendarSection
                sessionsSection
                    .padding(.top, 6)
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.refreshAll() }
        // Keyed on the foreground: going to the background cancels the poll, and coming back
        // restarts it with an immediate re-read of both lists — the student is about to act on
        // what the page says. Leaving the page cancels it too.
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            model.attach(session.client)
            await model.refreshAll()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { break }
                await model.refreshCalendar(quiet: true)
            }
        }
        // The invite's confirmation stays up long enough to read, then goes.
        .task(id: model.notice) {
            guard model.notice != nil else { return }
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            withAnimation { model.notice = nil }
        }
        .sheet(item: $pick) { pick in
            SupportConfirmSheet(pick: pick) { topic in
                await model.book(teacherId: pick.teacherId, startsAt: pick.hour.startsAt, topic: topic)
            }
        }
        .sheet(item: $cancelling) { booking in
            SupportCancelSheet(booking: booking) { reason in
                await model.cancel(booking, reason: reason)
            }
        }
        .sheet(item: $inviting) { booking in
            SupportAddMemberSheet(
                booking: booking,
                load: { try await model.classmates(for: booking) },
                invite: { student in await model.invite(student, to: booking) }
            )
        }
        .sheet(item: $rating) { booking in
            SupportRateSheet(booking: booking) { stars, comment in
                await model.rate(booking, stars: stars, comment: comment)
            }
        }
    }

    // MARK: - Hero

    private var hero: some View {
        let calendar = model.calendar.value
        return SupportHeroHeader(
            eyebrow: "Support",
            eyebrowIcon: "lifepreserver",
            title: "Book a support session",
            blurb: "Pick an hour with a support teacher from one of your classes — one session a day. Attending one earns you points.",
            tiles: [
                HeroTile(
                    "Open hours",
                    icon: "clock",
                    value: SupportSchedule.openHoursLabel(open: calendar?.openHour ?? 8, close: calendar?.closeHour ?? 18)
                ),
                HeroTile("You can book", icon: "calendar", value: "\(calendar?.days ?? 4) days ahead"),
                // The limit is shown before an hour is picked, not discovered after. "1 of 2
                // booked" is a plan; "you can't book that" is a wall.
                HeroTile(
                    "Your sessions",
                    icon: "calendar.badge.clock",
                    value: SupportSchedule.sessionsTile(allowance: calendar?.allowance, bookings: model.bookings.value) ?? "—"
                ),
            ]
        )
    }

    private func limitBanner(title: String, message: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Theme.warning)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 14, weight: .bold))
                Text(message)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.warningSoft)
        )
        .accessibilityElement(children: .combine)
    }

    // MARK: - Calendar

    @ViewBuilder private var calendarSection: some View {
        switch model.calendar {
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 36)
                .cardStyle()
        case .failed(let reason):
            ServicesNotice(
                title: "The calendar isn't loading right now.",
                message: "Nothing is lost — your teacher's free hours will be here once it loads.",
                detail: reason
            ) {
                await model.refreshCalendar()
            }
        case .loaded(let calendar):
            if model.calendarIsStale { staleNotice }
            if calendar.teachers.isEmpty {
                DashedEmpty(
                    title: "No support teacher on your classes yet",
                    hint: "Once your class has a support teacher, their free hours appear here for you to book."
                )
            } else {
                ForEach(calendar.teachers) { teacher in
                    SupportTeacherCard(
                        teacher: teacher,
                        selectedIndex: model.selectedIndex(for: teacher),
                        pickedStartsAt: pick?.teacherId == teacher.id ? pick?.hour.startsAt : nil,
                        onSelectDay: { model.select($0, for: teacher) },
                        onPick: { hour in
                            pick = SupportPick(teacherId: teacher.id, teacherName: teacher.name, hour: hour)
                        }
                    )
                }
            }
        }
    }

    /// A background re-read failed; the grid on screen is the last one that loaded.
    private var staleNotice: some View {
        HStack(spacing: 10) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.warning)
            Text("The calendar couldn't refresh — what you see may be out of date.")
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Button("Try again") { Task { await model.refreshCalendar() } }
                .font(.system(size: 12.5, weight: .bold))
                .foregroundStyle(Theme.accent)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.warningSoft)
        )
    }

    // MARK: - Your sessions

    private var sessionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Your sessions")
                    .font(.system(size: 20, weight: .heavy))
                    .tracking(-0.3)
                    .accessibilityAddTraits(.isHeader)
                Text("Points arrive once your teacher confirms you attended")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }

            if let notice = model.notice {
                Label {
                    Text(notice).font(.system(size: 13, weight: .semibold))
                } icon: {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.successSoft)
                )
                .transition(.opacity)
            }

            switch model.bookings {
            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 20)
                    .cardStyle()
            case .failed(let reason):
                // Not an empty state: "no sessions yet" would be a lie, and the calendar above
                // would seem to offer hours this student has already taken.
                ServicesNotice(
                    title: "Couldn't load your sessions.",
                    message: "Your bookings are safe — they'll appear once the list loads.",
                    detail: reason
                ) {
                    await model.refreshBookings()
                }
            case .loaded(let list) where list.isEmpty:
                DashedEmpty(title: "No sessions yet", hint: "Pick an hour above and it will appear here.")
            case .loaded(let list):
                VStack(spacing: 0) {
                    ForEach(Array(list.enumerated()), id: \.element.id) { index, booking in
                        if index > 0 { Divider() }
                        SupportSessionRow(
                            booking: booking,
                            onInvite: { inviting = booking },
                            onCancel: { cancelling = booking },
                            onRate: { rating = booking }
                        )
                    }
                }
                .cardStyle(padding: 16)
            }
        }
    }
}

// MARK: - Hero

/// `HeroHeader`, with its three facts laid out the way the site lays them out on a phone:
/// one per line, full width.
///
/// Not the shared two-column `HeroTileFlow`, because these values do not fit it. Measured in
/// SF Pro Heavy 17: "08:00–18:00" is 113pt, "1 of 2 booked" 114pt, "4 days ahead" 111pt, and
/// a column there leaves 109pt for the value on an iPhone 17 Pro (95pt on the smallest phones)
/// — so each would wrap onto two lines. The gradient, circles, eyebrow and type are
/// `HeroHeader`'s own, so the page still reads as one of the app's heroes.
private struct SupportHeroHeader: View {
    let eyebrow: String
    let eyebrowIcon: String
    let title: String
    let blurb: String
    let tiles: [HeroTile]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: eyebrowIcon).font(.system(size: 11, weight: .bold))
                Text(eyebrow).font(.system(size: 12, weight: .heavy))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 13)
            .padding(.vertical, 5)
            .background(Capsule().fill(.white.opacity(0.2)))

            Text(title)
                .font(.system(size: 28, weight: .heavy))
                .tracking(-0.7)
                .foregroundStyle(.white)
                .padding(.top, 14)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            Text(blurb)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.78))
                .padding(.top, 10)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 8) {
                ForEach(tiles) { tile in
                    HStack(spacing: 10) {
                        Text(tile.label.uppercased())
                            .font(.system(size: 11, weight: .heavy))
                            .tracking(0.7)
                            .foregroundStyle(.white.opacity(0.72))
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        HStack(spacing: 6) {
                            Image(systemName: tile.icon)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.8))
                            Text(tile.value)
                                .font(.system(size: 16, weight: .heavy))
                                .monospacedDigit()
                                .foregroundStyle(.white)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                        .padding(.horizontal, 11)
                        .padding(.vertical, 4)
                        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(.white.opacity(0.16)))
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.top, 20)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [Theme.accent, Theme.accentHover], startPoint: .topLeading, endPoint: .bottomTrailing)
        )
        .background(Theme.accent)
        // An overlay is hit-testable; these are decoration only.
        .overlay(alignment: .bottomTrailing) {
            Circle().fill(.white.opacity(0.06))
                .frame(width: 210, height: 210)
                .offset(x: 40, y: 60)
                .allowsHitTesting(false)
        }
        .overlay(alignment: .topTrailing) {
            Circle().fill(.white.opacity(0.05))
                .frame(width: 150, height: 150)
                .offset(x: 20, y: -70)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
    }
}

// MARK: - One teacher

/// A support teacher's next few days: who they are, a strip of days, and the chosen day's hours.
private struct SupportTeacherCard: View {
    let teacher: SupportCalendarTeacher
    let selectedIndex: Int
    let pickedStartsAt: String?
    let onSelectDay: (SupportCalendarDay) -> Void
    let onPick: (SupportHour) -> Void

    private var day: SupportCalendarDay? {
        teacher.days.indices.contains(selectedIndex) ? teacher.days[selectedIndex] : teacher.days.first
    }

    private var displayName: String { teacher.name.isEmpty ? "Your support teacher" : teacher.name }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            if !teacher.days.isEmpty { dayStrip }
            hourGrid
        }
        .cardStyle(padding: 16)
    }

    private var header: some View {
        HStack(spacing: 12) {
            ServicesAvatar(url: teacher.photoURL, name: teacher.name, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(displayName)
                    .font(.system(size: 16, weight: .heavy))
                    .tracking(-0.2)
                    .lineLimit(1)
                Text(SupportSchedule.teacherSubtitle(teacher))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            let free = day.map(SupportSchedule.openCount) ?? 0
            Chip(text: SupportSchedule.freePill(day), tone: free > 0 ? .success : .neutral)
        }
    }

    /// Scrolls rather than wraps, so the row stays one line on a phone.
    private var dayStrip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(teacher.days.enumerated()), id: \.element.id) { index, day in
                        dayButton(day, active: index == selectedIndex)
                            .id(day.id)
                    }
                }
                .padding(.vertical, 2)
            }
            .onAppear {
                // The first day with something left may be the third; bring it into view.
                if teacher.days.indices.contains(selectedIndex) {
                    proxy.scrollTo(teacher.days[selectedIndex].id, anchor: .center)
                }
            }
        }
    }

    private func dayButton(_ day: SupportCalendarDay, active: Bool) -> some View {
        let label = ServicesTime.dayLabel(day: day.date)
        let summary = SupportSchedule.summary(for: day)
        return Button {
            onSelectDay(day)
        } label: {
            VStack(alignment: .leading, spacing: 1) {
                Text(label.title)
                    .font(.system(size: 14, weight: .heavy))
                Text(label.sub)
                    .font(.system(size: 11, weight: .semibold))
                    .opacity(0.7)
                Text(summary.label)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(
                        active ? Color.white : (summary.freeCount > 0 ? Theme.success : Theme.textSecondary)
                    )
                    .padding(.top, 3)
            }
            .foregroundStyle(active ? Color.white : Color.primary)
            .frame(minWidth: 84, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(active ? Theme.accent : Theme.surface2)
            )
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
        .buttonStyle(.plain)
        // Three stacked fragments; without a label they are read as one run-on.
        .accessibilityLabel(
            "\(label.title), \(label.sub), \(summary.freeCount > 0 ? "\(summary.freeCount) hours free" : summary.label)"
        )
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    @ViewBuilder private var hourGrid: some View {
        let hours = day.map(SupportSchedule.visibleHours) ?? []
        if hours.isEmpty {
            DashedEmpty(title: "\(displayName) isn't working on this day.", hint: "Try another day above.")
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 128), spacing: 8)], spacing: 8) {
                ForEach(hours) { hour in
                    SupportHourCellView(
                        cell: SupportSchedule.cell(for: hour),
                        selected: pickedStartsAt == hour.startsAt
                    ) {
                        onPick(hour)
                    }
                }
            }
        }
    }
}

/// One hour of the grid.
private struct SupportHourCellView: View {
    let cell: SupportHourCell
    let selected: Bool
    let onPick: () -> Void

    var body: some View {
        switch cell.kind {
        case .mine:
            content(timeColour: .white, captionColour: .white.opacity(0.9), struck: false)
                .background(
                    RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Theme.accent)
                )
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(cell.accessibilityLabel)
        case .open:
            Button(action: onPick) {
                content(
                    timeColour: selected ? Theme.accent : Color.primary,
                    captionColour: selected ? Theme.accent : Theme.success,
                    struck: false
                )
                .background(
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(selected ? Theme.accentSoft : Theme.card)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .strokeBorder(selected ? Theme.accent : Theme.separator.opacity(0.7), lineWidth: selected ? 2 : 1)
                )
                .contentShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(cell.accessibilityLabel)
            .accessibilityHint(cell.hasNote ? "Your teacher left a note for this hour." : "")
        case .unavailable:
            // Faded into the card rather than boxed: still a fact about the week, but it must
            // not compete with the hours that can actually be taken.
            content(timeColour: Theme.textSecondary, captionColour: Theme.textSecondary, struck: true)
                .background(
                    RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.primary.opacity(0.04))
                )
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(cell.accessibilityLabel)
        }
    }

    private func content(timeColour: Color, captionColour: Color, struck: Bool) -> some View {
        VStack(spacing: 3) {
            Text(cell.time)
                .font(.system(size: 14, weight: struck ? .bold : .heavy))
                .monospacedDigit()
                .strikethrough(struck)
                .opacity(struck ? 0.75 : 1)
                .foregroundStyle(timeColour)
            HStack(spacing: 4) {
                if cell.isGroup {
                    Image(systemName: "person.2.fill").font(.system(size: 9, weight: .bold))
                }
                Text(cell.caption)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                if cell.hasNote {
                    Image(systemName: "info.circle").font(.system(size: 10, weight: .bold))
                }
            }
            .font(.system(size: 11, weight: struck ? .semibold : .bold))
            .foregroundStyle(captionColour)
        }
        .frame(maxWidth: .infinity, minHeight: 50)
        .padding(.horizontal, 6)
        .padding(.vertical, 7)
    }
}

// MARK: - One session

private struct SupportSessionRow: View {
    let booking: SupportBooking
    let onInvite: () -> Void
    let onCancel: () -> Void
    let onRate: () -> Void

    private var statusTone: Chip.Tone {
        switch booking.status {
        case .booked: return .info
        case .held: return .success
        case .noShow: return .warning
        case .cancelled, .unknown: return .neutral
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(booking.slot.supportTeacher.isEmpty ? "Support teacher" : booking.slot.supportTeacher)
                        .font(.system(size: 15, weight: .heavy))
                        .lineLimit(1)
                    Text(SupportSchedule.sessionLine(booking))
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                    if !booking.topic.isEmpty {
                        Text(booking.topic)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                Chip(text: SupportSchedule.statusLabel(booking), tone: statusTone)
            }

            // What the teacher says the hour covered — worth more than the tick beside it.
            if !booking.teacherNote.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "info.circle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.success)
                        .padding(.top, 1)
                    Text(booking.teacherNote)
                        .font(.system(size: 12.5, weight: .semibold))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 11)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Theme.successSoft)
                )
            }

            if let inviter = booking.invitedBy {
                Text("\(inviter) added you to this one")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }

            if booking.status == .cancelled, !booking.cancelReason.isEmpty {
                Text("Cancelled — \(booking.cancelReason)")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }

            if booking.status == .booked {
                HStack(spacing: 8) {
                    Button(action: onInvite) {
                        Label("Add a member", systemImage: "person.badge.plus")
                            .font(.system(size: 12.5, weight: .bold))
                            .foregroundStyle(Theme.accent)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(Capsule().fill(Theme.accent.opacity(0.1)))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    Button(action: onCancel) {
                        Label("Cancel", systemImage: "xmark")
                            .font(.system(size: 12.5, weight: .bold))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(Capsule().fill(Theme.surface2))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Cancel this session")
                }
                .padding(.top, 2)
            }

            // Only a session that happened can be rated — there is nothing to judge about one
            // that was cancelled, missed, or is still to come.
            if booking.status == .held {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.success)
                        .accessibilityHidden(true)
                    ratingControl
                }
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 12)
    }

    /// Already rated: the stars, tappable to change — a misclick is not permanent. Not yet: an
    /// amber invitation that looks like the thing it opens.
    @ViewBuilder private var ratingControl: some View {
        if let stars = booking.rating {
            Button(action: onRate) {
                HStack(spacing: 2) {
                    ForEach(1...5, id: \.self) { n in
                        Image(systemName: n <= stars ? "star.fill" : "star")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.amber.opacity(n <= stars ? 1 : 0.4))
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                "You rated this \(stars) out of 5 — \(SupportSchedule.ratingMeaning(stars) ?? ""). Change it."
            )
        } else {
            Button(action: onRate) {
                Label("Rate this session", systemImage: "star")
                    .font(.system(size: 12.5, weight: .bold))
                    .foregroundStyle(Theme.warning)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(Theme.amberSoft))
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
        }
    }
}
