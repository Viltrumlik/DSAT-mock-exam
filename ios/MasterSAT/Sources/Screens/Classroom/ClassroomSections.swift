import SwiftUI
import MasterSATKit

// The five tabs of a classroom, each as the site draws it for a student. Every one has the
// same four states: loading, loaded, empty, and failed — and a failure is never drawn as
// an empty tab.

/// A tab's heading: the title, and one line saying what the tab is.
private struct SectionHeading: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.system(size: 22, weight: .heavy)).tracking(-0.4)
            Text(subtitle)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Loading, failed, empty or loaded — in that order of precedence, so a failure with nothing
/// to show is the error state and a failure with something to show is a line above it.
private struct SectionBody<Value, Loaded: View>: View {
    let load: ClassroomLoad<Value>
    let failureTitle: String
    let failureMessage: String
    let isEmpty: (Value) -> Bool
    let emptyTitle: String
    let emptyHint: String?
    let retry: @MainActor () async -> Void
    @ViewBuilder let loaded: (Value) -> Loaded

    var body: some View {
        if let value = load.value {
            if load.error != nil {
                Label("Could not refresh just now — this is the last we had.", systemImage: "exclamationmark.triangle")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            if isEmpty(value) {
                DashedEmpty(title: emptyTitle, hint: emptyHint)
            } else {
                loaded(value)
            }
        } else if load.error != nil {
            ClassroomErrorState(title: failureTitle, message: failureMessage, retry: retry)
        } else {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
        }
    }
}

// MARK: - Overview: the class board

struct ClassroomRankingsSection: View {
    let load: ClassroomLoad<RankingBoard>
    let isStudent: Bool
    let retry: @MainActor () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "trophy.fill").foregroundStyle(Theme.accent)
                Text("Class rankings").font(.system(size: 22, weight: .heavy)).tracking(-0.4)
            }
            // Naming the ways to earn is the point: a student who can see what moves the
            // number can decide to move it.
            Text("XP earned in this class — attendance, homework and support sessions. It comes with you if you change group.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            SectionBody(
                load: load,
                failureTitle: "Rankings not available",
                failureMessage: "We couldn't load this class's rankings just now.",
                isEmpty: { $0.rows.isEmpty },
                emptyTitle: "No rankings yet",
                emptyHint: "Your ranking will appear once there's enough data.",
                retry: retry
            ) { board in
                boardView(board)
            }
        }
    }

    @ViewBuilder
    private func boardView(_ board: RankingBoard) -> some View {
        let podium = board.rows.count >= 3 && !board.isAnonymous
        if podium {
            ClassroomPodium(rows: Array(board.rows.prefix(3)), score: { score(of: $0, in: board) })
        }
        VStack(spacing: 8) {
            ForEach(podium ? Array(board.rows.dropFirst(3)) : board.rows) { row in
                ClassroomRankingRow(row: row, score: score(of: row, in: board))
            }
        }
        if isStudent && board.isHidden {
            Text("Your teacher shows only your own position for this class.")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity)
        }
    }

    /// A student always sees their own score; everyone else's hides when the teacher says so.
    private func score(of row: RankingRow, in board: RankingBoard) -> Double? {
        row.isMe ? row.score : (board.hideScoreValues ? nil : row.score)
    }
}

/// The top three: 2nd, 1st (with a crown), 3rd — each with its XP.
private struct ClassroomPodium: View {
    let rows: [RankingRow]
    let score: (RankingRow) -> Double?

    private func medal(_ rank: Int) -> Color {
        switch rank {
        case 1: return Theme.amber
        case 2: return Theme.textLabel
        default: return Theme.warning
        }
    }

