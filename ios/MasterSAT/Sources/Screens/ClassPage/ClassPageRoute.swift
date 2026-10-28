import SwiftUI
import MasterSATKit

/// "Open the class page for this subject at this level" — what a level card pushes on the Class
/// stack. A value route, declared at the Class root beside `AppLink`, so the push never drops.
struct ClassPageRoute: Hashable {
    let subject: ClassSubject
    /// The roadmap level's key, as the server names it (`junior`, `middle`, …).
    let level: String
}

/// A link to one class (`AppLink.classroom`) — a notification, a deep link, a lesson on Today. It
/// opens that class's class page when the class's subject and level are known
/// (`ClassPageTarget`), and the classroom page as before when they are not: a class with no level,
/// or `/classes/` not answering, which that page then says for itself.
///
/// Resolved in place rather than pushed again, so Back from the class page goes where the link came
/// from.
struct ClassroomLinkPage: View {
    let classroomId: Int

    @Environment(Session.self) private var session

    private enum Resolution: Equatable {
        case pending
        case classPage(ClassPageRoute)
        case classroom
    }

    @State private var resolution = Resolution.pending

    var body: some View {
        Group {
            switch resolution {
            case .pending:
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.background)
                    .accessibilityLabel("Opening your class")
            case .classPage(let route):
                ClassPageView(route: route)
            case .classroom:
                LearnMoreClassroomView(classroomId: classroomId)
            }
        }
        .task { await resolve() }
    }

    private func resolve() async {
        guard resolution == .pending else { return }
        let api = session.classrooms
        let rooms: [Classroom]
        do {
            rooms = try await api.classrooms()
        } catch where Task.isCancelled {
            // Gone before it answered; a page that comes back asks again.
            return
        } catch {
            resolution = .classroom
            return
        }
        let room = ProfileClasses.memberships(rooms).first { $0.id == classroomId }
        if let room, let key = ClassPageTarget.key(for: room) {
            resolution = .classPage(ClassPageRoute(subject: key.subject, level: key.level))
        } else {
            resolution = .classroom
        }
    }
}
