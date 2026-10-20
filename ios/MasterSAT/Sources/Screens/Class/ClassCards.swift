import SwiftUI
import MasterSATKit

/// One class: its next lesson, a way into its Telegram group, and the live quiz running in it.
/// The card opens the full class page, which keeps the class's Classwork and Overview.
struct ClassLessonCard: View {
    let room: Classroom
    let next: ProfileLessons.Next?
    let telegram: TelegramGroupButton
    let liveQuizOn: Bool
    let onTelegram: @MainActor () -> Void

    private var tone: Color { room.isMath ? Theme.subjectMath : Theme.subjectEnglish }

    private var lessonLine: String {
        guard let next else { return ProfileClasses.scheduleLine(room) }
        let place = ClassroomSchedule.roomLabel(room.roomNumber)
        let when = next.live ? "Lesson on now" : "Next lesson · \(ProfileLessons.label(next))"
        return place.isEmpty ? when : "\(when) · \(place)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            NavigationLink(value: AppLink.classroom(id: room.id)) {
                HStack(spacing: 12) {
                    IconTile(systemName: room.isMath ? "function" : "book.closed.fill", tone: tone, size: 44)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(room.name)
                            .font(.system(size: 17, weight: .heavy, design: .rounded))
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                        Text(lessonLine)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(next?.live == true ? Theme.success : Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.textLabel)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressBounce())
            .accessibilityHint("Opens the class page")

            if liveQuizOn || telegram.title != nil {
                HStack(spacing: 10) {
                    if liveQuizOn {
                        // No join by room id exists: the join screen lists the rooms and takes the code.
                        NavigationLink(value: AppLink.liveQuiz(sessionId: nil)) {
                            Label("Join live quiz", systemImage: "dot.radiowaves.left.and.right")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(PrimaryButtonStyle(tone: Theme.warning, fullWidth: true))
                    }
                    if let title = telegram.title {
                        Button(action: onTelegram) {
                            Label(title, systemImage: "paperplane.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                    }
                }
            }
        }
        .cardStyle(padding: 16)
    }
}
