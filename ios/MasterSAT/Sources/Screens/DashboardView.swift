import SwiftUI
import MasterSATKit

/// Home — the site's student dashboard, in the same order and the same words.
///
/// The web page is: welcome line and a goal control, target scores beside a countdown,
/// then the lesson calendar with the next lesson and the chosen day under it. That order
/// is not arbitrary — it goes from *why you are here* to *what is next* to *what is on* —
/// so it is kept, with the two columns stacked the way the site itself stacks them below
/// 1080px. Homework and midterm results follow, because on a phone Home is also the place
/// a student checks before a lesson.
struct DashboardView: View {
    let user: CurrentUser

    @Environment(Session.self) private var session

    /// The live profile. `user` is what RootView loaded at sign-in; this is what the
    /// student has changed since, so a saved goal shows immediately without a full reload.
    @State private var profile: CurrentUser?
    @State private var month = ScheduleMonth()
    @State private var assignments: [AssignmentListing] = []
    @State private var midterms: [MidtermListing] = []
    @State private var examDates: [ExamDateOption] = []
    @State private var viewYear = Calendar(identifier: .gregorian).component(.year, from: Date())
    @State private var viewMonth = Calendar(identifier: .gregorian).component(.month, from: Date())
    @State private var selectedDay: String?
    @State private var loadError: String?
    @State private var isLoading = true
    @State private var showingGoal = false
    @State private var savingExamDate = false
    @State private var openedAssignmentId: Int?
    @State private var promptDismissed = false

    private var current: CurrentUser { profile ?? user }

    /// Only asked once iOS has confirmed it has not asked yet, and only when there is
    /// something real to be reminded about — a prompt on an empty account is a prompt for a
    /// benefit the student cannot see, and iOS never offers the chance again.
    private var showsReminderPrompt: Bool {
        !promptDismissed
            && session.notifications.permission == .notAsked
            && (!dueSoon.isEmpty || midterms.contains { !$0.submitted })
    }

    /// Section targets, with the site's own fallback: a student who set a total before the
    /// two sliders existed still has one, so split it rather than showing two dashes under
    /// a filled-in overall.
    private var sectionTargets: (english: Int?, math: Int?) {
        if let english = current.targetEnglish, let math = current.targetMath { return (english, math) }
        guard let total = current.targetScore else { return (current.targetEnglish, current.targetMath) }
        let english = current.targetEnglish ?? Int((Double(total) / 20).rounded()) * 10
        return (english, current.targetMath ?? total - english)
    }

    private var dueSoon: [AssignmentListing] {
        assignments
            .filter { ($0.workflowStatus ?? "").lowercased() != "graded" }
            .sorted { ($0.dueAt ?? "9999") < ($1.dueAt ?? "9999") }
            .prefix(3)
            .map { $0 }
    }

    /// Midterms the student has actually sat. Papers are sat elsewhere; only the result
    /// comes back to the phone.
    private var results: [MidtermListing] {
        midterms.filter(\.submitted)
    }

