import SwiftUI
import MasterSATKit

/// The roadmap — the course as a path you walk, one level at a time. The site's `/roadmap`.
///
/// One card per level of each subject the student studies. Only their own level is openable,
/// and only it starts open: the page is tall, and opening every rung would bury the one they
/// came to see. Inside an open level the lessons are numbered circles on a winding trail, the
/// walked part in green; tapping one says what it is and where its button goes.
///
/// Level state is worked out here, not sent (see `RoadmapRules`): the server says which
/// level is theirs and whether each journal is published, and one function derives the pill,
/// the veil and the circles from that so they can never disagree.
///
/// The web paints each level onto illustrated scenery. That artwork is not reproduced; the
/// path is drawn natively through the circles' centres.
struct RoadmapView: View {
    @Environment(Session.self) private var session

    @State private var roadmap: RoadmapResponse?
    @State private var loadError: String?
    @State private var subject: String?
    /// Levels the student has opened or closed, by `subject-level`. A level nobody has touched
    /// takes its default: open only if it is theirs.
    @State private var expanded: [String: Bool] = [:]
    /// Subjects already scrolled to their current lesson — once each, so a reload never yanks
    /// the page away from where the student has scrolled.
    @State private var jumped: Set<String> = []

    @State private var sheet: RoadmapSheetItem?
    /// Where to go once the sheet has finished closing. A push fired while a sheet is still
    /// on screen is dropped, so the sheet records it and `onDismiss` performs it.
    @State private var pending: RoadmapPush?
    @State private var readingDeliveryId: Int?
    @State private var homework: RoadmapHomeworkTarget?

    private var tracks: [RoadmapTrack] { roadmap?.tracks ?? [] }

