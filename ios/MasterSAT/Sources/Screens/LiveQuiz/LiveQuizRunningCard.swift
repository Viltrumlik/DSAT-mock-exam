import SwiftUI
import MasterSATKit

/// A live quiz running in one of the student's classes. The web has no dashboard card for it —
/// a student reaches `/live` from the code the teacher projects — but a phone has no address
/// bar to type that into, so while a room is open in their class Home offers the way in.
/// Nothing running (or live quizzes switched off), nothing drawn.
struct LiveQuizRunningCard: View {
    var refreshID: Int = 0

    @Environment(Session.self) private var session
    @State private var running: [LiveQuizSummary] = []

    var body: some View {
        VStack(spacing: 0) {
            if let room = running.first {
                VStack(alignment: .leading, spacing: 14) {
                    CardHeading(
                        icon: "dot.radiowaves.left.and.right",
                        title: running.count == 1 ? "A live quiz is on" : "\(running.count) live quizzes are on",
                        subtitle: running.count == 1
                            ? "\(room.classroomName) · \(room.title). Join with the code on the board."
                            : "In your classes. Join with the code on the board."
                    )
                    NavigationLink(value: AppLink.liveQuiz(sessionId: nil)) { Text("Join the quiz") }
                        .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                }
                .cardStyle(padding: 18)
            } else {
                Color.clear.frame(height: 0)
            }
        }
        .task(id: refreshID) {
            // A load that was cancelled (the id moved on, the card left) is no answer, and a
            // failed one is not "nothing running": either way the banner keeps what it had.
            guard let rooms = try? await LiveQuizAPI(client: session.client).mine(), !Task.isCancelled else { return }
            let open = rooms.filter { $0.status != .finished && $0.status != .terminated }
            if open != running { running = open }
        }
    }
}