    private var selectedEvents: [ScheduleEvent] {
        guard let selectedDay else { return [] }
        return month.byDate[selectedDay] ?? []
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header

                    TargetScoresCard(
                        overall: current.targetScore,
                        english: sectionTargets.english,
                        math: sectionTargets.math
                    )

                    CountdownCard(
                        examDate: current.satExamDate,
                        options: examDates,
                        saving: savingExamDate,
                        onSelect: { date in Task { await saveExamDate(date) } }
                    )

                    if let loadError {
                        RetryNotice(message: loadError) { await load() }
                    }

                    LessonCalendarCard(
                        month: month,
                        year: $viewYear,
                        monthIndex: $viewMonth,
                        selected: $selectedDay
                    )
                    .overlay(alignment: .topTrailing) {
                        if isLoading { ProgressView().padding(18) }
                    }

                    NextLessonCard(event: month.nextLesson, onOpen: open)
                    SelectedDayCard(dayKey: selectedDay, events: selectedEvents, onOpen: open)

                    if showsReminderPrompt {
                        ReminderPromptCard(
                            onEnable: {
                                Task {
                                    await session.notifications.requestPermission()
                                    await session.notifications.reschedule(assignments: assignments, midterms: midterms)
                                }
                            },
                            onDismiss: { promptDismissed = true }
                        )
                    }

                    if !dueSoon.isEmpty { homeworkSection }
                    if !results.isEmpty { resultsSection }
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Home")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await load() }
            .onAppear { Task { await load() } }
            .onChange(of: viewYear) { Task { await loadSchedule() } }
            .onChange(of: viewMonth) { Task { await loadSchedule() } }
            .navigationDestination(item: $openedAssignmentId) { id in
                if let assignment = assignments.first(where: { $0.id == id }) {
                    HomeworkDetailView(assignment: assignment)
                }
            }
            .sheet(isPresented: $showingGoal) {
                GoalSheet(
                    english: sectionTargets.english ?? 700,
                    math: sectionTargets.math ?? 700,
                    onSave: { english, math in await saveGoal(english: english, math: math) }
                )
                .presentationDetents([.height(430)])
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            PageTitle("Welcome back, \(current.firstName?.isEmpty == false ? current.firstName! : current.displayName)")
            Button {
                showingGoal = true
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "target")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.accent)
                    Text("Update goal").font(.system(size: 15, weight: .bold))
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.textLabel)
                }
                .foregroundStyle(.primary)
                .padding(.horizontal, 16)
                .padding(.vertical, 13)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Theme.card)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
                )
                .contentShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }

    private var homeworkSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            DotHeading(title: "Homework", count: dueSoon.count)
            ForEach(dueSoon) { assignment in
                NavigationLink {
                    HomeworkDetailView(assignment: assignment)
                } label: {
                    HomeworkRow(assignment: assignment).cardStyle()
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// Midterm scores.
    ///
    /// A classroom midterm is scored the moment it is submitted but stays sealed until the
    /// teacher publishes it, so an absent score is named rather than left blank — a blank
    /// reads as a zero.
    private var resultsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 9) {
                DotHeading(title: "Your results", count: results.count, tone: Theme.success)
                NavigationLink("See all") { MidtermsView() }
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.accent)
            }
            ForEach(results) { midterm in
                NavigationLink {
                    MidtermReportView(attemptId: midterm.attemptId ?? 0, title: midterm.title)
                } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(midterm.title)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(.primary)
                                .multilineTextAlignment(.leading)
                            if !midterm.subject.isEmpty {
                                Text(midterm.subject.humanisedSubject)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                        Spacer(minLength: 0)
                        if midterm.resultsVisible, let score = midterm.score {
                            VStack(alignment: .trailing, spacing: 0) {
                                Text(ScoreText.string(score))
                                    .font(.system(size: 24, weight: .heavy).monospacedDigit())
                                    .tracking(-0.6)
                                    .foregroundStyle(Theme.accent)
                                if let ceiling = midterm.scoreCeiling {
                                    Text("of \(ScoreText.string(ceiling))")
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundStyle(Theme.textSecondary)
                                }
                            }
                        } else {
                            Chip(text: "Not released", icon: "hourglass", tone: .warning)
                        }
                    }
                    .cardStyle()
                }
                .buttonStyle(.plain)
                .disabled(midterm.attemptId == nil)
            }
        }
    }

    // MARK: - Navigation out of the calendar

    private func open(_ event: ScheduleEvent) {
        // A calendar row for homework opens that homework. A class row has nothing deeper
        // to show on a phone, so an unmatched tap does nothing rather than pushing an
        // empty screen — the row still reads as information.
        guard let id = event.assignmentId, assignments.contains(where: { $0.id == id }) else { return }
        openedAssignmentId = id
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        loadError = nil
        let student = session.student
        async let homework = student.assignments()
        async let papers = student.midterms()
        async let dates = student.examDates()
        // The exam-date list is a nicety; losing it must not take the dashboard with it.
        examDates = (try? await dates) ?? []
        do {
            assignments = try await homework
            midterms = try await papers
            // Home is the screen a student opens most, so it is where the device's
            // reminders are kept in step with what they have actually been set. Rebuilding
            // the whole schedule is what lets a handed-in homework stop nagging.
            await session.notifications.reschedule(assignments: assignments, midterms: midterms)
            await session.notifications.announceResults(midterms: midterms)
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        await loadSchedule()
    }

    @MainActor
    private func loadSchedule() async {
        isLoading = true
        defer { isLoading = false }
        let (start, end) = ScheduleMonth.gridRange(year: viewYear, month: viewMonth)
        do {
            let events = try await session.student.schedule(from: start, to: end)
            month = ScheduleMonth.build(from: events)
            // Land on the next lesson the first time, so the day card below the calendar
            // is never empty on arrival.
            if selectedDay == nil { selectedDay = month.nextLessonDate }
        } catch {
            month = ScheduleMonth()
        }
    }

    @MainActor
    private func saveGoal(english: Int, math: Int) async {
        do {
            profile = try await session.student.updateProfile(targetEnglish: english, targetMath: math)
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }

    @MainActor
    private func saveExamDate(_ date: String?) async {
        savingExamDate = true
        defer { savingExamDate = false }
        do {
            profile = try await session.student.updateProfile(satExamDate: .some(date))
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }
}

// MARK: - Target scores

struct TargetScoresCard: View {
    let overall: Int?
    let english: Int?
    let math: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            CardHeading(icon: "target", title: "Target scores", subtitle: "Where you're aiming on test day")
            HStack(spacing: 10) {
                ScoreBox(label: "Overall", value: overall, emphasised: true)
                ScoreBox(label: "English", value: english)
                ScoreBox(label: "Math", value: math)
            }
        }
        .cardStyle(padding: 20)
    }
}

