import SwiftUI
import MasterSATKit

/// "Class info" — everything about the class that is not a session, from the class card on the
/// class page: when and where it meets, who teaches it, the people in it, the files shared with it,
/// and its Telegram group.
///
/// The old Class tab's People and Files segments and its Telegram button, moved here as the plan
/// puts them (`2026-10-28-ios-class-roadmap.md`): the same views over the same data
/// (`ClassPeopleSegment`, `ClassFilesSegment`, `ClassroomTelegramSheet`), set in a sheet under a
/// band in the level's own colours.
struct ClassInfoSheet: View {
    let classroom: Classroom
    let subject: ClassSubject
    /// The roadmap's level code, for the band's colours.
    let level: String

    enum Part: Hashable { case people, files }

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @State private var part: Part = .people
    /// People and Files for this class, kept while the sheet is up.
    @State private var sections = ClassSectionsModel()
    @State private var refreshTick = 0
    @State private var telegram: TelegramGroupState?
    @State private var joiningTelegram = false

    private var palette: LevelPalette { LevelPalette(subject: subject, level: level) }
    private var telegramButton: TelegramGroupButton {
        TelegramGroupButton.resolve(state: telegram, classroomGroupURL: classroom.telegramGroupURL)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    band
                    facts
                    if let title = telegramButton.title {
                        Button(action: openTelegram) {
                            Label(title, systemImage: "paperplane.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                    }
                    SegmentBar(items: [.init(segment: .people, title: "People"), .init(segment: .files, title: "Files")], selection: $part)
                    switch part {
                    case .people:
                        ClassPeopleSegment(classes: [classroom], model: sections, refreshID: refreshTick)
                    case .files:
                        ClassFilesSegment(classes: [classroom], model: sections, refreshID: refreshTick)
                    }
                }
                .padding(20)
            }
            .background(Theme.background)
            .navigationTitle("Class info")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .detachedRefresh {
                refreshTick += 1
                await loadTelegram()
            }
        }
        // A sheet has no tab bar under it; the tab's bottom margin must not follow it in.
        .noBarClearance()
        .task { await loadTelegram() }
        .sheet(isPresented: $joiningTelegram, onDismiss: { Task { await loadTelegram() } }) {
            ClassroomTelegramSheet(classroomId: classroom.id, className: classroom.name, initialState: telegram) { state in
                telegram = state
            }
            .noBarClearance()
        }
    }

    // MARK: - Pieces

    /// The class's name over its level's gradient — the Class tab's card, in small.
    private var band: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.white.opacity(0.2))
                .frame(width: 48, height: 48)
                .overlay {
                    Image(systemName: subject.classPageIcon)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(classroom.name)
                    .appFont(20, weight: .heavy)
                    .tracking(-0.4)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text(ProfileClasses.subjectLine(classroom))
                    .appFont(13, weight: .semibold)
                    .opacity(0.85)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .padding(16)
        .background(palette.cardGradient, in: RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    /// When, where, and with whom — one row each, and only the ones the centre filled in.
    private var facts: some View {
        let schedule = classroom.headerScheduleLine
        let room = ClassroomSchedule.roomLabel(classroom.roomNumber)
        let teacher = (classroom.teacherName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let rows: [(icon: String, label: String, value: String)] = [
            ("clock", "Schedule", schedule),
            ("door.left.hand.open", "Room", room),
            ("person", "Teacher", teacher),
        ].filter { !$0.value.isEmpty }
        return VStack(spacing: 0) {
            if rows.isEmpty {
                Text("The centre hasn't set a schedule for this class yet.")
                    .appFont(13, weight: .medium)
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                if index > 0 { Divider().padding(.leading, 50) }
                HStack(spacing: 12) {
                    IconTile(systemName: row.icon, tone: Color(palette.start), size: 36)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.label)
                            .appFont(12, weight: .semibold)
                            .foregroundStyle(Theme.textSecondary)
                        Text(row.value)
                            .appFont(15, weight: .bold)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 8)
                .accessibilityElement(children: .combine)
            }
        }
        .cardStyle(padding: 12)
    }

    // MARK: - Telegram

    private func openTelegram() {
        switch telegramButton {
        case .join: joiningTelegram = true
        case .link(let raw): if let url = URL(string: raw) { openURL(url) }
        case .none: break
        }
    }

    /// A failed lookup leaves the button on the class's static link, which still works.
    @MainActor
    private func loadTelegram() async {
        let api = ClassroomTelegramAPI(client: session.client)
        if let state = try? await api.state(classroomId: classroom.id), telegram != state {
            telegram = state
        }
    }
}
