import SwiftUI
import MasterSATKit

/// The classes a student belongs to, and the box for joining another.
struct ClassesListView: View {
    @Environment(Session.self) private var session
    @State private var classrooms: [Classroom] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var joinCode = ""
    @State private var isJoining = false
    @State private var joinError: String?
    @State private var joinedName: String?

    var body: some View {
        Group {
            if isLoading && classrooms.isEmpty {
                ProgressView()
            } else if let loadError, classrooms.isEmpty {
                RetryNotice(message: loadError) { await load() }
            } else {
                list
            }
        }
        .navigationTitle("Classroom")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if classrooms.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "person.3")
                            .font(.system(size: 30)).foregroundStyle(Theme.textLabel)
                        Text("You are not in a class yet").font(.system(size: 16, weight: .bold))
                        Text("Ask your teacher for the join code.")
                            .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                    .cardStyle()
                } else {
                    VStack(spacing: 10) {
                        ForEach(classrooms) { room in
                            NavigationLink {
                                ClassroomDetailView(classroom: room)
                            } label: {
                                ClassroomRow(classroom: room)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    Overline("Join a class")
                    HStack(spacing: 10) {
                        TextField("Join code", text: $joinCode)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .font(.system(size: 15, weight: .semibold))
                            .padding(12)
                            .background(
                                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                                    .fill(Theme.card)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                                    .stroke(Theme.separator, lineWidth: 1)
                            )
                            .submitLabel(.join)
                            .onSubmit { join() }
                        Button(action: join) {
                            if isJoining { ProgressView().tint(.white) } else { Text("Join") }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(joinCode.trimmingCharacters(in: .whitespaces).isEmpty || isJoining)
                    }
                    if let joinError {
                        Text(joinError).font(.system(size: 12)).foregroundStyle(Theme.danger)
                    } else if let joinedName {
                        Text("You joined \(joinedName).")
                            .font(.system(size: 12)).foregroundStyle(Theme.success)
                    } else {
                        // The code is the only way back into a class you were removed from,
                        // so it is worth saying where it comes from.
                        Text("Your teacher can give you the code for the class.")
                            .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .padding(16)
        }
        .background(Theme.background)
        .refreshable { await load() }
    }

    @MainActor
    private func join() {
        isJoining = true
        joinError = nil
        joinedName = nil
        Task {
            defer { isJoining = false }
            do {
                let room = try await session.classrooms.join(code: joinCode)
                joinedName = room.name
                joinCode = ""
                await load()
            } catch let error as APIError {
                joinError = error.errorDescription
            } catch {
                joinError = error.localizedDescription
            }
        }
    }

    @MainActor
    private func load() async {
        isLoading = classrooms.isEmpty
        loadError = nil
        do {
            classrooms = try await session.classrooms.classrooms()
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

struct ClassroomRow: View {
    let classroom: Classroom

    var body: some View {
        HStack(spacing: 13) {
            Avatar(url: classroom.teacherPhotoURL, name: classroom.teacherName ?? classroom.name, size: 44)
            VStack(alignment: .leading, spacing: 4) {
                Text(classroom.name)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    if let subject = classroom.subject, !subject.isEmpty {
                        Text(subject.humanisedSubject)
                            .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                    if let teacher = classroom.teacherName, !teacher.isEmpty {
                        Text("· \(teacher)")
                            .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                    }
                }
                if let schedule = classroom.scheduleSummary, !schedule.isEmpty {
                    Label(schedule, systemImage: "calendar")
                        .font(.system(size: 11)).foregroundStyle(Theme.textLabel)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textLabel)
        }
        .cardStyle(padding: 14)
    }
}

/// One classroom: where the student stands, what has been set, who else is in it, and
/// what the teacher has shared.
///
/// The four tabs mirror what a student can see on the web workspace — Overview (which
/// hosts the rankings), Assignments, Materials, People. The staff-only tabs (Lessons,
/// Results, Grading, Settings) are not here, because a student cannot open them there
/// either.
struct ClassroomDetailView: View {
    let classroom: Classroom

    enum Tab: String, CaseIterable, Identifiable {
        case overview = "Overview"
        case work = "Work"
        case materials = "Materials"
        case people = "People"

        var id: String { rawValue }
    }

    @Environment(Session.self) private var session
    @State private var tab: Tab = .overview
    @State private var board: RankingBoard?
    @State private var boardKind: RankingKind = .academic
    @State private var people: [ClassroomMember] = []
    @State private var materials: [ClassroomMaterial] = []
    @State private var assignments: [AssignmentListing] = []
    @State private var isLoading = true
    @State private var loadError: String?

    var body: some View {
        VStack(spacing: 0) {
            Picker("Section", selection: $tab) {
                ForEach(Tab.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)

            if isLoading {
                Spacer(); ProgressView(); Spacer()
            } else if let loadError {
                Spacer(); RetryNotice(message: loadError) { await load() }; Spacer()
            } else {
                switch tab {
                case .overview: overview
                case .work: work
                case .materials: materialList
                case .people: peopleList
                }
            }
        }
        .navigationTitle(classroom.name)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: tab) { await load() }
    }

    // MARK: - Overview

    @ViewBuilder
    private var overview: some View {
        List {
            Section("Class") {
                if let teacher = classroom.teacherName, !teacher.isEmpty {
                    LabeledContent("Teacher", value: teacher)
                }
                if let subject = classroom.subject, !subject.isEmpty {
                    LabeledContent("Subject", value: subject.humanisedSubject)
                }
                if let schedule = classroom.scheduleSummary, !schedule.isEmpty {
                    LabeledContent("Schedule", value: schedule)
                }
                if let room = classroom.roomNumber, !room.isEmpty {
                    LabeledContent("Room", value: room)
                }
                if let members = classroom.membersCount {
                    LabeledContent("Members", value: ScoreText.string(members))
                }
            }

            Section {
                Picker("Board", selection: $boardKind) {
                    ForEach(RankingKind.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .onChange(of: boardKind) { _, _ in Task { await loadBoard() } }

                if let board {
                    if board.isHidden {
                        Text("Your teacher keeps this board private.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else if boardKind == .sat && !board.satAvailable {
                        // Foundation and junior classes do not rank on SAT at all. Saying
                        // so beats an empty list that reads as "nobody has scored".
                        Text("This class does not rank on SAT scores.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else if board.rows.isEmpty {
                        Text("No results on this board yet.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(board.rows) { row in
                            RankingRowView(row: row, hideScores: board.hideScoreValues)
                        }
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            } header: {
                Text("Leaderboard")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
    }

    // MARK: - Work

    @ViewBuilder
    private var work: some View {
        if assignments.isEmpty {
            ContentUnavailableView(
                "Nothing set yet",
                systemImage: "checklist",
                description: Text("Homework for this class will appear here.")
            )
        } else {
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(assignments) { assignment in
                        NavigationLink {
                            HomeworkDetailView(assignment: assignment)
                        } label: {
                            HomeworkRow(assignment: assignment).cardStyle()
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .background(Theme.background)
        }
    }

    // MARK: - Materials

    @ViewBuilder
    private var materialList: some View {
        if materials.isEmpty {
            ContentUnavailableView(
                "No materials yet",
                systemImage: "folder",
                description: Text("Files your teacher shares will appear here.")
            )
        } else {
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(materials) { MaterialRow(material: $0) }
                }
                .padding(16)
            }
            .background(Theme.background)
        }
    }

    // MARK: - People

    @ViewBuilder
    private var peopleList: some View {
        ScrollView {
            let staff = people.filter(\.isStaff)
            let students = people.filter { !$0.isStaff }
            VStack(alignment: .leading, spacing: 20) {
                if !staff.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Overline("Teachers")
                        ForEach(staff) { PersonRow(person: $0) }
                    }
                }
                if !students.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Overline("Students · \(students.count)")
                        ForEach(students) { PersonRow(person: $0) }
                    }
                }
            }
            .padding(16)
        }
        .background(Theme.background)
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        loadError = nil
        do {
            switch tab {
            case .overview:
                isLoading = board == nil
                await loadBoard()
            case .work:
                isLoading = assignments.isEmpty
                let all = try await session.student.assignments()
                assignments = all.filter { $0.classroomId == classroom.id }
            case .materials:
                isLoading = materials.isEmpty
                materials = try await session.classrooms.materials(classroomId: classroom.id)
            case .people:
                isLoading = people.isEmpty
                people = try await session.classrooms.people(classroomId: classroom.id)
            }
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor
    private func loadBoard() async {
        do {
            board = try await session.classrooms.rankings(classroomId: classroom.id, kind: boardKind)
        } catch {
            // A board that will not load must not take the whole Overview with it — the
            // class details above it are still worth showing.
            board = nil
        }
        isLoading = false
    }
}

struct RankingRowView: View {
    let row: RankingRow
    let hideScores: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text(ScoreText.string(row.rank))
                .font(.subheadline.bold().monospacedDigit())
                .frame(width: 28, alignment: .trailing)
                .foregroundStyle(row.isMe ? Theme.accent : .secondary)

            Text(row.name)
                .font(.subheadline)
                .fontWeight(row.isMe ? .bold : .regular)
                .lineLimit(1)

            Spacer()

            if let change = row.rankChange, change != 0 {
                Image(systemName: change > 0 ? "arrow.up" : "arrow.down")
                    .font(.caption2)
                    .foregroundStyle(change > 0 ? .green : .secondary)
            }

            if hideScores {
                EmptyView()
            } else if let score = row.score {
                Text(ScoreText.string(score))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            } else if !row.hasResult {
                // Not "0" and not blank: they simply have not sat one yet.
                Text("—").font(.subheadline).foregroundStyle(.tertiary)
            }
        }
    }
}

struct PersonRow: View {
    let person: ClassroomMember

    var body: some View {
        HStack(spacing: 12) {
            Avatar(url: person.photoURL, name: person.name)
            VStack(alignment: .leading, spacing: 1) {
                Text(person.name).font(.subheadline)
                Text(person.roleLabel).font(.caption).foregroundStyle(.secondary)
            }
        }
        .cardStyle(padding: 13)
    }
}

struct MaterialRow: View {
    let material: ClassroomMaterial

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(material.title).font(.subheadline.weight(.medium))
            if let description = material.description, !description.isEmpty {
                Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            HStack(spacing: 8) {
                if let name = material.fileName, !name.isEmpty {
                    Text(name).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                if let size = material.fileSize, size > 0 {
                    Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if let raw = material.fileURL, let url = URL(string: raw) {
                    // Opened in Safari rather than downloaded in-app: these are the
                    // teacher's own files in every format a teacher uses, and Safari
                    // already knows how to show all of them.
                    Link(destination: url) {
                        Label("Open", systemImage: "arrow.up.right.square")
                            .font(.caption.weight(.medium))
                    }
                }
            }
        }
        .cardStyle(padding: 14)
    }
}

/// A person's photo, or their initials.
///
/// The rule the platform follows everywhere: if the name is hidden, the photo hides with
/// it — a face identifies someone more directly than a name does.
struct Avatar: View {
    let url: String?
    let name: String
    var size: CGFloat = 36

    var body: some View {
        Group {
            if let url, let parsed = URL(string: url) {
                AsyncImage(url: parsed) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initials
                }
            } else {
                initials
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var initials: some View {
        ZStack {
            Circle().fill(Theme.accent.opacity(0.15))
            Text(shortInitials)
                .font(.system(size: size * 0.38, weight: .bold))
                .foregroundStyle(Theme.accent)
        }
    }

    private var shortInitials: String {
        let letters = name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }
        return letters.isEmpty ? "?" : letters.joined().uppercased()
    }
}
