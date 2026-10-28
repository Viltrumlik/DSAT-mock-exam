import SwiftUI
import MasterSATKit

/// The class page: one subject at one level — the owner's "Class Detail v4", built for real.
///
/// A dark page tinted from the level's palette, under a glass strip and the glass class card (name,
/// days and time, room, teacher). Below them the level's sessions, highest number on top, each a
/// glass card holding its Topic → Classwork → Homework trail, with the level's midterms between them
/// and a glowing link from the bottom of the stack up to the session in front of the student. The
/// page opens on that session, and its lit path draws in. While it is up, the floating tab bar wears
/// the design's dark glass (`TabBarChrome`).
///
/// The sessions are the kit's `SessionTrail` over the roadmap's lessons; every node opens through an
/// `AppLink` the tab's stack already resolves — the reading, or the homework page, which is also the
/// classwork page (`ClassPageLinks`).
///
/// The back button is the system's, over a transparent bar: it keeps the swipe back and the long
/// press, and on iOS 26 it is the design's glass circle.
struct ClassPageView: View {
    let route: ClassPageRoute

    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router
    @Environment(TabBarChrome.self) private var chrome: TabBarChrome?
    @Environment(StatusBarChrome.self) private var statusBar: StatusBarChrome?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model = ClassPageModel()
    /// The header has risen into place (the design's `inUp`, 140 ms in).
    @State private var headerShown = false
    /// The sessions' entrance has run: cards rise, bars fill, the now path draws. Flipped a beat
    /// after the sessions first appear, so they are drawn once at the start of it.
    @State private var entered = false
    /// The page has opened on the now session — once, so a reload never yanks it from where the
    /// student has scrolled.
    @State private var opened = false
    /// This page's claim on the tab bar's style.
    @State private var chromeOwner = UUID()
    /// The class whose Class info sheet is up.
    @State private var infoClass: Classroom?

