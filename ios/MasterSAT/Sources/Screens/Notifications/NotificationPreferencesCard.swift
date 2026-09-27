import SwiftUI
import MasterSATKit

/// The student's switches for the server's notifications — the web's
/// `NotificationPreferencesCard`: one switch per inbox section, each with the web's line on why
/// a student might want it, then "Push to my phone".
///
/// The server stores only what is switched OFF, so a section added to the platform later
/// arrives switched on. Each change is its own PATCH, and the answer — the whole new state — is
/// written straight back. A switch moves the moment it is touched and moves back if the save
/// fails, with a sentence saying so; while a save is out, the switches wait for it.
///
/// Four states, like the web: loading, the switches, "No sections to set yet", and a failure —
/// which never reads as "nothing to configure", because that would tell a student they have no
/// choices, the opposite of what this card is for.
struct NotificationPreferencesCard: View {
    @Environment(Session.self) private var session

    @State private var prefs: NotificationPreferences?
    @State private var pushConfig: PushConfig?
    @State private var failed = false
    @State private var saving = false
    @State private var saveFailed = false

    private var api: NotificationsAPI { NotificationsAPI(client: session.client) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            CardHeading(
                icon: "bell.and.waves.left.and.right",
                title: "Notifications",
                subtitle: "Choose what reaches you. You can change these whenever you like.",
                tone: Theme.info
            )

            sections

            // Outside the four states above: it belongs to the same answer but is a different
            // question — the bell and the buzz are separate, and a student may want every
            // section on screen and none of them on their phone.
            if let prefs, !failed {
                pushRow(prefs)
            }

            if saveFailed {
                Text("That didn't save. Your settings are unchanged — try again.")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .cardStyle()
        .task { await load() }
    }

    // MARK: - Pieces

    @ViewBuilder private var sections: some View {
        if let prefs {
            if prefs.categories.isEmpty {
                DashedEmpty(
                    title: "No sections to set yet",
                    hint: "Notification sections will appear here as the platform adds them."
                )
            } else {
                VStack(spacing: 8) {
                    ForEach(prefs.categories) { section in
                        sectionRow(section, on: prefs.isOn(section.value))
                    }
                }
            }
        } else if failed {
            VStack(alignment: .leading, spacing: 10) {
                Text("Couldn't load your notification settings.")
                    .font(.system(size: 14, weight: .bold))
                Text("Nothing has changed — only this panel failed to load.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Try again") { Task { await load() } }
                    .buttonStyle(SecondaryButtonStyle())
            }
        } else {
            VStack(spacing: 8) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Theme.surface2)
                        .frame(height: 60)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Loading notification settings")
        }
    }

    private func sectionRow(_ section: NotificationCategoryOption, on: Bool) -> some View {
        let hint = NotificationCategoryLook.hint(for: section.value)
        return Toggle(isOn: Binding(get: { on }, set: { setSection(section.value, on: $0) })) {
            HStack(spacing: 12) {
                IconTile(
                    systemName: NotificationCategoryLook.icon(for: section.value),
                    tone: NotificationCategoryLook.tone(for: section.value),
                    size: 36
                )
                // Off is a paler version of the same tile, never grey: the row is still there
                // to be turned back on.
                .opacity(on ? 1 : 0.6)
                VStack(alignment: .leading, spacing: 2) {
                    Text(section.label)
                        .font(.system(size: 14, weight: .heavy))
                    if let hint {
                        Text(hint)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .tint(Theme.accent)
        .disabled(saving)
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Theme.accent.opacity(on ? 0.05 : 0.02))
        )
        // Named once for VoiceOver, as the web names it — not "Grades … Grades".
        .accessibilityLabel("\(section.label) notifications")
        .accessibilityHint(hint ?? "")
    }

    private func pushRow(_ prefs: NotificationPreferences) -> some View {
        // The app's transport is APNs. With it off on the server the switch would promise what
        // nothing can deliver, so it is disabled — but not hidden: a student who turned push
        // off last term should still see that they did.
        let serverCannotPush = pushConfig?.apnsEnabled == false
        let buildCannotPush = PushRegistrar.shared.status == .notInThisBuild
        return Toggle(isOn: Binding(get: { prefs.pushEnabled }, set: { setPush($0) })) {
            HStack(spacing: 12) {
                IconTile(systemName: "iphone", tone: Theme.accent, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Push to my phone")
                        .font(.system(size: 14, weight: .heavy))
                    Text(serverCannotPush
                         ? "Push isn't switched on for the app yet — the bell still works."
                         : "Only the important ones: marks, homework and support sessions.")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if !serverCannotPush, buildCannotPush {
                        Text("This version of the app can't receive push — the bell still works.")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.textLabel)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .tint(Theme.accent)
        .disabled(saving || serverCannotPush)
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Theme.accent.opacity(0.04))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Theme.accent.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        )
        .accessibilityLabel("Push notifications")
    }

    // MARK: - Loading and saving

    private func load() async {
        let api = self.api
        async let preferences = api.preferences()
        async let config = api.pushConfig()
        do {
            prefs = try await preferences
            failed = false
        } catch {
            // A reload that fails keeps the switches already on screen.
            failed = prefs == nil
        }
        // Only decides whether the push switch can be used; the card works without it.
        if let loaded = try? await config { pushConfig = loaded }
    }

    private func setSection(_ category: String, on: Bool) {
        guard let current = prefs, !saving else { return }
        let muted = current.mutedList(setting: category, on: on)
        var next = current
        next.mutedCategories = muted
        prefs = next
        Task { await save(NotificationPreferencesPatch(mutedCategories: muted), previous: current) }
    }

    private func setPush(_ on: Bool) {
        guard let current = prefs, !saving else { return }
        var next = current
        next.pushEnabled = on
        prefs = next
        Task { await save(NotificationPreferencesPatch(pushEnabled: on), previous: current) }
    }

    private func save(_ patch: NotificationPreferencesPatch, previous: NotificationPreferences) async {
        saving = true
        saveFailed = false
        defer { saving = false }
        let api = self.api
        do {
            prefs = try await api.updatePreferences(patch)
        } catch {
            prefs = previous
            saveFailed = true
            return
        }
        // Muting a section changes what the bell should be counting.
        if let summary = try? await api.summary() {
            session.notifications.applyUnread(summary)
        }
    }
}
