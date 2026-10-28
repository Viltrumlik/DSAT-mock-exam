import SwiftUI
import MasterSATKit

/// The site's `/live`: type the code the teacher is showing, or go back into a quiz already
/// running in one of the student's classes (`JoinLiveQuiz.tsx`).
///
/// Mount as `LiveQuizJoinView()`, pushed onto a tab's navigation stack. Needs `Session` from
/// the environment. The game opens full-screen over it (`LiveQuizGameView`).
struct LiveQuizJoinView: View {
    @Environment(Session.self) private var session
    @State private var model: LiveQuizJoinModel?

    var body: some View {
        Group {
            if let model {
                LiveQuizJoinScreen(model: model)
            } else {
                NewLook.page
            }
        }
        .background(NewLook.page.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if model == nil { model = LiveQuizJoinModel(api: LiveQuizAPI(client: session.client)) }
        }
    }
}

/// A game to open: from `join/`, or a row of the running list.
struct LiveQuizLaunch: Identifiable, Equatable {
    let sessionId: Int
    let participantId: Int?
    let title: String

    var id: Int { sessionId }
}

@MainActor
@Observable
final class LiveQuizJoinModel {
    enum Running: Equatable {
        case loading
        case loaded([LiveQuizSummary])
        case failed
        /// `LIVE_QUIZ_ENABLED` is off on the server: there is nothing to join.
        case featureOff
    }

    private let api: LiveQuizAPI

    /// Always normalised: upper-case letters and digits, at most six.
    private(set) var code = ""
    private(set) var joining = false
    private(set) var joinError: String?
    private(set) var running: Running = .loading
    var presented: LiveQuizLaunch?

    init(api: LiveQuizAPI) {
        self.api = api
    }

    var canJoin: Bool { LiveQuizCode.isComplete(code) && !joining }

    func setCode(_ raw: String) {
        let normalised = LiveQuizCode.normalized(raw)
        guard normalised != code else { return }
        code = normalised
        joinError = nil
    }

    /// Join by code. Safe to repeat: joining twice hands back the same place.
    func join() async {
        guard canJoin else { return }
        joining = true
        joinError = nil
        defer { joining = false }
        do {
            let joined = try await api.join(code: code)
            code = ""
            presented = LiveQuizLaunch(
                sessionId: joined.session.id,
                participantId: joined.participantId,
                title: joined.session.title
            )
        } catch {
            if let refusal = error as? LiveQuizRefusal, refusal.reason == .featureOff {
                running = .featureOff
            }
            // The server's own sentence: "That code does not match a live quiz."
            joinError = LiveQuizErrorText.message(error, fallback: "Couldn't join that quiz. Try again.")
        }
    }

    /// Back into a room already running. There is no join-by-id, so this only works for a
    /// student who joined it before; the game screen explains when they did not.
    func open(_ summary: LiveQuizSummary) {
        presented = LiveQuizLaunch(sessionId: summary.id, participantId: nil, title: summary.title)
    }

    /// The running list. A list already on screen stays if a later read fails.
    func loadRunning() async {
        if running == .failed { running = .loading }
        do {
            running = .loaded(try await api.mine())
        } catch let refusal as LiveQuizRefusal where refusal.reason == .featureOff {
            running = .featureOff
        } catch {
            if case .loaded = running { return }
            running = .failed
        }
    }
}

private struct LiveQuizJoinScreen: View {
    @Environment(Session.self) private var session
    @Environment(CelebrationCenter.self) private var celebrations
    @Bindable var model: LiveQuizJoinModel
    @FocusState private var codeFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                NewLookPageTitle(title: "Live quiz", subtitle: "Enter the code your teacher is showing.")
                    .padding(.bottom, 4)

