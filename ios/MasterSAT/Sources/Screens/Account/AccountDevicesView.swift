import SwiftUI
import MasterSATKit

/// Settings › Devices: where the account is signed in right now, one row per device, this
/// phone first and marked. The web's `DevicesSection`.
///
/// The server cannot mark this phone (it looks for the web's refresh cookie), so the app finds
/// its own row itself — `DeviceSessionRules.thisDevice`. That is what lets it keep the web's
/// "Sign out of N other devices": the others are signed out one by one and this phone is left
/// alone. The server's own "keep this one" cannot work for the app, which is why it is not
/// used. When the phone's row cannot be told, that button is not offered at all — signing the
/// phone out by accident is worse than one button fewer.
///
/// "Sign out everywhere" includes this phone, says so before it runs, and signs out properly
/// afterwards instead of waiting for the next renewal to fail.
struct AccountDevicesView: View {
    @Environment(Session.self) private var session

    @State private var load: AccountLoadState<[DeviceSession]> = .loading
    @State private var thisDevice: Int?
    @State private var refreshing = false
    @State private var busyId: Int?
    @State private var busyOthers = false
    @State private var leaving = false
    @State private var confirmingEverywhere = false
    @State private var toast: RewardsToastMessage?

    private var account: AccountAPI { AccountAPI(client: session.client) }

