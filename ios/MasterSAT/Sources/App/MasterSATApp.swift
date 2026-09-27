import SwiftUI
import MasterSATKit

@main
struct MasterSATApp: App {
    /// Hands iOS's device token (and push taps) to PushRegistrar and NotificationRouter.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session = Session()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .task { await session.launch() }
        }
        .onChange(of: scenePhase) { _, phase in
            // Coming back to the foreground is when the world may have moved: a new minimum
            // version, a frozen account, reports waiting from a crash.
            if phase == .active { Task { await session.didBecomeActive() } }
        }
    }
}

/// Signed-in state and the API surfaces that depend on it.
///
/// One composition root rather than singletons: the whole app can be pointed at a stub
/// backend by constructing this with a different `APIConfig`.
@MainActor
@Observable
final class Session {
    enum Phase: Equatable {
        case launching
        case signedOut(message: String?)
        case signedIn(CurrentUser)
        /// Signed in on this phone, but the server cannot be reached and there is no copy of
        /// the account kept here to open with. NOT signed out: the tokens are still good, and
        /// the sign-in form would be a lie.
        case unreachable
    }

    private(set) var phase: Phase = .launching
    private(set) var isWorking = false

    let client: APIClient
    let auth: AuthService
    let student: StudentAPI
    let classrooms: ClassroomAPI
    let assessments: AssessmentAPI
    let results: ResultsAPI
    let rewards: RewardsAPI
    let mobile: MobileAPI
    /// Reminders on the device. Lives here because it is app-wide state with a lifetime
    /// tied to the signed-in student — signing out has to wipe it.
    let notifications = NotificationService()
    /// Whether this build may still be used. See `ReleaseGate`.
    let releaseGate = ReleaseGate()
    let connectivity = Connectivity()
    /// Crashes (MetricKit) and the client's own errors, queued and sent to the server.
    let diagnostics = DiagnosticsCenter()

    /// Where a debug build talks to, if it was told.
    ///
    /// iOS turns `-apiBaseURL http://localhost:8000` on the launch command into a
    /// UserDefaults key, so a local backend needs no code change and no scheme edit —
    /// just `xcrun simctl launch … -apiBaseURL …`. Compiled out of release builds
    /// entirely: a shipped app must not be pointable at another host.
    static func defaultConfig() -> APIConfig {
        #if DEBUG
        if let raw = UserDefaults.standard.string(forKey: "apiBaseURL"), let url = URL(string: raw) {
            return APIConfig(baseURL: url, clientIdentifier: AppInfo.clientIdentifier)
        }
        #endif
        let production = APIConfig.production(appVersion: AppInfo.version)
        return APIConfig(baseURL: production.baseURL, clientIdentifier: AppInfo.clientIdentifier)
    }

    init(config: APIConfig = Session.defaultConfig()) {
        // Write-through: the live pair is held in memory and mirrored to the Keychain. If
        // the Keychain refuses a write, the session keeps working for this launch instead
        // of collapsing into "please sign in" on the very next request.
        let storage = WriteThroughTokenStorage.keychain()
        // `onSignOut` and `onEvent` fire from deep inside the client — often while a screen is
        // mid-request — so they only record the fact. The UI reacts on the main actor.
        let signOutSignal = SignOutSignal()
        let events = ClientEventBridge()
        client = APIClient(
            config: config,
            storage: storage,
            onSignOut: { signOutSignal.fire() },
            onEvent: { events.send($0) }
        )
        auth = AuthService(client: client)
        student = StudentAPI(client: client)
        classrooms = ClassroomAPI(client: client)
        assessments = AssessmentAPI(client: client)
        results = ResultsAPI(client: client)
        rewards = RewardsAPI(client: client)
        mobile = MobileAPI(client: client)

        signOutSignal.onFire = { [weak self] in
            Task { @MainActor in self?.sessionEnded() }
        }
        let diagnostics = self.diagnostics
        events.handler = { [weak self] event in
            switch event {
            case .serverReached:
                Task { @MainActor in self?.connectivity.noteServerReached() }
            case .upgradeRequired(let error):
                diagnostics.record(event)
                Task { @MainActor in self?.releaseGate.noteRefusal(error) }
            default:
                diagnostics.record(event)
            }
        }
        connectivity.onReconnect = { [weak self] in
            guard let self else { return }
            Task { await self.diagnostics.uploadPending() }
        }
    }

    // MARK: - Lifecycle

    /// Once, when the window first appears.
    func launch() async {
        connectivity.start()
        diagnostics.start(mobile: mobile)
        // The policy first: a build that must update should say so before anything else
        // asks the student to sign in or waits on a network call the server will refuse.
        await releaseGate.check(using: mobile, force: true)
        await restore()
    }

    /// Every return to the foreground.
    func didBecomeActive() async {
        guard phase != .launching else { return }
        await releaseGate.check(using: mobile)
        await diagnostics.uploadPending()
        await refreshUser()
    }

    func recheckRelease() async {
        await releaseGate.check(using: mobile, force: true)
        // The launch that met the refusal never finished restoring; now it can.
        if !releaseGate.isBlocked, phase == .launching || phase == .unreachable {
            await restore()
        }
    }