                if model.running == .featureOff {
                    featureOff
                } else {
                    codeCard
                    runningCard
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 16)
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity)
        }
        .background(NewLook.page)
        .detachedRefresh { await model.loadRunning() }
        // The web re-reads the list every 15 s; so does this, while the screen is up and no
        // game is open over it.
        .task {
            while !Task.isCancelled {
                if model.presented == nil { await model.loadRunning() }
                try? await Task.sleep(for: .seconds(15))
            }
        }
        .fullScreenCover(item: $model.presented) { launch in
            LiveQuizGameView(sessionId: launch.sessionId, participantId: launch.participantId, title: launch.title) {
                model.presented = nil
            }
            .environment(session)
            .coversCelebrations(celebrations)
            .noBarClearance()
        }
        .onChange(of: model.presented) { _, presented in
            // Back from a game: the list has moved on.
            if presented == nil { Task { await model.loadRunning() } }
        }
    }

    // MARK: - The code

    private var codeCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Game code").newLookCaps()
            TextField(
                "",
                text: Binding(get: { model.code }, set: { model.setCode($0) }),
                prompt: Text(verbatim: "ABC234").foregroundStyle(NewLook.chevron)
            )
            .appFont(32, weight: .heavy, design: .monospaced)
            .tracking(8)
            .foregroundStyle(NewLook.ink)
            .multilineTextAlignment(.center)
            .keyboardType(.asciiCapable)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .submitLabel(.join)
            .focused($codeFocused)
            .onSubmit { Task { await model.join() } }
            .padding(.vertical, 16)
            .background(NewLook.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(codeFocused ? NewLook.blue : NewLook.field, lineWidth: codeFocused ? 2.5 : 1.5)
            )
            // The kit's focus glow: a soft blue ring outside the field while typing.
            .background(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(NewLook.blue50)
                    .padding(-4)
                    .opacity(codeFocused ? 1 : 0)
            )
            .animation(Motion.focus, value: codeFocused)
            .accessibilityLabel("Game code")

            if let error = model.joinError {
                Text(error)
                    .appFont(14, weight: .semibold)
                    .foregroundStyle(NewLook.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                codeFocused = false
                Task { await model.join() }
            } label: {
                HStack(spacing: 8) {
                    if model.joining { ProgressView().tint(.white) }
                    Text("Join")
                }
            }
            .buttonStyle(NewLookButtonStyle(size: .large))
            .disabled(!model.canJoin)
        }
        .newLookCard(padding: 18, radius: 24)
    }

    // MARK: - Running now

    private var runningCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                NewLookTile(systemName: "dot.radiowaves.left.and.right")
                Text("Running in your classes")
                    .appDisplayFont(19)
                    .tracking(-0.3)
                    .foregroundStyle(NewLook.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
            }
            switch model.running {
            case .loading:
                VStack(spacing: 10) {
                    ForEach(0..<2, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(NewLook.sheet)
                            .frame(height: 60)
                    }
                }
                .accessibilityLabel("Loading")
            case .failed:
                // Not "nothing running": a failed read says so, and a quiz may be waiting.
                RetryNotice(message: "Couldn't check for quizzes running in your classes.") {
                    await model.loadRunning()
                }
            case .loaded(let rooms) where rooms.isEmpty:
                DashedEmpty(
                    title: "Nothing running right now",
                    hint: "When your teacher starts a live quiz, it will appear here."
                )
            case .loaded(let rooms):
                VStack(spacing: 8) {
                    ForEach(rooms) { room in
                        runningRow(room)
                    }
                }
            case .featureOff:
                EmptyView()
            }
        }
        .newLookCard(padding: 18, radius: 24)
    }

    private func runningRow(_ room: LiveQuizSummary) -> some View {
        Button {
            model.open(room)
        } label: {
            HStack(spacing: 12) {
                // Live: the red dot the board shows beside a room that is running.
                Circle().fill(NewLook.red).frame(width: 9, height: 9)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(room.title.isEmpty ? "Live quiz" : room.title)
                        .appFont(16, weight: .bold)
                        .foregroundStyle(NewLook.ink)
                        .lineLimit(1)
                    if !room.classroomName.isEmpty {
                        Text(room.classroomName)
                            .appFont(14, weight: .medium)
                            .foregroundStyle(NewLook.ink4)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(NewLook.blueText)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NewLook.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the quiz")
    }

    // MARK: - Switched off

    private var featureOff: some View {
        LiveQuizStateCard(
            icon: "antenna.radiowaves.left.and.right.slash",
            title: "Live quizzes are not switched on yet.",
            tone: NewLook.ink4
        ) {
            Button("Check again") { Task { await model.loadRunning() } }
                .buttonStyle(NewLookButtonStyle(kind: .tint))
                .padding(.top, 4)
        }
    }
}
