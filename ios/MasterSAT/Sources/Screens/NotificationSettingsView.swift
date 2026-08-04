import SwiftUI
import MasterSATKit

/// What the phone is allowed to interrupt you for.
///
/// Three switches, not one: a student who wants to know about a midterm may not want a
/// nudge about every reading set, and collapsing that into a single "notifications" toggle
/// makes the only way to silence one thing silencing all of it.
struct NotificationSettingsView: View {
    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var kinds: Set<StudentReminder.Kind> = []

    private var service: NotificationService { session.notifications }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroHeader(
                    eyebrow: "Reminders",
                    eyebrowIcon: "bell.badge",
                    title: "Notifications",
                    blurb: "A nudge before something is due, and a word when a score comes out.",
                    tiles: [HeroTile("Scheduled", icon: "clock", value: service.pendingCount)]
                ) { EmptyView() }
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))

                permissionCard

                VStack(alignment: .leading, spacing: 10) {
                    CardHeading(
                        icon: "slider.horizontal.3",
                        title: "What to be told about",
                        subtitle: "Each one can be switched off on its own.",
                        tone: Theme.accent
                    )
                    ForEach(StudentReminder.Kind.allCases, id: \.self) { kind in
                        Toggle(isOn: binding(for: kind)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(label(kind)).font(.system(size: 15, weight: .bold))
                                Text(explanation(kind))
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Theme.textSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .tint(Theme.accent)
                        .disabled(service.permission != .granted)
                        .cardStyle(padding: 14)
                    }
                }

                Text("Reminders are set on this phone from your own homework and midterm dates — nothing is sent from a server, so they work offline. A score published while the app is closed is announced the next time you open it.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            kinds = service.enabledKinds
            await service.refreshPermission()
        }
        // Coming back from Settings is the one moment permission can have changed without
        // the app doing anything, so it is re-read rather than trusted.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await service.refreshPermission() } }
        }
    }

    @ViewBuilder
    private var permissionCard: some View {
        switch service.permission {
        case .notAsked, .unknown:
            VStack(alignment: .leading, spacing: 12) {
                CardHeading(
                    icon: "bell.badge",
                    title: "Turn on reminders",
                    subtitle: "iOS asks once. You can change it later in Settings.",
                    tone: Theme.accent
                )
                Button {
                    Task {
                        await service.requestPermission()
                        await rescheduleNow()
                    }
                } label: {
                    Text("Allow notifications").frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            }
            .cardStyle()

        case .granted:
            HStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.success)
                Text("Notifications are on")
                    .font(.system(size: 15, weight: .bold))
                Spacer(minLength: 0)
                Chip(text: "\(ScoreText.string(service.pendingCount)) set", tone: .success)
            }
            .cardStyle()

        case .denied:
            VStack(alignment: .leading, spacing: 12) {
                CardHeading(
                    icon: "bell.slash",
                    title: "Notifications are off",
                    // iOS will not ask a second time; saying so stops a student tapping a
                    // button that can no longer do anything.
                    subtitle: "iOS only asks once, so this has to be switched on in Settings.",
                    tone: Theme.warning
                )
                Button {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    Text("Open Settings").frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle(fullWidth: true))
            }
            .cardStyle()
        }
    }

    private func binding(for kind: StudentReminder.Kind) -> Binding<Bool> {
        Binding(
            get: { kinds.contains(kind) },
            set: { on in
                if on { kinds.insert(kind) } else { kinds.remove(kind) }
                service.enabledKinds = kinds
                Task { await rescheduleNow() }
            }
        )
    }

    /// Applying a switch means rebuilding the schedule, not waiting for the next visit to
    /// Home — a toggle that does nothing until tomorrow reads as a broken toggle.
    private func rescheduleNow() async {
        let assignments = (try? await session.student.assignments()) ?? []
        let midterms = (try? await session.student.midterms()) ?? []
        await service.reschedule(assignments: assignments, midterms: midterms)
    }

    private func label(_ kind: StudentReminder.Kind) -> String {
        switch kind {
        case .homework: return "Homework"
        case .midterm: return "Midterms"
        case .results: return "Scores"
        }
    }

    private func explanation(_ kind: StudentReminder.Kind) -> String {
        switch kind {
        case .homework: return "The day before something is due, and three hours before."
        case .midterm: return "The day before a paper, and an hour before it opens."
        case .results: return "When a teacher publishes a midterm score."
        }
    }
}

/// The soft prompt on Home.
///
/// It exists because iOS asks exactly once per install and a refusal is permanent. Spending
/// that single chance on a student who has just signed in and has no idea what the app
/// wants to tell them is how an app ends up with notifications it can never turn on.
struct ReminderPromptCard: View {
    let onEnable: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 13) {
                IconTile(systemName: "bell.badge", tone: Theme.accent, size: 42)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Never miss a deadline")
                        .font(.system(size: 16, weight: .heavy))
                    Text("Get a nudge before homework is due and before a midterm starts.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 10) {
                Button("Not now", action: onDismiss)
                    .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                Button("Turn on", action: onEnable)
                    .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            }
        }
        .cardStyle()
    }
}
