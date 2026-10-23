import SwiftUI
import MasterSATKit

/// The profile's Classes tab — the web's `ClassesTab.tsx`: one card per class the student
/// holds a seat in, with what a student comes to it to find out (when the next lesson is, who
/// teaches it, where, and a way in), then the chosen class's classmates.
///
/// The cards come from `/classes/`; the next lesson from three weeks of `/classes/my-schedule/`,
/// read on the learning center's calendar (Tashkent) with each class's own lesson hours, as the
/// Class tab reads it; the classmates from `/classes/{id}/people/`. Each can fail on its own,
/// and says so.
struct ProfileClassesTab: View {
    let model: ProfileModel
    /// The student's own id: the list is of classmates, so they are not on it.
    let selfId: Int
    let onRetry: @MainActor (ProfileRetry) async -> Void
    let onClassmates: (Classroom) -> Void
    let onTelegram: (Classroom, TelegramGroupButton) -> Void
    /// How far above the classmates panel "Classmates" scrolls to: the pinned tabs' height, so
    /// the panel lands just under them instead of beneath them.
    var classmatesLift: CGFloat = 0

    /// Where "Classmates" scrolls to.
    static let classmatesAnchor = "profile.classmates"

    var body: some View {
        if model.classes.isPending {
            LoadingSkeleton(rows: 2, height: 260, style: .cards)
        } else if model.classes.isFailed {
            ClassroomErrorState(
                title: "Couldn't load your classes",
                message: ErrorState.nothingLost
            ) { await onRetry(.classes) }
            .cardStyle(padding: 8)
        } else if let rooms = model.memberClasses {
            if rooms.isEmpty {
                DashedEmpty(
                    title: "No classes yet",
                    hint: "When your learning center adds you to a class, it appears here with its timetable and teacher."
                )
            } else {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(rooms) { room in
                        ProfileClassCard(
                            room: room,
                            schedule: model.schedule,
                            selected: room.id == model.selectedClass?.id,
                            telegram: TelegramGroupButton.resolve(
                                state: model.groups[room.id],
                                classroomGroupURL: room.telegramGroupURL
                            ),
                            onRetrySchedule: { await onRetry(.schedule) },
                            onClassmates: { onClassmates(room) },
                            onTelegram: { button in onTelegram(room, button) }
                        )
                    }
                    ProfileClassmatesPanel(
                        room: model.selectedClass,
                        load: model.selectedClass.flatMap { model.people[$0.id] } ?? ProfileLoad(),
                        selfId: selfId,
                        onRetry: { await onRetry(.people) }
                    )
                    // The anchor sits `classmatesLift` above the panel: laid out there, not
                    // drawn there, so the scroll lands the panel's top under the pinned tabs.
                    .overlay(alignment: .top) {
                        Color.clear
                            .frame(height: 0)
                            .alignmentGuide(.top) { $0[.top] + classmatesLift }
                            .id(Self.classmatesAnchor)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
            }
        }
    }
}

/// One class: its name and level, the next lesson (the one thing on the card that changes by
/// itself, so it gets the colour), the teacher, the days and time, the room and branch, the
/// head-count of students — `student_count`, never the whole membership — and the ways in.
private struct ProfileClassCard: View {
    let room: Classroom
    let schedule: ProfileLoad<[ScheduleEvent]>
    let selected: Bool
    let telegram: TelegramGroupButton
    let onRetrySchedule: @MainActor () async -> Void
    let onClassmates: () -> Void
    let onTelegram: (TelegramGroupButton) -> Void

    private var lesson: ProfileLessons.Next? {
        schedule.value.flatMap {
            ProfileLessons.next(in: $0, classroomId: room.id, hours: room.lessonHours, calendar: ServicesTime.calendar)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                IconTile(
                    systemName: room.isMath ? "function" : "book.closed.fill",
                    tone: room.isMath ? ProfileTone.sky : ProfileTone.emerald
                )
                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: room.name)
                        .appFont(17, weight: .heavy)
                        .tracking(-0.2)
                        .titleLineLimit(2)
                        .accessibilityAddTraits(.isHeader)
                    Text(verbatim: ProfileClasses.subjectLine(room))
                        .appFont(13, weight: .medium)
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
            }

