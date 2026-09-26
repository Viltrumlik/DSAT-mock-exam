import SwiftUI
import UIKit
import MasterSATKit

/// What a student reads before they are given a way into the class Telegram group — the
/// site's join dialog, as a sheet.
///
/// Two steps, and the student is only ever shown the one they are on: meet the bot, then
/// take the link. Meeting the bot is not a formality — until somebody presses Start on a
/// link cut for their account, the site cannot recognise them at the group door. That is
/// also what makes the invite deliverable, since a bot may only message people who have
/// messaged it first.
///
/// The rules come from the server, because the bot enforces them and the two must not drift.
struct ClassroomTelegramSheet: View {
    let classroomId: Int
    let className: String
    let initialState: TelegramGroupState?
    /// The latest state, for the header button ("Telegram group" once joined).
    let onChange: (TelegramGroupState) -> Void

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    @State private var state: TelegramGroupState?
    @State private var loadFailed = false
    @State private var isLoading = false

    // Step 1 — the bot link. Minted once per sheet opening, never once per render: the
    // token is single-use and spends its predecessor.
    @State private var botLink: String?
    @State private var botLinkFailed = false
    @State private var isMintingBotLink = false
    @State private var didMintBotLink = false

    // Step 2 — the invite.
    @State private var isJoining = false
    @State private var joinError: String?
    @State private var joinReply: TelegramGroupState?
    @State private var copied = false

    private var api: ClassroomTelegramAPI { ClassroomTelegramAPI(client: session.client) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        // Verbatim: a class name is not markdown.
                        Label {
                            Text(verbatim: "Join the \(className) Telegram group")
                        } icon: {
                            Image(systemName: "paperplane.fill").foregroundStyle(Theme.info)
                        }
                            .font(.system(size: 20, weight: .heavy))
                            .foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Read this first — the invite you get is yours alone.")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                    }

                    // Four branches, and they are exclusive. A refetch that fails while a
                    // state is on screen must not paint "could not load" over an invite that
                    // works — it becomes a line saying the screen may be out of date.
                    if let state {
                        if loadFailed {
                            Text("Could not refresh just now — this is the last state we know of.")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        rules(state.rules)
                        step(state)
                    } else if loadFailed {
                        ClassroomErrorState(
                            title: "Could not load the group",
                            message: "Something went wrong reading this class's Telegram group."
                        ) { await load() }
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                    }
                }
                .padding(20)
            }
            .background(Theme.background)
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task {
            if state == nil { state = initialState }
            await load()
        }
        // The student presses Start in Telegram and comes back: that is when the sheet must
        // notice they are now connected.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await load() } }
        }
        .task(id: needsBot) {
            guard needsBot, !didMintBotLink else { return }
            didMintBotLink = true
            await mintBotLink()
        }
    }

    private var needsBot: Bool { state?.step == .openBot }

    // MARK: - Pieces

    private func rules(_ rules: [String]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(rules.enumerated()), id: \.offset) { index, rule in
                HStack(alignment: .top, spacing: 12) {
                    Text(ScoreText.string(index + 1))
                        .font(.system(size: 11, weight: .heavy))
                        .frame(width: 22, height: 22)
                        .background(Circle().fill(Theme.surface2))
                    Text(rule)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    @ViewBuilder
    private func step(_ state: TelegramGroupState) -> some View {
        switch state.step {
        case .notEligible(let message):
            // Frozen, or no longer in the class: say why, offer nothing.
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.amberSoft))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Theme.amber.opacity(0.4), lineWidth: 1)
                )
        case .nothing:
            EmptyView()
        case .openBot:
            box {
                Text("Step 1 — open the MasterSAT bot").font(.system(size: 14, weight: .bold))
                Text("Press **Start** there once. The bot learns which Telegram account is yours, and your invite arrives in that chat — you do not need to come back here.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if isMintingBotLink {
                    ProgressView().padding(.top, 4)
                } else if let botLink, let url = URL(string: botLink) {
                    Button { openURL(url) } label: {
                        Label("Open the bot", systemImage: "arrow.up.right.square")
                    }
                    .buttonStyle(PrimaryButtonStyle(tone: Theme.info))
                    .padding(.top, 4)
                } else if botLinkFailed {
                    Text("The Telegram bot cannot be reached right now. Please try again shortly.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                    Button("Try again") { Task { await mintBotLink() } }
                        .buttonStyle(SecondaryButtonStyle())
                }
            }
        case .inviteReady(let link):
            box {
                Text("Your invite is ready").font(.system(size: 14, weight: .bold))
                Text("It works once, for your Telegram account only, and expires in about \(state.inviteTTLMinutes) minutes.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    Button {
                        if let url = URL(string: link) { openURL(url) }
                    } label: {
                        Label("Open in Telegram", systemImage: "arrow.up.right.square")
                    }
                    .buttonStyle(PrimaryButtonStyle(tone: Theme.info))
                    Button {
                        UIPasteboard.general.string = link
                        copied = true
                        Task {
                            try? await Task.sleep(for: .seconds(2))
                            copied = false
                        }
                    } label: {
                        Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                .padding(.top, 4)
            }
        case .getLink:
            box {
                Label("Telegram connected", systemImage: "checkmark.shield.fill")
                    .font(.system(size: 14, weight: .bold))
                Text(state.isJoined
                     ? "You are already in the group. Get a new link only if you have left it."
                     : "Press below and the bot will cut you a single-use invite, here and in your Telegram chat with it.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button(action: join) {
                    HStack(spacing: 8) {
                        if isJoining { ProgressView().tint(.white) }
                        Label(state.isJoined ? "Get a new link" : "Get my invite link", systemImage: "paperplane.fill")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                // Minting is not idempotent and shares a 10-an-hour throttle: one at a time.
                .disabled(isJoining)
                .padding(.top, 4)
                if let joinError {
                    Text(joinError)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if joinReply?.alreadyMember == true, (joinReply?.inviteLink ?? "").isEmpty {
                    Text("You are already in the group — no new link was needed.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
    }

    private func box<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.card))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
            )
    }

    // MARK: - Calls

    @MainActor
    private func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let fresh = try await api.state(classroomId: classroomId)
            state = fresh
            loadFailed = false
            onChange(fresh)
        } catch {
            loadFailed = true
        }
    }

    @MainActor
    private func mintBotLink() async {
        guard !isMintingBotLink else { return }
        isMintingBotLink = true
        botLinkFailed = false
        defer { isMintingBotLink = false }
        do {
            botLink = try await api.botLink(classroomId: classroomId)
        } catch {
            botLink = nil
            botLinkFailed = true
        }
    }

    @MainActor
    private func join() {
        guard !isJoining else { return }
        isJoining = true
        joinError = nil
        Task {
            defer { isJoining = false }
            do {
                // The reply IS the new state; showing it beats a reload racing the link.
                let reply = try await api.join(classroomId: classroomId)
                joinReply = reply
                state = reply
                onChange(reply)
            } catch {
                joinError = Self.message(for: error)
            }
        }
    }

    /// The server's own sentence where it sends one. A gateway failure carries none (and a
    /// 503 may be Telegram being unset or the site deploying), so it gets its own.
    static func message(for error: Error) -> String {
        switch error as? APIError {
        case .unavailable?:
            return "Telegram could not be reached just now. Try again in a moment."
        case let apiError?:
            return apiError.errorDescription ?? "Telegram could not complete the request. Try again in a moment."
        case nil:
            return error.localizedDescription
        }
    }
}
