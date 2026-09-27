import SwiftUI
import MasterSATKit

// The four sheets the support page opens. Each one owns its own in-flight state, keeps its
// buttons on screen above the keyboard, cannot be swiped away mid-request, and shows the
// server's sentence when it is refused. None of them ever sends twice on its own.

// MARK: - Confirm a booking

/// The site's confirm panel: the hour, the teacher's note, an optional topic, then Confirm.
struct SupportConfirmSheet: View {
    let pick: SupportPick
    /// Books the hour. Nil when it worked, else the sentence to show.
    let confirm: @MainActor (String) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var topic = ""
    @State private var error: String?
    @State private var inFlight = false
    @State private var detent: PresentationDetent = .medium
    @FocusState private var topicFocused: Bool

    private var note: String { pick.hour.note.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top, spacing: 12) {
                    IconTile(systemName: "calendar.badge.plus", tone: Theme.accent)
                    VStack(alignment: .leading, spacing: 3) {
                        // Named off the picked hour itself, never off whichever day is on screen.
                        Text(SupportSchedule.confirmTitle(startsAt: pick.hour.startsAt, teacher: pick.teacherName))
                            .font(.system(size: 17, weight: .heavy))
                            .fixedSize(horizontal: false, vertical: true)
                        if pick.hour.capacity > 1 {
                            Label("\(pick.hour.seatsLeft) left", systemImage: "person.2.fill")
                                .font(.system(size: 12.5, weight: .bold))
                                .foregroundStyle(Theme.success)
                        }
                    }
                    Spacer(minLength: 0)
                }

                // The teacher's note for this hour. It is addressed to the student — "bring
                // your Module 2 answer sheet" is no use only to the person who wrote it.
                if !note.isEmpty {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "info.circle.fill")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.info)
                            .padding(.top, 1)
                        Text(note)
                            .font(.system(size: 13.5, weight: .semibold))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.infoSoft)
                    )
                }

                VStack(alignment: .leading, spacing: 7) {
                    Text("What do you need help with?")
                        .font(.system(size: 14, weight: .bold))
                    TextField(
                        "",
                        text: $topic,
                        prompt: Text(verbatim: "e.g. Reading inference questions"),
                        axis: .vertical
                    )
                    .lineLimit(1...3)
                    .focused($topicFocused)
                    .supportFieldStyle(focused: topicFocused)
                    .onChange(of: topic) { _, value in
                        if value.count > SupportSchedule.topicLimit {
                            topic = String(value.prefix(SupportSchedule.topicLimit))
                        }
                    }
                    Text("Optional — it helps your teacher prepare.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }

                if let error { SupportSheetError(message: error) }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            ServicesSheetButtons(
                secondaryTitle: "Cancel",
                primaryTitle: "Confirm booking",
                primaryEnabled: true,
                inFlight: inFlight,
                secondary: { dismiss() },
                primary: { Task { await submit() } }
            )
        }
        .background(Theme.background)
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(inFlight)
        .onChange(of: topicFocused) { _, focused in
            if focused { detent = .large }
        }
    }

    private func submit() async {
        guard !inFlight else { return }
        inFlight = true
        error = nil
        topicFocused = false
        let refusal = await confirm(topic)
        inFlight = false
        if let refusal {
            // The page behind is re-reading the calendar; the hour may turn "full" under the sheet.
            error = refusal
        } else {
            dismiss()
        }
    }
}

// MARK: - Cancel a session

/// Cancelling asks why, and the answer goes to the support teacher, who held the hour.
/// Most reasons are one tap; "Something else" always opens the box.
struct SupportCancelSheet: View {
    let booking: SupportBooking
    let submit: @MainActor (String) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var picked: String?
    @State private var detail = ""
    @State private var error: String?
    @State private var inFlight = false
    @State private var detent: PresentationDetent = .medium
    @FocusState private var detailFocused: Bool