    private var others: [DeviceSession] {
        DeviceSessionRules.others(in: load.value ?? [], thisDevice: thisDevice)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                AccountPageHeading(title: "Devices", description: "Where your account is signed in right now.") {
                    Button {
                        Task { await reload() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(AccountPillButtonStyle(kind: .quiet, tone: Theme.accent))
                    .disabled(refreshing || load.isLoading)
                }

                switch load {
                case .loading:
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 50)
                case .failed(let message):
                    // "No devices" here would tell a student nobody is signed in as them — the
                    // one thing this page exists to let them check.
                    RetryNotice(message: message) { await reload() }
                        .cardStyle()
                case .loaded(let sessions):
                    if sessions.isEmpty {
                        DashedEmpty(
                            title: "No signed-in devices to show.",
                            hint: "Sign in again and this one will appear."
                        )
                    } else {
                        VStack(spacing: 10) {
                            ForEach(sessions) { row in
                                deviceRow(row)
                            }
                        }
                    }
                    actions
                }
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if load.isLoading { await reload() }
        }
        .refreshable { await reload() }
        .confirmationDialog(
            "Sign out everywhere?",
            isPresented: $confirmingEverywhere,
            titleVisibility: .visible
        ) {
            Button("Sign out everywhere", role: .destructive) {
                Task { await signOutEverywhere() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This signs you out here too. You'll need to sign in again on every device.")
        }
        .rewardsToast($toast)
    }

    // MARK: Rows

    private func deviceRow(_ row: DeviceSession) -> some View {
        let device = DeviceDescription.describe(userAgent: row.userAgent)
        let isThis = row.id == thisDevice
        let seen = isThis ? "Active now" : DeviceActivity.lastActiveLabel(row.lastSeenAt ?? row.createdAt)
        let detail = [seen, row.ip].filter { !$0.isEmpty }.joined(separator: " · ")
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                IconTile(systemName: Self.icon(for: device.kind), tone: isThis ? Theme.success : Theme.info, size: 38)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 7) {
                        Text(verbatim: device.label)
                            .font(.system(size: 15, weight: .heavy))
                            .lineLimit(1)
                        if isThis { AccountStatusPill(text: "This device", tone: Theme.success) }
                    }
                    Text(verbatim: detail)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            if !isThis {
                Button {
                    Task { await signOut(row, label: device.label) }
                } label: {
                    Label(busyId == row.id ? "Signing out…" : "Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                }
                .buttonStyle(AccountPillButtonStyle(kind: .quiet, tone: Theme.danger))
                .disabled(busyId != nil || busyOthers || leaving)
                .padding(.leading, 42)
            }
        }
        .cardStyle(padding: 14)
    }

    private static func icon(for kind: DeviceKind) -> String {
        switch kind {
        case .phone: return "iphone"
        case .tablet: return "ipad"
        case .computer: return "laptopcomputer"
        case .app: return "apps.iphone"
        }
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Don't recognise a device? Sign it out and change your password. A device you sign out stops within a few hours, the next time it renews its sign-in.")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                if !others.isEmpty {
                    Button {
                        Task { await signOutOthers() }
                    } label: {
                        Label(
                            busyOthers ? "Signing out…" : AccountCopy.signOutOthersLabel(others.count),
                            systemImage: "rectangle.portrait.and.arrow.right"
                        )
                    }
                    .buttonStyle(AccountPillButtonStyle(kind: .soft, tone: Theme.danger))
                    .disabled(busyOthers || busyId != nil || leaving)
                }
                Button {
                    confirmingEverywhere = true
                } label: {
                    Text(leaving ? "Signing out…" : "Sign out everywhere")
                }
                .buttonStyle(AccountPillButtonStyle(kind: .quiet, tone: Theme.danger))
                .disabled(leaving || busyOthers || busyId != nil)
                Spacer(minLength: 0)
            }
        }
        .padding(.top, 4)
    }

    // MARK: Loading

    private func reload() async {
        refreshing = true
        defer { refreshing = false }
        // A refresh keeps the rows on screen; only a first load (or one after a failure)
        // shows the spinner.
        if load.value == nil { load = .loading }
        do {
            let rows = try await account.sessions()
            let token = await account.heldRefreshToken()
            let mine = DeviceSessionRules.thisDevice(in: rows, refreshToken: token)
            thisDevice = mine
            load = .loaded(DeviceSessionRules.ordered(rows, thisDevice: mine))
        } catch {
            load = .failed("Your devices didn't load. Your account is unaffected — only this list failed to load.")
        }
    }

    private func remove(_ id: Int) {
        guard let rows = load.value else { return }
        load = .loaded(rows.filter { $0.id != id })
    }

    // MARK: Signing out

    private func signOut(_ row: DeviceSession, label: String) async {
        guard busyId == nil else { return }
        busyId = row.id
        defer { busyId = nil }
        do {
            try await account.revokeSession(id: row.id)
            remove(row.id)
            toast = .accountSuccess(AccountCopy.deviceSignedOut(label))
        } catch APIError.http(let status, _) where status == 404 {
            // Already gone — signed out elsewhere, or it expired. The outcome asked for.
            remove(row.id)
            toast = .accountSuccess(AccountCopy.deviceSignedOut(label))
        } catch {
            toast = .accountNotice(AccountCopy.deviceSignOutFailed)
        }
    }

    /// Every device but this phone, one request each. Never retried on its own: what failed
    /// is still on the list after the reload, with its own Sign out button.
    private func signOutOthers() async {
        let targets = others
        guard !targets.isEmpty, !busyOthers else { return }
        busyOthers = true
        defer { busyOthers = false }
        var signedOut = 0
        var failed = 0
        for row in targets {
            do {
                try await account.revokeSession(id: row.id)
                signedOut += 1
            } catch APIError.http(let status, _) where status == 404 {
                signedOut += 1
            } catch {
                failed += 1
            }
        }
        toast = failed == 0
            ? .accountSuccess(AccountCopy.othersSignedOut(signedOut))
            : .accountNotice(AccountCopy.othersSignOutFailed)
        await reload()
    }

    /// Every session goes, this phone's included — so finish by signing out here properly.
    private func signOutEverywhere() async {
        guard !leaving else { return }
        leaving = true
        do {
            try await account.revokeAllSessions()
        } catch {
            leaving = false
            toast = .accountNotice(AccountCopy.everywhereFailed)
            return
        }
        await session.signOut()
    }
}
