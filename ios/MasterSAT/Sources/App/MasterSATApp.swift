import SwiftUI
import MasterSATKit

@main
struct MasterSATApp: App {
    @State private var session = Session()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .task { await session.restore() }
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
    }

    private(set) var phase: Phase = .launching
    private(set) var isWorking = false

    let client: APIClient
    let auth: AuthService
    let student: StudentAPI
    let classrooms: ClassroomAPI
    let assessments: AssessmentAPI
    let results: ResultsAPI

    /// Where a debug build talks to, if it was told.
    ///
    /// iOS turns `-apiBaseURL http://localhost:8000` on the launch command into a
    /// UserDefaults key, so a local backend needs no code change and no scheme edit —
    /// just `xcrun simctl launch … -apiBaseURL …`. Compiled out of release builds
    /// entirely: a shipped app must not be pointable at another host.
    static func defaultConfig() -> APIConfig {
        let version = Bundle.main.appVersion
        #if DEBUG
        if let raw = UserDefaults.standard.string(forKey: "apiBaseURL"), let url = URL(string: raw) {
            return APIConfig(baseURL: url, clientIdentifier: "ios/\(version)")
        }
        #endif
        return .production(appVersion: version)
    }

    init(config: APIConfig = Session.defaultConfig()) {
        // Write-through: the live pair is held in memory and mirrored to the Keychain. If
        // the Keychain refuses a write, the session keeps working for this launch instead
        // of collapsing into "please sign in" on the very next request.
        let storage = WriteThroughTokenStorage.keychain()
        // `onSignOut` fires from deep inside a refresh that the server rejected — often
        // while a screen is mid-request — so it only records the fact. The UI reacts on
        // the main actor.
        let signOutSignal = SignOutSignal()
        client = APIClient(config: config, storage: storage, onSignOut: { signOutSignal.fire() })
        auth = AuthService(client: client)
        student = StudentAPI(client: client)
        classrooms = ClassroomAPI(client: client)
        assessments = AssessmentAPI(client: client)
        results = ResultsAPI(client: client)
        signOutSignal.onFire = { [weak self] in
            Task { @MainActor in
                self?.phase = .signedOut(message: "Your session has expired. Please sign in again.")
            }
        }
    }

    /// Resume a stored session on launch.
    func restore() async {
        guard await auth.isSignedIn() else {
            phase = .signedOut(message: nil)
            return
        }
        do {
            phase = .signedIn(try await student.me())
        } catch APIError.unauthorized, APIError.notAuthenticated {
            phase = .signedOut(message: nil)
        } catch {
            // Offline on launch is not signed out — the tokens are still good. Let the
            // student in and let each screen show its own failure to load.
            phase = .signedOut(message: nil)
        }
    }

    func signIn(email: String, password: String) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await auth.signIn(email: email, password: password)
            phase = .signedIn(try await student.me())
        } catch let error as APIError {
            phase = .signedOut(message: error.errorDescription)
        } catch {
            phase = .signedOut(message: error.localizedDescription)
        }
    }

    func signOut() async {
        await auth.signOut()
        phase = .signedOut(message: nil)
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

extension Bundle {
    var appVersion: String {
        (infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.0.0"
    }
}