            nextLesson

            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: 8) {
                    // The line beside it names the teacher.
                    Avatar(url: room.teacherPhotoURL, name: room.teacherName ?? "?", size: 26)
                        .accessibilityHidden(true)
                    Text(verbatim: ProfileClasses.teacherLine(room))
                        .appFont(13, weight: .semibold)
                        .titleLineLimit(1)
                }
                fact("clock", ProfileClasses.scheduleLine(room))
                if let place = ProfileClasses.whereLine(room) {
                    fact("mappin.and.ellipse", place)
                }
                fact("person.2", ProfileClasses.studentsLine(room))
            }

            ProfileFlowLayout(spacing: 8) {
                NavigationLink(value: ProfileView.Route.classroom(id: room.id)) {
                    HStack(spacing: 5) {
                        Text("Open class")
                        Image(systemName: "arrow.right").appFont(11, weight: .bold)
                            .accessibilityHidden(true)
                    }
                }
                .buttonStyle(AccountPillButtonStyle(kind: .solid, tone: Theme.accent))

                Button(action: onClassmates) {
                    Label("Classmates", systemImage: "person.2")
                }
                .buttonStyle(AccountPillButtonStyle(kind: .soft, tone: selected ? Theme.accent : ProfileTone.sky))
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityHint("Shows this class's classmates below")

                // A bot-managed group opens the join sheet — a forwarded static link into one
                // would only get the student removed at the door; an unmanaged class keeps its
                // plain link; a class with neither has no button.
                if telegram != .none {
                    Button {
                        onTelegram(telegram)
                    } label: {
                        Label("Telegram group", systemImage: "paperplane")
                    }
                    .buttonStyle(AccountPillButtonStyle(kind: .quiet, tone: Theme.accent))
                }
            }
        }
        .cardStyle(padding: 18)
        // The class whose classmates are shown below. A selection ring, not an edge.
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .stroke(selected ? Theme.accent.opacity(0.45) : .clear, lineWidth: 2)
                .allowsHitTesting(false)
        )
        .accessibilityElement(children: .contain)
    }

    /// The well's words and its retry; at the accessibility sizes the retry drops under them.
    private var nextLesson: some View {
        let tone = lesson?.isOnNow == true ? ProfileTone.emerald : ProfileTone.primary
        return AdaptiveStack(spacing: 12, columnSpacing: 8) {
            HStack(spacing: 12) {
                Image(systemName: "calendar.badge.clock")
                    .appFont(17, weight: .semibold)
                    .foregroundStyle(tone)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    ProfileEyebrow("Next lesson", tone: tone)
                    Text(verbatim: lessonLine)
                        .appFont(13.5, weight: .bold)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            }
            AdaptiveSpacer()
            if schedule.isFailed {
                Button("Try again") { Task { await onRetrySchedule() } }
                    .buttonStyle(AccountPillButtonStyle(kind: .soft, tone: Theme.accent))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .profileWell(tone, radius: 11, opacity: 0.08)
    }

    private var lessonLine: String {
        if schedule.isPending { return "Checking the timetable…" }
        if schedule.isFailed { return "The timetable didn't load" }
        return lesson.map { ProfileLessons.label($0, calendar: ServicesTime.calendar) } ?? "None scheduled yet"
    }

    private func fact(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .appFont(13, weight: .semibold)
                .foregroundStyle(Theme.textSecondary)
                // In a 26-pt column, beside the teacher's photo: it stops growing where it fits.
                .capDynamicType()
                .frame(width: 26)
                .accessibilityHidden(true)
            Text(verbatim: text)
                .appFont(13, weight: .medium)
                .foregroundStyle(Theme.textSecondary)
                .titleLineLimit(2)
        }
    }
}

/// The chosen class's students — up to twelve, the viewer left out, then "+N more in the
/// class", which opens the class.
private struct ProfileClassmatesPanel: View {
    let room: Classroom?
    let load: ProfileLoad<[ClassroomMember]>
    let selfId: Int
    let onRetry: @MainActor () async -> Void

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        ProfilePanel(
            icon: "person.2.fill",
            tone: ProfileTone.sky,
            title: "Classmates",
            description: room?.name ?? "Choose a class to see who's in it."
        ) {
            if let room {
                content(room)
            }
        }
    }

    @ViewBuilder private func content(_ room: Classroom) -> some View {
        if load.isPending {
            LoadingSkeleton(rows: 3, height: 48)
        } else if load.isFailed {
            ClassroomErrorState(title: "The class list didn't load.", message: "Try again in a moment.", retry: onRetry)
        } else {
            let mates = ProfileClasses.classmates(load.value ?? [], selfId: selfId)
            let shown = Array(mates.prefix(ProfileClasses.classmatesShown))
            if shown.isEmpty {
                DashedEmpty(title: "No classmates in this class yet.")
            } else {
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(shown) { person in
                        HStack(spacing: 10) {
                            Avatar(url: person.photoURL, name: person.name, size: 32)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(verbatim: person.name)
                                    .appFont(13, weight: .bold)
                                    .titleLineLimit(1)
                                if let username = person.username {
                                    Text(verbatim: "@\(username)")
                                        .appFont(11.5, weight: .medium)
                                        .foregroundStyle(Theme.textSecondary)
                                        .titleLineLimit(1)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .profileWell(ProfileTone.sky, radius: 11, opacity: 0.08)
                        .accessibilityElement(children: .combine)
                    }
                }
                if mates.count > shown.count {
                    NavigationLink(value: ProfileView.Route.classroom(id: room.id)) {
                        Text(verbatim: "+\(mates.count - shown.count) more in the class")
                            .appFont(12.5, weight: .bold)
                            .foregroundStyle(Theme.accent)
                            .hitTarget(44)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// Two to a row; one at the accessibility sizes, where half a panel holds no name.
    private var columns: [GridItem] {
        let one = GridItem(.flexible(), spacing: 8)
        return typeSize.isAccessibilitySize ? [one] : [one, one]
    }
}
