import SwiftUI
import MasterSATKit

/// Settings › About: which build this is, and whose.
///
/// The site links no privacy policy, terms or contact page anywhere — not in its footer, not in
/// the account menu, not on the sign-in pages — so none is invented here. What a student is
/// asked for when something goes wrong is the version, so that comes first.
struct AccountAboutView: View {
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL

    private var site: URL { session.client.config.baseURL }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                AccountPageHeading(title: "About", description: "This app, and the learning center behind it.")

                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 14) {
                        BrandMark(height: 44, tint: Theme.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("MasterSAT")
                                .font(.system(size: 20, weight: .heavy))
                                .tracking(-0.4)
                            Text(verbatim: "Version \(AppInfo.version)")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        Spacer(minLength: 0)
                    }
                    updateStatus
                }
                .cardStyle(padding: 18)

                VStack(alignment: .leading, spacing: 0) {
                    DetailRow(label: "Learning center", value: "MasterSAT")
                    Divider()
                    Button {
                        openURL(site)
                    } label: {
                        HStack(spacing: 12) {
                            Text("Website")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                            Spacer(minLength: 0)
                            Text(verbatim: site.host() ?? site.absoluteString)
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(Theme.accent)
                            Image(systemName: "arrow.up.right")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(Theme.accent)
                        }
                        .padding(.vertical, 11)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .cardStyle(padding: 16)

                VStack(alignment: .leading, spacing: 0) {
                    DetailRow(label: "App version", value: AppInfo.version)
                    Divider()
                    DetailRow(label: "Build", value: AppInfo.build)
                    Divider()
                    DetailRow(label: "System", value: AppInfo.osVersion)
                    Divider()
                    DetailRow(label: "Device", value: AppInfo.deviceModel)
                }
                .cardStyle(padding: 16)

                Text("Your learning center may ask for these if something isn't working.")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Only what the server's release policy says, and only once it has said it.
    @ViewBuilder
    private var updateStatus: some View {
        let gate = session.releaseGate
        if let config = gate.config {
            switch gate.requirement {
            case .none:
                Label("You're on the latest version.", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.success)
            case .available, .required:
                HStack(spacing: 10) {
                    Label(
                        config.latestVersion.map { "Version \($0) is available." } ?? "A newer version is available.",
                        systemImage: "arrow.down.circle.fill"
                    )
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    Spacer(minLength: 0)
                    if let url = config.storeURL {
                        Button("Update") { openURL(url) }
                            .buttonStyle(AccountPillButtonStyle(kind: .solid, tone: Theme.accent))
                    }
                }
            }
        }
    }
}