    private var reason: String? { SupportSchedule.cancelReason(picked: picked, detail: detail) }
    private var teacher: String {
        booking.slot.supportTeacher.isEmpty ? "your support teacher" : booking.slot.supportTeacher
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Cancel this session?")
                        .font(.system(size: 20, weight: .heavy))
                        .tracking(-0.3)
                    Text("\(ServicesTime.sessionWhen(booking.slot.startsAt)) with \(teacher). Let them know why so they can offer the hour to someone else.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ServicesFlowLayout(spacing: 8, lineSpacing: 8) {
                    ForEach(SupportSchedule.cancelPresets + [SupportSchedule.cancelOther], id: \.self) { option in
                        let chosen = picked == option
                        Button {
                            picked = option
                            if option == SupportSchedule.cancelOther { detailFocused = true }
                        } label: {
                            Text(option)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(chosen ? Color.white : Color.primary)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(Capsule().fill(chosen ? Theme.accent : Theme.surface2))
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(chosen ? .isSelected : [])
                    }
                }

                if picked == SupportSchedule.cancelOther {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("Tell them what happened")
                            .font(.system(size: 14, weight: .bold))
                        TextField("", text: $detail, prompt: Text(verbatim: "A short line is plenty"), axis: .vertical)
                            .lineLimit(1...4)
                            .focused($detailFocused)
                            .supportFieldStyle(focused: detailFocused)
                            .onChange(of: detail) { _, value in
                                if value.count > SupportSchedule.cancelReasonLimit {
                                    detail = String(value.prefix(SupportSchedule.cancelReasonLimit))
                                }
                            }
                    }
                }

                if let error { SupportSheetError(message: error) }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            ServicesSheetButtons(
                secondaryTitle: "Keep it",
                primaryTitle: "Cancel session",
                primaryTone: Theme.danger,
                primaryEnabled: reason != nil,
                inFlight: inFlight,
                secondary: { dismiss() },
                primary: { Task { await send() } }
            )
        }
        .background(Theme.background)
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(inFlight)
        .onChange(of: detailFocused) { _, focused in
            if focused { detent = .large }
        }
    }

    private func send() async {
        guard !inFlight, let reason else { return }
        inFlight = true
        error = nil
        detailFocused = false
        let refusal = await submit(reason)
        inFlight = false
        if let refusal { error = refusal } else { dismiss() }
    }
}

// MARK: - Add a member

/// Add a classmate to a session you booked. The list is the server's answer to "who can go
/// in this seat?" — so the picker can never offer a name the invite would refuse — and the
/// sheet says, before the button, that the classmate will be told.
struct SupportAddMemberSheet: View {
    let booking: SupportBooking
    let load: @MainActor () async throws -> [SupportClassmate]
    let invite: @MainActor (SupportClassmate) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var classmates: ServicesLoadState<[SupportClassmate]> = .loading
    @State private var picked: SupportClassmate?
    @State private var error: String?
    @State private var inFlight = false