    var body: some View {
        let ordered = rows.count == 3 ? [rows[1], rows[0], rows[2]] : rows
        HStack(alignment: .bottom, spacing: 10) {
            ForEach(ordered) { row in
                let first = row.rank == 1
                VStack(spacing: 6) {
                    if first {
                        Image(systemName: "crown.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(Theme.amber)
                    }
                    ZStack(alignment: .bottom) {
                        Avatar(url: row.photoURL, name: row.name, size: first ? 60 : 52)
                            .padding(.bottom, 10)
                        Text(ScoreText.string(row.rank))
                            .font(.system(size: 11, weight: .heavy))
                            .foregroundStyle(.white)
                            .frame(width: 22, height: 22)
                            .background(Circle().fill(medal(row.rank)))
                            .overlay(Circle().stroke(Theme.card, lineWidth: 2))
                    }
                    Text(row.name)
                        .font(.system(size: 13, weight: .heavy))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    if row.isMe {
                        Text("You").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.accent)
                    }
                    Text(score(row).map { "\(ScoreText.string($0)) XP" } ?? "—")
                        .font(.system(size: 12, weight: .bold).monospacedDigit())
                        .foregroundStyle(Theme.textSecondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, first ? 14 : 8)
                .padding(.bottom, 12)
                .padding(.horizontal, 6)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(row.isMe ? Theme.accentSoft : medal(row.rank).opacity(0.1))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(row.isMe ? Theme.accent : medal(row.rank).opacity(0.35), lineWidth: row.isMe ? 1.5 : 1)
                )
            }
        }
    }
}

private struct ClassroomRankingRow: View {
    let row: RankingRow
    let score: Double?

    var body: some View {
        HStack(spacing: 12) {
            Text(ScoreText.string(row.rank))
                .font(.system(size: 14, weight: .heavy).monospacedDigit())
                .frame(width: 26)
                .foregroundStyle(Theme.textSecondary)
            Avatar(url: row.photoURL, name: row.name, size: 36)
            HStack(spacing: 6) {
                Text(row.name)
                    .font(.system(size: 14, weight: .bold))
                    .lineLimit(1)
                if row.isMe {
                    Text("You").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.accent)
                }
            }
            Spacer(minLength: 0)
            // A missing score means one of two things: no result yet (a dash), or hidden by
            // the teacher (the eye). They need different marks.
            if let score {
                Text(ScoreText.string(score))
                    .font(.system(size: 14, weight: .heavy).monospacedDigit())
            } else if !row.hasResult {
                Text("—").font(.system(size: 14)).foregroundStyle(Theme.textLabel)
            } else {
                Image(systemName: "eye.slash")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textLabel)
                    .accessibilityLabel("Hidden by your teacher")
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(row.isMe ? Theme.accentSoft : Theme.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(row.isMe ? Theme.accent : Theme.separator.opacity(0.5), lineWidth: row.isMe ? 1 : 0.5)
        )
    }
}

// MARK: - Classwork

