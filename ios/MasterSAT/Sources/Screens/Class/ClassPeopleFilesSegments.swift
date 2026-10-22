import SwiftUI
import MasterSATKit

/// What a segment's load depends on: which classes, and which pull-to-refresh.
private struct SegmentLoad: Hashable {
    let ids: [Int]
    let refreshID: Int
}

/// A class's name over its part of a segment — shown only when there is more than one class.
struct ClassGroupHeading: View {
    let room: Classroom

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(room.isMath ? Theme.subjectMath : Theme.subjectEnglish)
                .frame(width: 9, height: 9)
            Text(room.name)
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .textCase(.uppercase)
                .tracking(0.8)
                .foregroundStyle(Theme.textSecondary)
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// The class board and the people in it, for each class under the chip. Under All, one group
/// per class — a student has one to three, so the list stays short.
struct ClassPeopleSegment: View {
    let classes: [Classroom]
    let model: ClassSectionsModel
    let refreshID: Int

    @Environment(Session.self) private var session

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            // What the rankings are made of is said once, above the groups, not under each class.
            if classes.count > 1 { ClassroomRankingsExplainer(forEachClass: true) }
            ForEach(classes) { room in
                VStack(alignment: .leading, spacing: 14) {
                    if classes.count > 1 { ClassGroupHeading(room: room) }
                    ClassroomRankingsSection(
                        load: model.board(room.id),
                        isStudent: room.isStudent,
                        showsExplainer: classes.count == 1
                    ) {
                        await model.load(.board, room.id, api: session.classrooms, force: true)
                    }
                    ClassroomPeopleSection(load: model.members(room.id)) {
                        await model.load(.members, room.id, api: session.classrooms, force: true)
                    }
                }
            }
        }
        .task(id: SegmentLoad(ids: classes.map(\.id), refreshID: refreshID)) {
            await model.loadPeople(for: classes.map(\.id), api: session.classrooms, refreshID: refreshID)
        }
    }
}

/// The files each class's teacher shared, grouped by class the same way.
struct ClassFilesSegment: View {
    let classes: [Classroom]
    let model: ClassSectionsModel
    let refreshID: Int

    @Environment(Session.self) private var session

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            ForEach(classes) { room in
                VStack(alignment: .leading, spacing: 14) {
                    if classes.count > 1 { ClassGroupHeading(room: room) }
                    ClassroomMaterialsSection(load: model.files(room.id)) {
                        await model.load(.files, room.id, api: session.classrooms, force: true)
                    }
                }
            }
        }
        .task(id: SegmentLoad(ids: classes.map(\.id), refreshID: refreshID)) {
            await model.loadFiles(for: classes.map(\.id), api: session.classrooms, refreshID: refreshID)
        }
    }
}
