import SwiftUI
import MasterSATKit

/// Whether this build may still be used, and whether a newer one is worth mentioning.
///
/// Two sources, and the stricter wins: the policy the app reads at launch and on every return
/// to the foreground (`/api/mobile/config/`), and a 426 from any request at all, which is the
/// server refusing this build mid-session because the minimum went up while it was open.
@MainActor
@Observable
final class ReleaseGate {
    private(set) var config: ClientConfig?
    private(set) var requirement: UpdateRequirement = .none
    /// The gentle "a new version is out" card, when it is due. See `UpdateNudge`.
    private(set) var showsNudge = false

    private var lastCheck: Date?
    private let defaults: UserDefaults
    /// Re-checking on every foreground would be a request per glance at the phone. Half an
    /// hour is plenty for a policy that changes a few times a year.
    private let recheckInterval: TimeInterval = 30 * 60

    private enum Key {
        static let nudgedVersion = "release.nudgedVersion"
        static let nudgedAt = "release.nudgedAt"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var isBlocked: Bool { requirement == .required }

    func check(using mobile: MobileAPI, force: Bool = false) async {
        if !force, let lastCheck, Date().timeIntervalSince(lastCheck) < recheckInterval { return }
        do {
            let fresh = try await mobile.config(version: AppInfo.version, build: AppInfo.build)
            lastCheck = Date()
            apply(fresh)
        } catch {
            // Offline or deploying: keep whatever was known. A failed check must never block —
            // and must never UNblock a build the server already refused.
        }
    }

    /// A 426 from anywhere. The details come with the refusal, so no round trip is needed to
    /// show the update screen.
    func noteRefusal(_ error: APIError) {
        guard case .upgradeRequired(let detail, let minimum, let url) = error else { return }
        config = ClientConfig(
            latestVersion: config?.latestVersion,
            minimumVersion: minimum ?? config?.minimumVersion,
            updateURL: url ?? config?.updateURL,
            message: detail.isEmpty ? config?.message : detail,
            update: "required"
        )
        requirement = .required
        showsNudge = false
    }

    func dismissNudge() {
        showsNudge = false
        defaults.set(config?.latestVersion, forKey: Key.nudgedVersion)
        defaults.set(Date(), forKey: Key.nudgedAt)
    }

    private func apply(_ fresh: ClientConfig) {
        // Assign only what changed: an @Observable property notifies on every write, and a
        // re-check every half hour that rewrote identical values would re-render every screen
        // that reads the gate.
        if config != fresh { config = fresh }
        let verdict = fresh.requirement(for: AppVersion(AppInfo.version))
        if requirement != verdict { requirement = verdict }
        let nudge = verdict == .available && UpdateNudge.shouldShow(
            latest: fresh.latestVersion,
            lastShownVersion: defaults.string(forKey: Key.nudgedVersion),
            lastShownAt: defaults.object(forKey: Key.nudgedAt) as? Date
        )
        if showsNudge != nudge { showsNudge = nudge }
    }
}

/// The whole screen, when this build is below the minimum.
///
/// It says what happened and what to do, and it says the work is safe — the first thing a
/// student wonders when an app stops is whether it took their answers with it.
struct UpdateRequiredView: View {
    let config: ClientConfig?
    let onCheckAgain: () async -> Void

    @Environment(\.openURL) private var openURL
    @State private var checking = false

    private var message: String {
        if let message = config?.message, !message.isEmpty { return message }
        return "This version of MasterSAT is no longer supported. Update to keep going — nothing you've done is lost."
    }

    var body: some View {
        // The front-door look (mockup 94, right): the sign-in's blue top, the update glyph on the
        // band's edge, the version line only when the server gives a minimum.
        StateScreen(
            medal: StateMedal.blue("arrow.down.app.fill"),
            title: "Time to update",
            message: message
        ) {
            if let minimum = config?.minimumVersion, !minimum.isEmpty {
                Text("You have \(AppInfo.version). You need \(minimum) or newer.")
                    .appFont(13, weight: .semibold)
                    .foregroundStyle(NewLook.muted)
                    .multilineTextAlignment(.center)
            }
        } actions: {
            if let url = config?.storeURL {
                Button {
                    openURL(url)
                } label: {
                    Label("Update", systemImage: "arrow.down.to.line").frame(maxWidth: .infinity)
                }
                .buttonStyle(NewLookButtonStyle(kind: .primary, size: .large))
            } else {
                Text("Open the App Store and search for MasterSAT.")
                    .appFont(14, weight: .semibold)
                    .foregroundStyle(NewLook.ink4)
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 4)
            }

            Button {
                checking = true
                Task {
                    await onCheckAgain()
                    checking = false
                }
            } label: {
                Group {
                    if checking { ProgressView().tint(NewLook.blueDeep) } else { Text("Check again") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(NewLookButtonStyle(kind: .tint, size: .large))
            .disabled(checking)
            .accessibilityLabel(checking ? "Checking again" : "Check again")
        }
    }
}

/// The gentle version: a card, not a wall. Once per new version, then every few days at most.
struct UpdateNudgeCard: View {
    let config: ClientConfig?
    let onDismiss: () -> Void

    @Environment(\.openURL) private var openURL

    private var message: String {
        if let message = config?.message, !message.isEmpty { return message }
        if let latest = config?.latestVersion, !latest.isEmpty {
            return "Update MasterSAT to \(latest) for the newest features and fixes."
        }
        return "Update MasterSAT for the newest features and fixes."
    }

    var body: some View {
        // A card on Today in the new look (mockup 94's note): a tile, Archivo, the kit's buttons.
        HStack(alignment: .top, spacing: 12) {
            NewLookTile(systemName: "sparkles")
            VStack(alignment: .leading, spacing: 6) {
                Text("A new version is out")
                    .appDisplayFont(17)
                    .tracking(-0.3)
                    .foregroundStyle(NewLook.ink)
                Text(message)
                    .appFont(13, weight: .medium)
                    .foregroundStyle(NewLook.ink4)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    if let url = config?.storeURL {
                        Button("Update") { openURL(url) }
                            .buttonStyle(NewLookButtonStyle(kind: .primary))
                    }
                    Button("Not now", action: onDismiss)
                        .buttonStyle(NewLookButtonStyle(kind: .tint))
                }
                .padding(.top, 4)
            }
            Spacer(minLength: 0)
        }
        .newLookCard(padding: 16)
    }
}