struct ClassroomClassworkSection: View {
    let load: ClassroomLoad<[AssignmentListing]>
    let retry: @MainActor () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeading(title: "Classwork", subtitle: "What you worked on in class, and the XP your teacher gave you")
            SectionBody(
                load: load,
                failureTitle: "Classwork not available",
                failureMessage: "We couldn't load this class's work just now.",
                isEmpty: { $0.isEmpty },
                emptyTitle: "No classwork yet",
                emptyHint: "Work you do during lessons shows up here, along with the XP your teacher gives you.",
                retry: retry
            ) { rows in
                VStack(spacing: 10) {
                    ForEach(rows) { row in
                        NavigationLink {
                            HomeworkDetailView(assignment: row)
                        } label: {
                            ClassworkRow(item: row)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

/// One lesson's classwork: what it was, how many things it held, when, and the award.
private struct ClassworkRow: View {
    let item: AssignmentListing

    private var award: ClassworkAwardState { item.classworkAwardState }

    var body: some View {
        HStack(spacing: 12) {
            IconTile(systemName: "rectangle.inset.filled.and.person.filled", tone: Theme.accent, size: 42)
            VStack(alignment: .leading, spacing: 5) {
                Text(item.title.isEmpty ? "Classwork" : item.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    // Encouraging in every branch, including zero: a looked-at zero is
                    // "Reviewed", never XP the student lost.
                    Chip(
                        text: award.badge,
                        icon: award.isMarked ? "sparkles" : nil,
                        tone: award.isMarked ? .success : .neutral
                    )
                    Text(item.assignedAt.map { "In class \(HomeworkWording.shortDate($0))" } ?? "In class")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                if let activities = item.activityLabel {
                    Text(activities)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.textLabel)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textLabel)
        }
        .cardStyle(padding: 14)
        .contentShape(Rectangle())
    }
}

// MARK: - Assignments

struct ClassroomAssignmentsSection: View {
    let load: ClassroomLoad<[AssignmentListing]>
    let retry: @MainActor () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeading(title: "Assignments", subtitle: "Your work for this class")
            SectionBody(
                load: load,
                failureTitle: "Assignments not available",
                failureMessage: "We couldn't load this class's homework just now.",
                isEmpty: { $0.isEmpty },
                emptyTitle: "No assignments yet",
                emptyHint: "New assignments will appear here.",
                retry: retry
            ) { rows in
                VStack(spacing: 10) {
                    // The server's order, as the student's homework list has it.
                    ForEach(rows) { row in
                        NavigationLink {
                            HomeworkDetailView(assignment: row)
                        } label: {
                            HomeworkRow(assignment: row).cardStyle()
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

// MARK: - Materials

struct ClassroomMaterialsSection: View {
    let load: ClassroomLoad<[ClassroomMaterial]>
    let retry: @MainActor () async -> Void

    /// nil is "All".
    @State private var category: MaterialKind.Category?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeading(title: "Materials", subtitle: "Downloadable resources for this class")
            SectionBody(
                load: load,
                failureTitle: "Materials not available",
                failureMessage: "We couldn't load this class's materials just now.",
                isEmpty: { $0.isEmpty },
                emptyTitle: "No materials yet",
                emptyHint: "Your teacher hasn't shared any materials yet.",
                retry: retry
            ) { materials in
                let present = MaterialKind.Category.allCases.filter { cat in materials.contains { $0.kind.category == cat } }
                if present.count > 1 {
                    PillTabs(items: filterItems(materials, present: present), selection: $category)
                }
                VStack(spacing: 10) {
                    ForEach(materials.filter { category == nil || $0.kind.category == category }) { material in
                        ClassroomMaterialCard(material: material)
                    }
                }
            }
        }
    }

    private func filterItems(_ materials: [ClassroomMaterial], present: [MaterialKind.Category]) -> [PillTabs<MaterialKind.Category?>.Item] {
        var items: [PillTabs<MaterialKind.Category?>.Item] = [
            .init(tab: nil, title: "All", icon: "square.stack", count: materials.count),
        ]
        for cat in present {
            items.append(.init(
                tab: cat,
                title: cat.rawValue,
                icon: cat == .slides ? "rectangle.on.rectangle" : cat == .audio ? "waveform" : "doc.text",
                count: materials.filter { $0.kind.category == cat }.count
            ))
        }
        return items
    }
}

/// One shared file: its type, its name, what it is, size and date, and Download.
private struct ClassroomMaterialCard: View {
    let material: ClassroomMaterial

    private var kind: MaterialKind { material.kind }

    private var icon: String {
        switch kind.family {
        case .pdf, .text: return "doc.text.fill"
        case .sheet: return "tablecells.fill"
        case .image: return "photo.fill"
        case .slides: return "rectangle.on.rectangle.angled.fill"
        case .audio: return "music.note"
        case .other: return "doc.fill"
        }
    }

    private var tone: Color {
        switch kind.family {
        case .pdf: return Theme.danger
        case .text: return Theme.accent
        case .sheet, .image: return Theme.success
        case .slides: return Theme.amber
        case .audio: return Theme.subjectEnglish
        case .other: return Theme.textSecondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                IconTile(systemName: icon, tone: tone, size: 42)
                Spacer(minLength: 0)
                Text(kind.label)
                    .font(.system(size: 10, weight: .heavy))
                    .tracking(0.6)
                    .foregroundStyle(tone)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(tone.opacity(0.12)))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(material.title.isEmpty ? (material.fileName ?? "Material") : material.title)
                    .font(.system(size: 15, weight: .bold))
                    .lineLimit(2)
                if let description = material.description, !description.isEmpty {
                    Text(description)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                let meta = material.metaLine()
                if !meta.isEmpty {
                    Text(meta)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textLabel)
                }
            }
            if let raw = material.fileURL, let url = URL(string: raw) {
                // Opened by the system rather than downloaded in-app: these are the teacher's
                // own files in every format a teacher uses, and iOS already knows how to show
                // all of them.
                Link(destination: url) {
                    Label("Download", systemImage: "arrow.down.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            }
        }
        .cardStyle(padding: 16)
    }
}

// MARK: - People

struct ClassroomPeopleSection: View {
    let load: ClassroomLoad<[ClassroomMember]>
    let retry: @MainActor () async -> Void

    @State private var query = ""

    var body: some View {
        SectionBody(
            load: load,
            failureTitle: "People not available",
            failureMessage: "We couldn't load who is in this class just now.",
            isEmpty: { _ in false },
            emptyTitle: "",
            emptyHint: nil,
            retry: retry
        ) { members in
            people(members)
        }
    }

    @ViewBuilder
    private func people(_ members: [ClassroomMember]) -> some View {
        let active = members.filter { ($0.status ?? "ACTIVE").uppercased() != "REMOVED" }
        let staff = StaffTitle.sorted(active.filter(\.isStaff))
        let students = active.filter(\.isStudent)
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let shown = needle.isEmpty ? students : students.filter {
            $0.name.lowercased().contains(needle) || ($0.email ?? "").lowercased().contains(needle)
        }

        VStack(alignment: .leading, spacing: 10) {
            PeopleHeading(icon: "graduationcap.fill", title: "Teaching team",
                          detail: "\(staff.count) \(staff.count == 1 ? "member" : "members")")
            if staff.isEmpty {
                DashedEmpty(title: "No staff yet")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(staff.enumerated()), id: \.element.id) { index, member in
                        if index > 0 { Divider().padding(.leading, 56) }
                        StaffRow(member: member)
                    }
                }
                .cardStyle(padding: 12)
            }
        }

        VStack(alignment: .leading, spacing: 10) {
            PeopleHeading(icon: "person.2.fill", title: "Students", detail: "\(students.count) enrolled")
            if students.isEmpty {
                DashedEmpty(title: "No students yet")
            } else {
                ClassroomSearchField(text: $query, placeholder: "Search students")
                if shown.isEmpty {
                    DashedEmpty(title: "No students match “\(query.trimmingCharacters(in: .whitespaces))”.")
                } else {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                        ForEach(shown) { member in
                            HStack(spacing: 10) {
                                Avatar(url: member.photoURL, name: member.name, size: 34)
                                Text(member.name)
                                    .font(.system(size: 13, weight: .semibold))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.85)
                                Spacer(minLength: 0)
                            }
                            .cardStyle(padding: 10)
                        }
                    }
                }
            }
        }
    }
}

private struct PeopleHeading: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.accent)
            Text(title).font(.system(size: 16, weight: .heavy))
            Text(detail).font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
        }
    }
}

/// A member of the teaching team, titled by their account — Owner, Admin, Teacher or
/// Support teacher — never by the seat their membership gives them.
private struct StaffRow: View {
    let member: ClassroomMember

    var body: some View {
        HStack(spacing: 12) {
            Avatar(url: member.photoURL, name: member.name, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(member.name).font(.system(size: 14, weight: .bold)).lineLimit(1)
                if let email = member.email, !email.isEmpty {
                    Text(email)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if let title = member.staffTitle {
                Chip(text: title, tone: .accent)
            }
        }
        .padding(.vertical, 8)
    }
}

/// The student search on People: a rounded field with the glyph inside it.
private struct ClassroomSearchField: View {
    @Binding var text: String
    let placeholder: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.textLabel)
            TextField("", text: $text, prompt: Text(verbatim: placeholder))
                .font(.system(size: 14, weight: .semibold))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textLabel)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.card))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
    }
}