// MARK: - Countdown

/// The SAT countdown, ticking, on the site's own deep-blue panel.
struct CountdownCard: View {
    let examDate: String?
    let options: [ExamDateOption]
    let saving: Bool
    let onSelect: (String?) -> Void

    private var target: Date? {
        examDate.flatMap(DayKey.date(from:))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 9) {
                Image(systemName: "calendar").font(.system(size: 14, weight: .bold))
                Text("SAT COUNTDOWN").font(.system(size: 12, weight: .heavy)).tracking(1.6)
            }
            .foregroundStyle(.white.opacity(0.85))

            Group {
                if let target {
                    // Re-renders once a second and stops when the view is off-screen —
                    // a Timer publisher would keep ticking behind the other tabs.
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let remaining = max(0, target.timeIntervalSince(context.date))
                        if remaining <= 0 {
                            Text("It's exam day — you've got this!")
                                .font(.system(size: 24, weight: .heavy))
                                .tracking(-0.5)
                                .foregroundStyle(.white)
                                .fixedSize(horizontal: false, vertical: true)
                        } else {
                            HStack(spacing: 8) {
                                segment(Int(remaining) / 86_400, "days")
                                segment((Int(remaining) % 86_400) / 3600, "hrs", pad: true)
                                segment((Int(remaining) % 3600) / 60, "min", pad: true)
                                segment(Int(remaining) % 60, "sec", pad: true)
                            }
                        }
                    }
                } else {
                    Text("Pick your exam date to start the countdown.")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white.opacity(0.92))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.top, 22)

            picker.padding(.top, 16)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.accentDeep)
        // `allowsHitTesting(false)` is load-bearing, not tidiness: an overlay swallows
        // taps by default, and the bottom-left circle sits exactly over the date picker —
        // which is how this control silently stopped opening the first time it was built.
        .overlay(alignment: .topTrailing) {
            Circle().fill(.white.opacity(0.08)).frame(width: 160, height: 160).offset(x: 40, y: -40)
                .allowsHitTesting(false)
        }
        .overlay(alignment: .bottomLeading) {
            Circle().fill(.white.opacity(0.05)).frame(width: 130, height: 130).offset(x: -30, y: 50)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
    }

    private func segment(_ value: Int, _ label: String, pad: Bool = false) -> some View {
        VStack(spacing: 6) {
            Text(pad ? String(format: "%02d", value) : ScoreText.string(value))
                .font(.system(size: 28, weight: .heavy).monospacedDigit())
                .tracking(-0.8)
                .foregroundStyle(.white)
            Text(label.uppercased())
                .font(.system(size: 9, weight: .heavy))
                .tracking(1.2)
                .foregroundStyle(.white.opacity(0.7))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.white.opacity(0.08)))
    }

    private var picker: some View {
        Group {
            if options.isEmpty && examDate == nil {
                Text("No exam dates available yet — check back soon.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.7))
            } else {
                Menu {
                    Button("Not decided yet") { onSelect(nil) }
                    ForEach(options) { option in
                        Button(Self.label(option)) { onSelect(option.examDate) }
                    }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "calendar").font(.system(size: 13, weight: .semibold))
                        Text(currentLabel).font(.system(size: 14, weight: .bold)).lineLimit(1)
                        Spacer(minLength: 0)
                        if saving {
                            ProgressView().controlSize(.small).tint(.white)
                        } else {
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold))
                        }
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .frame(maxWidth: .infinity)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.white.opacity(0.12)))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(.white.opacity(0.28), lineWidth: 1)
                    )
                    .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .disabled(saving)
            }
        }
    }

    private var currentLabel: String {
        guard let examDate, let date = DayKey.date(from: examDate) else { return "Choose your exam date…" }
        // The chosen date may have dropped off the list (the server only offers upcoming
        // ones), so format it directly rather than looking it up and rendering blank.
        if let match = options.first(where: { $0.examDate == examDate }) { return Self.label(match) }
        return Self.formatted(date)
    }

    private static func label(_ option: ExamDateOption) -> String {
        guard let date = DayKey.date(from: option.examDate) else { return option.label }
        return option.label.isEmpty ? formatted(date) : "\(option.label) · \(formatted(date))"
    }

    private static func formatted(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("EEE MMM d yyyy")
        return f.string(from: date)
    }
}