    private var track: RoadmapTrack? {
        tracks.first { $0.subject == subject } ?? tracks.first
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    if roadmap != nil, tracks.count > 1 {
                        PillTabs(items: subjectTabs, selection: subjectSelection)
                    }
                    content
                }
                .padding(16)
                .padding(.bottom, 40)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .task(id: jumpKey) { await jumpToCurrentLesson(proxy) }
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        // Runs again whenever the page comes back into view — after the reading or the
        // homework — so a lesson just read or finished shows it without a pull.
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $sheet, onDismiss: performPendingPush) { item in
            RoadmapLessonSheet(item: item, student: session.student) { push in
                // A lookup that lands after the student closed this sheet goes nowhere —
                // least of all onto the dismissal of the next sheet they open.
                guard sheet?.id == item.id else { return }
                pending = push
                sheet = nil
            }
        }
        .navigationDestination(item: $readingDeliveryId) { deliveryId in
            RoadmapReadingView(deliveryId: deliveryId)
        }
        .navigationDestination(item: $homework) { target in
            HomeworkDetailView(assignment: target.assignment)
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            PageTitle("Roadmap")
            Text("Your path, step by step. Finish a level to open the next one.")
                .font(.system(size: 14.5, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, 2)
    }

    private var subjectTabs: [PillTabs<String>.Item] {
        tracks.map { track in
            .init(tab: track.subject, title: track.subjectLabel, icon: track.subject == "math" ? "function" : "book.closed")
        }
    }

    private var subjectSelection: Binding<String> {
        Binding(get: { track?.subject ?? "" }, set: { subject = $0 })
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if let track, !track.levels.isEmpty {
            if loadError != nil {
                // A refresh that failed over a page already loaded: keep what loaded, and say so.
                Label("Couldn’t refresh — this is the roadmap as it last loaded.", systemImage: "wifi.exclamationmark")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            levels(of: track)
        } else if loadError != nil, roadmap == nil {
            LearnMoreErrorCard(
                title: "Couldn't load your roadmap",
                message: "Something went wrong on our end. Check your connection and try again."
            ) { await load() }
        } else if roadmap == nil {
            VStack(spacing: 14) {
                ForEach(0..<4, id: \.self) { _ in LearnMoreSkeleton(height: 76) }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Loading your roadmap")
        } else {
            LearnMoreEmptyCard(
                icon: "graduationcap.fill",
                title: "No roadmap yet",
                message: "Join a class to see your learning path across every level."
            ) {
                NavigationLink {
                    ClassesListView()
                } label: {
                    HStack(spacing: 8) {
                        Text("Go to Classes")
                        Image(systemName: "arrow.right")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
    }

    private func levels(of track: RoadmapTrack) -> some View {
        let states = RoadmapRules.levelStates(for: track)
        return VStack(spacing: 22) {
            ForEach(Array(track.levels.enumerated()), id: \.element.id) { index, level in
                let state = states[index]
                let key = Self.levelKey(subject: track.subject, level: level.level)
                RoadmapLevelSection(
                    subject: track.subject,
                    level: level,
                    state: state,
                    isOpen: isOpen(key: key, state: state),
                    onToggle: {
                        withAnimation(.easeInOut(duration: 0.22)) {
                            expanded[key] = !isOpen(key: key, state: state)
                        }
                    },
                    onTapLesson: { lessonIndex in
                        let lesson = level.lessons[lessonIndex]
                        sheet = RoadmapSheetItem(
                            id: "\(key)-\(lessonIndex)",
                            lesson: lesson,
                            action: RoadmapRules.action(
                                for: lesson,
                                levelLocked: state == .locked,
                                ownClassroomId: track.ownClassroomId
                            )
                        )
                    }
                )
            }
        }
        // A different subject is a different page: its levels start from their own defaults.
        .id(track.subject)
    }

    private func isOpen(key: String, state: RoadmapLevelState) -> Bool {
        expanded[key] ?? RoadmapRules.opensByDefault(state)
    }

    static func levelKey(subject: String, level: String) -> String { "\(subject)-\(level)" }

    static func nodeID(subject: String, level: String, index: Int) -> String {
        "roadmap-node-\(levelKey(subject: subject, level: level))-\(index)"
    }

    // MARK: - Landing on the current lesson

    private var jumpKey: String { "\(track?.subject ?? "")|\(roadmap == nil ? 0 : 1)" }

    /// The first lesson in front of the student, in the levels that are open.
    private var currentNodeID: String? {
        guard let track else { return nil }
        let states = RoadmapRules.levelStates(for: track)
        for (index, level) in track.levels.enumerated() {
            let state = states[index]
            let key = Self.levelKey(subject: track.subject, level: level.level)
            guard isOpen(key: key, state: state), state != .locked else { continue }
            if let lesson = level.lessons.firstIndex(where: {
                RoadmapRules.nodeState(for: $0, levelLocked: false) == .current
            }) {
                return Self.nodeID(subject: track.subject, level: level.level, index: lesson)
            }
        }
        return nil
    }

    @MainActor
    private func jumpToCurrentLesson(_ proxy: ScrollViewProxy) async {
        guard let subject = track?.subject, roadmap != nil, !jumped.contains(subject) else { return }
        guard let id = currentNodeID else { return }
        // After layout: the trail has to exist before there is anything to scroll to.
        try? await Task.sleep(for: .milliseconds(350))
        guard !Task.isCancelled else { return }
        jumped.insert(subject)
        withAnimation(.easeInOut(duration: 0.45)) {
            proxy.scrollTo(id, anchor: .center)
        }
    }

    // MARK: - Actions

    private func performPendingPush() {
        guard let push = pending else { return }
        pending = nil
        switch push {
        case .reading(let deliveryId):
            readingDeliveryId = deliveryId
        case .homework(let listing):
            homework = RoadmapHomeworkTarget(assignment: listing)
        }
    }

    @MainActor
    private func load() async {
        do {
            roadmap = try await RoadmapAPI(client: session.client).roadmap()
            loadError = nil
        } catch {
            // Leaving the page cancels its request; that is not a failure to report.
            if Task.isCancelled { return }
            loadError = learnMoreMessage(error)
        }
    }
}

// MARK: - A level

/// One level: its banner, and — when open — its stage.
struct RoadmapLevelSection: View {
    let subject: String
    let level: RoadmapLevel
    let state: RoadmapLevelState
    let isOpen: Bool
    let onToggle: () -> Void
    let onTapLesson: (Int) -> Void

    var body: some View {
        VStack(spacing: 14) {
            Button(action: onToggle) {
                RoadmapLevelBanner(
                    level: level,
                    state: state,
                    subtitle: RoadmapRules.subtitle(for: level, state: state),
                    isOpen: isOpen
                )
            }
            .buttonStyle(RoadmapPressStyle())
            .accessibilityHint(isOpen ? "Hides this level's lessons" : "Shows this level's lessons")

            if isOpen {
                RoadmapStage(
                    subject: subject,
                    level: level,
                    levelLocked: state == .locked,
                    onTapLesson: onTapLesson
                )
                .transition(.opacity)
            }
        }
    }
}

/// A level's banner: its name, where the student stands in it, and a status pill.
///
/// Filled green for a level behind them and brand blue for their own, as on the site; a
/// locked or coming-soon level is a plain card, because grey paint under white type is
/// unreadable in dark mode.
struct RoadmapLevelBanner: View {
    let level: RoadmapLevel
    let state: RoadmapLevelState
    let subtitle: String
    let isOpen: Bool

    private var fill: Color? {
        switch state {
        case .done: return Theme.success
        case .current: return Theme.accent
        case .locked, .comingSoon: return nil
        }
    }

    private var pillIcon: String {
        switch state {
        case .comingSoon: return "clock"
        case .locked: return "lock.fill"
        case .done: return "checkmark"
        case .current: return "smallcircle.filled.circle"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(level.levelLabel)
                    .font(.system(size: 21, weight: .heavy, design: .rounded))
                    .foregroundStyle(fill == nil ? Color.primary : .white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(subtitle)
                    .font(.system(size: 13.5, weight: .bold))
                    .foregroundStyle(fill == nil ? Theme.textSecondary : .white.opacity(0.92))
            }
            Spacer(minLength: 8)
            HStack(spacing: 5) {
                Image(systemName: pillIcon).font(.system(size: 11, weight: .heavy))
                Text(state.pillText).font(.system(size: 12, weight: .heavy))
            }
            .foregroundStyle(fill ?? Theme.textSecondary)
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .background(Capsule().fill(fill == nil ? Theme.surface2 : Color.white.opacity(0.94)))
            .fixedSize()
            Image(systemName: "chevron.down")
                .font(.system(size: 15, weight: .heavy))
                .foregroundStyle(fill == nil ? Theme.textSecondary : .white.opacity(0.9))
                .rotationEffect(.degrees(isOpen ? 0 : -90))
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 15)
        .frame(maxWidth: .infinity)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(fill == nil ? Theme.separator.opacity(0.5) : .clear, lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(fill == nil ? 0.03 : 0.10), radius: 6, x: 0, y: 3)
        .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var background: some View {
        switch state {
        case .current:
            // The hero's own gradient: this is where the student is.
            LinearGradient(colors: [Theme.accent, Theme.accentHover], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .done:
            LinearGradient(colors: [Theme.success.opacity(0.82), Theme.success], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .locked, .comingSoon:
            Theme.card
        }
    }
}

/// A gentle press for the site's raised buttons.
struct RoadmapPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