    private var theme: ClassTheme { LevelPalette(subject: route.subject, level: route.level).theme }

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 16)
                .padding(.top, 10)
            sessions
                .padding(.top, 14)
        }
        .background { ClassPageTopStrip() }
        .background { ClassPageBackdrop(theme: theme) }
        .overlay(alignment: .bottom) { ClassPageFade(edge: .bottom, theme: theme) }
        // The page is dark whatever the phone's setting: its words, spinners and refresh control are
        // drawn for it.
        .environment(\.colorScheme, .dark)
        // Outside the dark override, so the sheet follows the phone's own setting.
        .sheet(item: $infoClass) { room in
            ClassInfoSheet(classroom: room, subject: route.subject, level: route.level)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        // A chevron alone, as the design's back button: no "Back" beside it.
        .toolbarRole(.editor)
        // Runs again whenever the page comes back into view — after a reading or a homework — so a
        // step just finished moves the trail on without a pull.
        .task { await model.load(route: route, session: session) }
        .onAppear {
            headerShown = true
            // The tab this page is showing in is the open one as it appears. The page is dark in
            // either appearance, so the bar wears dark glass and the clock is white.
            chrome?.ask(.darkGlass(ink: theme.deep), on: router.selection, owner: chromeOwner)
            statusBar?.ask(.light, on: router.selection, owner: chromeOwner)
        }
        .onDisappear {
            chrome?.release(owner: chromeOwner)
            statusBar?.release(owner: chromeOwner)
        }
    }

    // MARK: - Header

    /// The class card. With a class behind it, a tap opens Class info; a level with none shows its
    /// name and opens nothing.
    private var header: some View {
        Group {
            if let room = model.content?.classroom {
                Button { infoClass = room } label: { headerCard(opensInfo: true) }
                    .buttonStyle(PressBounce())
                    .accessibilityHint("Opens the class info: schedule, people, files and the Telegram group")
            } else {
                headerCard(opensInfo: false)
            }
        }
        .redacted(reason: model.phase == .loading ? .placeholder : [])
        .modifier(ClassPageRise(shown: headerShown, delay: 0.14))
    }

    private func headerCard(opensInfo: Bool) -> some View {
        ClassPageHeaderCard(
            title: model.content?.title ?? ClassPageContent.placeholderTitle(for: route),
            subject: route.subject,
            classroom: model.content?.classroom,
            detailsFailed: model.content?.classesFailed ?? false,
            theme: theme,
            opensInfo: opensInfo
        )
    }

    // MARK: - Sessions

    @ViewBuilder private var sessions: some View {
        switch model.phase {
        case .loading:
            ClassPageSkeleton()
                .padding(.horizontal, 16)
                .padding(.top, 18)
                .frame(maxHeight: .infinity, alignment: .top)
        case .failed(let message):
            ScrollView {
                ClassPageMessage(
                    icon: session.connectivity.isOnline ? "exclamationmark.triangle.fill" : "wifi.slash",
                    title: session.connectivity.isOnline ? "Couldn't load this class" : "You're offline",
                    message: session.connectivity.isOnline ? message : "This loads again once you're back online.",
                    theme: theme,
                    retry: { await model.retry(route: route, session: session) }
                )
                .padding(.horizontal, 16)
                .padding(.top, 18)
            }
            .scrollIndicators(.hidden)
        case .loaded(let content):
            if content.trail.items.isEmpty {
                ScrollView {
                    ClassPageMessage(
                        icon: "sparkles",
                        title: "No sessions yet",
                        message: "This level has no sessions yet. They appear here as your class reaches them.",
                        theme: theme,
                        retry: nil
                    )
                    .padding(.horizontal, 16)
                    .padding(.top, 18)
                }
                .scrollIndicators(.hidden)
                .detachedRefresh { await model.load(route: route, session: session) }
            } else {
                list(content)
            }
        }
    }

    private func list(_ content: ClassPageContent) -> some View {
        // Highest number on top: the stack is walked from the bottom up.
        let rows = Array(content.trail.items.reversed())
        let lit = content.trail.litThroughId
        let focus = content.trail.openingItemId ?? rows.first?.id ?? 0
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    if model.refreshFailed {
                        Label("Couldn't refresh — this is the class as it last loaded.", systemImage: "wifi.exclamationmark")
                            .appFont(12.5, weight: .semibold)
                            .foregroundStyle(.white.opacity(0.7))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.bottom, 12)
                    }
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, item in
                        VStack(spacing: 0) {
                            row(item, content: content)
                                // The design's beat: the cards nearest the now session first.
                                .modifier(ClassPageRise(shown: entered, delay: 0.15 + Double(min(8, abs(item.id - focus))) * 0.05))
                            if index < rows.count - 1 {
                                ClassTrailLink(lit: lit.map { item.id <= $0 } ?? false, theme: theme)
                            }
                        }
                        .id(item.id)
                    }
                }
                .padding(.top, 18)
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
            .scrollIndicators(.hidden)
            .overlay(alignment: .top) { ClassPageFade(edge: .top, theme: theme) }
            .detachedRefresh { await model.load(route: route, session: session) }
            .onAppear { open(content, proxy: proxy) }
        }
    }

    @ViewBuilder
    private func row(_ item: SessionTrailItem, content: ClassPageContent) -> some View {
        switch item {
        case .session(let trailSession):
            ClassSessionCard(
                session: trailSession,
                theme: theme,
                xpCeiling: content.xpCeiling,
                classroomId: content.workClassroomId,
                entered: entered
            )
        case .midterm(let midterm):
            ClassMidtermCard(midterm: midterm, theme: theme)
        }
    }

    /// The design's `seek()` and `intro()`: put the row the kit opens on in view (`openingItemId`:
    /// the now session, else the last one finished) — centred, or at the bottom of the screen when
    /// the level has not started; a level behind the student stays at its top. Then start the
    /// entrance a beat later. Both once; a reload keeps the student where they are.
    private func open(_ content: ClassPageContent, proxy: ScrollViewProxy) {
        guard !opened else { return }
        opened = true
        if let target = content.trail.openingItemId {
            let anchor: UnitPoint = content.trail.litThroughId == nil ? .bottom : .center
            Task {
                // One layout pass first, so the rows have their heights.
                await Task.yield()
                proxy.scrollTo(target, anchor: anchor)
            }
        }
        if reduceMotion {
            entered = true
        } else {
            Task {
                try? await Task.sleep(for: .milliseconds(60))
                entered = true
            }
        }
    }
}

// MARK: - The class card

/// The glass card under the strip: the subject's glyph, the class's name, its days and time, its
/// room and teacher (`height:100px; border-radius:20px`). A level with no class of the student's
/// shows its name only — and when the classes did not load, a line that says so, never a blank. When
/// it opens Class info, a small chevron at its edge says so.
struct ClassPageHeaderCard: View {
    let title: String
    let subject: ClassSubject
    let classroom: Classroom?
    /// `/classes/` did not answer, so the card cannot know the class's details.
    let detailsFailed: Bool
    let theme: ClassTheme
    let opensInfo: Bool

