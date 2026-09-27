import SwiftUI
import MasterSATKit

/// The profile's Classes tab — the web's `ClassesTab.tsx`: one card per class the student
/// holds a seat in, with what a student comes to it to find out (when the next lesson is, who
/// teaches it, where, and a way in), then the chosen class's classmates.
///
/// The cards come from `/classes/`; the next lesson from three weeks of `/classes/my-schedule/`;
/// the classmates from `/classes/{id}/people/`. Each can fail on its own, and says so.
struct ProfileClassesTab: View {
    let model: ProfileModel
    /// The student's own id: the list is of classmates, so they are not on it.
    let selfId: Int
    let onRetry: (ProfileRetry) -> Void
    let onClassmates: (Classroom) -> Void
    let onTelegram: (Classroom, TelegramGroupButton) -> Void

    /// Where "Classmates" scrolls to.
    static let classmatesAnchor = "profile.classmates"

    var body: some View {
        if model.classes.isPending {
            VStack(spacing: 12) {
                ProfilePlaceholderRows(count: 2, height: 260)
            }
        } else if model.classes.isFailed {
            ClassroomErrorState(
                title: "Couldn't load your classes",
                message: "Something went wrong on our end. Check your connection and try again."
            ) { onRetry(.classes) }
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
                            onRetrySchedule: { onRetry(.schedule) },
                            onClassmates: { onClassmates(room) },
                            onTelegram: { button in onTelegram(room, button) }
                        )
                    }
                    ProfileClassmatesPanel(
                        room: model.selectedClass,
                        load: model.selectedClass.flatMap { model.people[$0.id] } ?? ProfileLoad(),
                        selfId: selfId,
                        onRetry: { onRetry(.people) }
                    )
                    .id(Self.classmatesAnchor)
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
    let onRetrySchedule: () -> Void
    let onClassmates: () -> Void
    let onTelegram: (TelegramGroupButton) -> Void

    private var lesson: ProfileLessons.Next? {
        schedule.value.flatMap { ProfileLessons.next(in: $0, classroomId: room.id, hours: room.lessonHours) }
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
                        .font(.system(size: 17, weight: .heavy))
                        .tracking(-0.2)
                        .lineLimit(2)
                    Text(verbatim: ProfileClasses.subjectLine(room))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
            }

            nextLesson

            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: 8) {
                    Avatar(url: room.teacherPhotoURL, name: room.teacherName ?? "?", size: 26)
                    Text(verbatim: ProfileClasses.teacherLine(room))
                        .font(.system(size: 13, weight: .semibold))
                        .lineLimit(1)
                }
                fact("clock", ProfileClasses.scheduleLine(room))
                if let place = ProfileClasses.whereLine(room) {
                    fact("mappin.and.ellipse", place)
                }
                fact("person.2", ProfileClasses.studentsLine(room))
            }

            ProfileFlowLayout(spacing: 8) {
                NavigationLink {
                    ClassroomDetailView(classroom: room)
                } label: {
                    HStack(spacing: 5) {
                        Text("Open class")
                        Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold))
                    }
                }
                .buttonStyle(AccountPillButtonStyle(kind: .solid, tone: Theme.accent))

                Button(action: onClassmates) {
                    Label("Classmates", systemImage: "person.2")
                }
                .buttonStyle(AccountPillButtonStyle(kind: .soft, tone: selected ? Theme.accent : ProfileTone.sky))
                .accessibilityAddTraits(selected ? .isSelected : [])

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
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .stroke(selected ? Theme.accent.opacity(0.45) : .clear, lineWidth: 2)
                .allowsHitTesting(false)
        )
    }

    private var nextLesson: some View {
        let tone = lesson?.live == true ? ProfileTone.emerald : ProfileTone.primary
        return HStack(spacing: 12) {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tone)
            VStack(alignment: .leading, spacing: 2) {
                ProfileEyebrow("Next lesson", tone: tone)
                Text(verbatim: lessonLine)
                    .font(.system(size: 13.5, weight: .bold))
            }
            Spacer(minLength: 8)
            if schedule.isFailed {
                Button("Try again", action: onRetrySchedule)
                    .buttonStyle(AccountPillButtonStyle(kind: .soft, tone: Theme.accent))
                    .disabled(schedule.isLoading)
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
        return lesson.map { ProfileLessons.label($0) } ?? "None scheduled yet"
    }

    private func fact(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 26)
            Text(verbatim: text)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(2)
        }
    }
}

/// The chosen class's students — up to twelve, the viewer left out, then "+N more in the
/// class", which opens the class.
private struct ProfileClassmatesPanel: View {
    let room: Classroom?
    let load: ProfileLoad<[ClassroomMember]>
    let selfId: Int
    let onRetry: () -> Void

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
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(0..<6, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(Theme.surface2)
                        .frame(height: 48)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Loading")
        } else if load.isFailed {
            ClassroomErrorState(title: "The class list didn't load.", message: "Try again in a moment.") { onRetry() }
        } else {
            let mates = ProfileClasses.classmates(load.value ?? [], selfId: selfId)
            let shown = Array(mates.prefix(ProfileClasses.classmatesShown))
            if shown.isEmpty {
                Text("No classmates in this class yet.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            } else {
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(shown) { person in
                        HStack(spacing: 10) {
                            Avatar(url: person.photoURL, name: person.name, size: 32)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(verbatim: person.name)
                                    .font(.system(size: 13, weight: .bold))
                                    .lineLimit(1)
                                if let username = person.username {
                                    Text(verbatim: "@\(username)")
                                        .font(.system(size: 11.5, weight: .medium))
                                        .foregroundStyle(Theme.textSecondary)
                                        .lineLimit(1)
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
                    NavigationLink {
                        ClassroomDetailView(classroom: room)
                    } label: {
                        Text(verbatim: "+\(mates.count - shown.count) more in the class")
                            .font(.system(size: 12.5, weight: .bold))
                            .foregroundStyle(Theme.accent)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var columns: [GridItem] {
        [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
    }
}