    // MARK: - Signing in and out

    /// Resume a stored session on launch.
    func restore() async {
        guard await auth.isSignedIn() else {
            phase = .signedOut(message: nil)
            return
        }
        do {
            let user = try await student.me()
            UserCache.save(user)
            phase = .signedIn(user)
        } catch APIError.unauthorized, APIError.notAuthenticated {
            UserCache.clear()
            phase = .signedOut(message: nil)
        } catch APIError.upgradeRequired {
            // The update screen is over everything. Stay where we are; `recheckRelease`
            // finishes the restore once the build is allowed back in.
            if let cached = UserCache.load() { phase = .signedIn(cached) }
        } catch {
            // Offline or a deploy in progress: the tokens are still good. Open with the last
            // known account and let each screen show its own failure to load — never the
            // sign-in form.
            if let cached = UserCache.load() {
                phase = .signedIn(cached)
            } else {
                phase = .unreachable
            }
        }
    }

    /// Pick up changes made elsewhere — a frozen account, a finished profile, a new name.
    func refreshUser() async {
        guard case .signedIn(let current) = phase else { return }
        guard let fresh = try? await student.me() else { return }
        UserCache.save(fresh)
        if fresh != current { phase = .signedIn(fresh) }
    }

    /// Sign in, and let the failure reach the form.
    ///
    /// It throws rather than writing the message into `phase`: a mistyped password is the
    /// form's business, and routing it through `signedOut(message:)` used to overwrite the
    /// session-expired notice with it — and, worse, showed "Your session has expired" to
    /// someone who had simply typed the wrong password.
    func signIn(email: String, password: String) async throws {
        isWorking = true
        defer { isWorking = false }
        try await auth.signIn(email: email, password: password)
        phase = .signedIn(try await identify())
    }

    /// Create the account and sign straight into it — the two steps the web's register
    /// page takes, since registration answers with a user rather than a token pair.
    func register(
        firstName: String,
        lastName: String,
        username: String,
        email: String,
        password: String
    ) async throws {
        isWorking = true
        defer { isWorking = false }
        try await auth.register(
            firstName: firstName,
            lastName: lastName,
            username: username,
            email: email,
            password: password
        )
        try await auth.signIn(email: email, password: password)
        phase = .signedIn(try await identify())
    }

    /// Load the identity that the rest of the app is built from.
    ///
    /// If this fails the tokens are dropped, because the alternative is worse: a device
    /// holding a live session while the screen still says "sign in", which then greets the
    /// student with an error they cannot clear by trying again.
    private func identify() async throws -> CurrentUser {
        do {
            let user = try await student.me()
            UserCache.save(user)
            return user
        } catch {
            await client.signOutLocally()
            throw error
        }
    }

    func signOut() async {
        // First, while the tokens still work: the server stops pushing this student's
        // news to a phone someone else may sign in on next. Bounded — it never holds up
        // signing out.
        await PushRegistrar.shared.unregister(using: client)
        await auth.signOut()
        // Before the phase flips, so nothing scheduled for this student survives to
        // interrupt whoever signs in next on the same phone.
        notifications.clearEverything()
        UserCache.clear()
        phase = .signedOut(message: nil)
    }

    /// The server ended the session (a refresh was rejected — a password changed elsewhere,
    /// "sign out other devices", an expired login).
    private func sessionEnded() {
        // The tokens are already gone, so the server cannot be told — but the local half
        // (forgetting the device token) is what stops a stale registration being reused.
        Task { await PushRegistrar.shared.unregister() }
        notifications.clearEverything()
        UserCache.clear()
        phase = .signedOut(message: "Your session has expired. Please sign in again.")
    }
}

/// The last copy of the signed-in account, so the app can open without a network.
///
/// Holds only what `/users/me/` returns about the student themselves — no tokens; those live
/// in the Keychain — and it is wiped on every sign-out.
enum UserCache {
    private static let key = "session.lastUser"

    static func save(_ user: CurrentUser) {
        guard let data = try? JSONEncoder().encode(user) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    static func load() -> CurrentUser? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONCoding.decoder.decode(CurrentUser.self, from: data)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

/// Bridges the client's non-isolated sign-out callback onto the main actor.
final class SignOutSignal: @unchecked Sendable {
    private let lock = NSLock()
    private var handler: (() -> Void)?

    var onFire: (() -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return handler }
        set { lock.lock(); defer { lock.unlock() }; handler = newValue }
    }

    func fire() { onFire?() }
}

/// The same bridge for `APIClientEvent`s: set once in `Session.init`, fired from the client.
final class ClientEventBridge: @unchecked Sendable {
    private let lock = NSLock()
    private var _handler: (@Sendable (APIClientEvent) -> Void)?

    var handler: (@Sendable (APIClientEvent) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return _handler }
        set { lock.lock(); defer { lock.unlock() }; _handler = newValue }
    }

    func send(_ event: APIClientEvent) { handler?(event) }
}

extension Bundle {
    var appVersion: String {
        (infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.0.0"
    }
}