// MARK: - Goal

/// The site's "Set your target score" popover, as a sheet.
struct GoalSheet: View {
    @State var english: Int
    @State var math: Int
    let onSave: (Int, Int) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var saving = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 22) {
                Text("Each section is 200–800.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)

                slider("Math score", value: $math)
                slider("English score", value: $english)

                HStack {
                    Text("Overall").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                    Text(ScoreText.string(english + math))
                        .font(.system(size: 18, weight: .heavy).monospacedDigit())
                        .foregroundStyle(Theme.accent)
                    Spacer()
                }

                Spacer()

                Button {
                    saving = true
                    Task {
                        await onSave(english, math)
                        saving = false
                        dismiss()
                    }
                } label: {
                    Text(saving ? "Saving…" : "Save goal")
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                .disabled(saving)
            }
            .padding(20)
            .background(Theme.background)
            .navigationTitle("Set your target score")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func slider(_ label: String, value: Binding<Int>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(label).font(.system(size: 14, weight: .semibold))
                Text(ScoreText.string(value.wrappedValue))
                    .font(.system(size: 14, weight: .heavy).monospacedDigit())
            }
            Slider(
                value: Binding(get: { Double(value.wrappedValue) }, set: { value.wrappedValue = Int($0) }),
                in: 200...800,
                step: 10
            )
            .tint(Theme.accent)
        }
    }
}

// MARK: - Shared

struct RetryNotice: View {
    let message: String
    /// Main-actor on purpose: every caller passes a closure that touches view state.
    let retry: @MainActor () async -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 26))
                .foregroundStyle(Theme.warning)
            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            Button("Try again") { Task { await retry() } }
                .buttonStyle(SecondaryButtonStyle())
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
    }
}