    private var teacher: String {
        booking.slot.supportTeacher.isEmpty ? "your support teacher" : booking.slot.supportTeacher
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Add someone to this session")
                    .font(.system(size: 20, weight: .heavy))
                    .tracking(-0.3)
                Text("\(ServicesTime.sessionWhen(booking.slot.startsAt)) with \(teacher). Whoever you pick gets their own seat, and we'll tell them — in the app and by email.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("You'll both earn more points for the session than either of you would sitting it alone.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let error { SupportSheetError(message: error) }

                // Four branches: a failed list must not read as "you have no classmates" —
                // that would send a student to a teacher about a problem that does not exist.
                switch classmates {
                case .loading:
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                case .failed(let reason):
                    VStack(alignment: .leading, spacing: 8) {
                        SupportSheetError(message: "Couldn't load your classmates.")
                        Text(reason)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Theme.textLabel)
                        Button("Try again") { Task { await loadClassmates() } }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                case .loaded(let list) where list.isEmpty:
                    Text("There's nobody left to add — everyone in your class who could join this session is already in it.")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 4)
                case .loaded(let list):
                    VStack(spacing: 6) {
                        ForEach(list) { student in
                            classmateRow(student)
                        }
                    }
                }
            }
            .padding(20)
        }
        .safeAreaInset(edge: .bottom) {
            ServicesSheetButtons(
                secondaryTitle: "Cancel",
                primaryTitle: "Add them",
                primaryEnabled: picked != nil,
                inFlight: inFlight,
                secondary: { dismiss() },
                primary: { Task { await send() } }
            )
        }
        .background(Theme.background)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(inFlight)
        .task { await loadClassmates() }
    }

    private func classmateRow(_ student: SupportClassmate) -> some View {
        let chosen = picked?.id == student.id
        return Button {
            picked = student
        } label: {
            HStack(spacing: 12) {
                ServicesAvatar(url: nil, name: student.name, size: 30)
                Text(student.name.isEmpty ? "Classmate" : student.name)
                    .font(.system(size: 14.5, weight: .bold))
                    .foregroundStyle(chosen ? Theme.accent : Color.primary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if chosen {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.accent)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(chosen ? Theme.accentSoft : Theme.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .strokeBorder(chosen ? Theme.accent : Theme.separator.opacity(0.5), lineWidth: chosen ? 2 : 0.5)
            )
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }

    private func loadClassmates() async {
        classmates = .loading
        do {
            let list = try await load()
            classmates = .loaded(list)
            if let chosen = picked, !list.contains(where: { $0.id == chosen.id }) { picked = nil }
        } catch {
            guard !Task.isCancelled else { return }
            classmates = .failed(ServicesError.message(error))
        }
    }

    private func send() async {
        guard !inFlight, let picked else { return }
        inFlight = true
        error = nil
        let refusal = await invite(picked)
        inFlight = false
        if let refusal {
            error = refusal
            // The refusal usually means the list moved ("… is already in this session").
            await loadClassmates()
        } else {
            dismiss()
        }
    }
}

// MARK: - Rate a session

/// The student's verdict on an hour their teacher marked attended. It rates the HOUR, not the
/// student, and it never touches points — settling as attended is what pays, whatever the
/// stars say. Already rated? It opens on the old answer, and sending again overwrites it.
struct SupportRateSheet: View {
    let booking: SupportBooking
    let submit: @MainActor (Int, String) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var stars: Int?
    @State private var comment: String
    @State private var error: String?
    @State private var inFlight = false
    @State private var detent: PresentationDetent = .medium
    @FocusState private var commentFocused: Bool

    init(booking: SupportBooking, submit: @escaping @MainActor (Int, String) async -> String?) {
        self.booking = booking
        self.submit = submit
        _stars = State(initialValue: booking.rating)
        _comment = State(initialValue: booking.ratingComment)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Rate this session")
                        .font(.system(size: 20, weight: .heavy))
                        .tracking(-0.3)
                    Text(SupportSchedule.sessionLine(booking) + (booking.slot.supportTeacher.isEmpty ? "" : " · \(booking.slot.supportTeacher)"))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("How was this session?")
                        .font(.system(size: 14, weight: .bold))
                    HStack(spacing: 6) {
                        ForEach(1...5, id: \.self) { n in
                            Button {
                                stars = n
                            } label: {
                                Image(systemName: n <= (stars ?? 0) ? "star.fill" : "star")
                                    .font(.system(size: 30))
                                    .foregroundStyle(Theme.amber.opacity(n <= (stars ?? 0) ? 1 : 0.45))
                                    .frame(width: 44, height: 44)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(n) out of 5 — \(SupportSchedule.ratingMeaning(n) ?? "")")
                            .accessibilityAddTraits(stars == n ? .isSelected : [])
                        }
                    }
                    // Five unlabelled stars are a Rorschach test; each one says what it means.
                    Text(stars.flatMap(SupportSchedule.ratingMeaning) ?? "Pick a star")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityHidden(true)
                }

                TextField(
                    "",
                    text: $comment,
                    prompt: Text(verbatim: "Anything you'd like your teacher to know (optional)"),
                    axis: .vertical
                )
                .lineLimit(2...5)
                .focused($commentFocused)
                .supportFieldStyle(focused: commentFocused)
                .onChange(of: comment) { _, value in
                    if value.count > SupportSchedule.ratingCommentLimit {
                        comment = String(value.prefix(SupportSchedule.ratingCommentLimit))
                    }
                }

                if let error { SupportSheetError(message: error) }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            ServicesSheetButtons(
                secondaryTitle: "Not now",
                primaryTitle: "Send",
                primaryEnabled: stars != nil,
                inFlight: inFlight,
                secondary: { dismiss() },
                primary: { Task { await send() } }
            )
        }
        .background(Theme.background)
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(inFlight)
        .onChange(of: commentFocused) { _, focused in
            if focused { detent = .large }
        }
    }

    private func send() async {
        guard !inFlight, let stars else { return }
        inFlight = true
        error = nil
        commentFocused = false
        let refusal = await submit(stars, comment)
        inFlight = false
        if let refusal { error = refusal } else { dismiss() }
    }
}

// MARK: - Pieces

/// A refusal or failure, in the server's words.
private struct SupportSheetError: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 14))
                .foregroundStyle(Theme.danger)
                .padding(.top, 1)
            Text(message)
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(Theme.danger)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.dangerSoft)
        )
        .accessibilityElement(children: .combine)
    }
}

private extension View {
    /// The site's input: a white field with a hairline that turns blue while typing.
    func supportFieldStyle(focused: Bool) -> some View {
        self
            .font(.system(size: 15))
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(focused ? Theme.accent : Theme.separator.opacity(0.7), lineWidth: focused ? 1.5 : 0.5)
            )
    }
}