    private var schedule: String { classroom?.headerScheduleLine ?? "" }
    private var room: String { ClassroomSchedule.roomLabel(classroom?.roomNumber) }
    private var teacher: String { (classroom?.teacherName ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.white.opacity(0.16))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.24), lineWidth: 1))
                .frame(width: 46, height: 46)
                .overlay {
                    Image(systemName: subject.classPageIcon)
                        .font(.system(size: 21, weight: .semibold))
                        .foregroundStyle(Color(theme.l3))
                }
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .appFont(20, weight: .heavy)
                    .tracking(-0.4)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if !schedule.isEmpty {
                    detail(icon: "clock", text: schedule)
                }
                if !room.isEmpty || !teacher.isEmpty {
                    HStack(spacing: 12) {
                        if !room.isEmpty { detail(icon: "door.left.hand.open", text: room) }
                        if !teacher.isEmpty { detail(icon: "person", text: teacher) }
                    }
                }
                if classroom == nil && detailsFailed {
                    detail(icon: "exclamationmark.triangle", text: "Class details didn't load. Pull to try again.")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if opensInfo {
                Image(systemName: "chevron.right")
                    .appFont(13, weight: .bold)
                    .foregroundStyle(.white.opacity(0.6))
                    .accessibilityHidden(true)
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 16)
        .padding(.vertical, 12)
        .frame(minHeight: 100)
        .background(shape.fill(.white.opacity(0.12)))
        .overlay(shape.strokeBorder(.white.opacity(0.22), lineWidth: 1))
        .background(GlassShadow(shape: shape, color: ClassPageInk.shade.opacity(0.35), radius: 17, y: 14))
        .accessibilityElement(children: .combine)
    }

    private func detail(icon: String, text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
                .appFont(12, weight: .semibold)
                .foregroundStyle(.white.opacity(0.6))
                .accessibilityHidden(true)
            Text(text)
                .appFont(13, weight: .semibold)
                .foregroundStyle(.white.opacity(0.78))
                .lineLimit(1)
        }
    }
}

// MARK: - States

/// The design's entrance for one block: it fades in (0.6 s) as it rises 18 pt into place (0.8 s,
/// `cubic-bezier(.2,.8,.2,1)`), `delay` after the page asks. Under Reduce Motion it is simply there —
/// the same modifiers, given their resting values and no animation.
private struct ClassPageRise: ViewModifier {
    let shown: Bool
    let delay: Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let up = reduceMotion || shown
        content
            .animation(reduceMotion ? nil : .easeOut(duration: 0.6).delay(delay)) {
                $0.opacity(up ? 1 : 0)
            }
            .animation(reduceMotion ? nil : .timingCurve(0.2, 0.8, 0.2, 1, duration: 0.8).delay(delay)) {
                $0.offset(y: up ? 0 : 18)
            }
    }
}

/// Glass cards shaped like the sessions about to arrive. They breathe like `LoadingSkeleton`, and
/// hold still under Reduce Motion or Low Power.
private struct ClassPageSkeleton: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dimmed = false

    private var breathes: Bool {
        MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
            .allowsLoopingLottie
    }

    var body: some View {
        VStack(spacing: 28) {
            ForEach(0..<2, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(.white.opacity(0.07))
                    .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(.white.opacity(0.12), lineWidth: 1))
                    .frame(height: 260)
            }
        }
        .animation(breathes ? .easeInOut(duration: 1.1).repeatForever(autoreverses: true) : nil) {
            $0.opacity(breathes && dimmed ? 0.55 : 1)
        }
        .onAppear { dimmed = breathes }
        .onChange(of: breathes) { _, now in dimmed = now }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading sessions")
    }
}

/// A glass card that says why there are no sessions to show: a failure with "Try again", or a level
/// with nothing published yet. A failure is never drawn as an empty level.
private struct ClassPageMessage: View {
    let icon: String
    let title: String
    let message: String
    let theme: ClassTheme
    let retry: (@MainActor () async -> Void)?

    @State private var retrying = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 24, style: .continuous)
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(Color(theme.l3))
                .accessibilityHidden(true)
            Text(title)
                .appFont(17, weight: .heavy)
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
            Text(message)
                .appFont(13, weight: .medium)
                .foregroundStyle(.white.opacity(0.7))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let retry {
                Button {
                    // Flipped here, not inside the task: a second tap in the gap would send twice.
                    guard !retrying else { return }
                    retrying = true
                    Task {
                        await retry()
                        retrying = false
                    }
                } label: {
                    HStack(spacing: 8) {
                        if retrying {
                            ProgressView().controlSize(.small).tint(Color(theme.deep))
                        } else {
                            Image(systemName: "arrow.clockwise").accessibilityHidden(true)
                        }
                        Text("Try again")
                    }
                    .appFont(15, weight: .bold)
                    .foregroundStyle(Color(theme.deep))
                    .padding(.horizontal, 20)
                    .frame(minHeight: 44)
                    .background(Capsule().fill(.white))
                }
                .buttonStyle(PressBounce())
                .disabled(retrying)
                .accessibilityLabel(retrying ? "Trying again" : "Try again")
                .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 20)
        .background(shape.fill(.white.opacity(0.08)))
        .overlay(shape.strokeBorder(.white.opacity(0.14), lineWidth: 1))
    }
}
