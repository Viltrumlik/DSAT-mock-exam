import Cocoa
import FlutterMacOS

@main
class AppDelegate: FlutterAppDelegate {
    /// mastersat:// links that arrived before the window was ready (incl. the one the app was
    /// opened with). Mirrors the Windows runner's pending-URL queue.
    private var pendingUrls: [String] = []
    private weak var mainWindow: MainFlutterWindow?

    override func applicationWillFinishLaunching(_ notification: Notification) {
        // MasterSAT (architecture §6): Velopack's hooks run first of all; on a hook the library
        // exits the process. argv[0] is the executable, like wWinMain's command line on Windows.
        MasterSATNative.shared.startup(Array(CommandLine.arguments.dropFirst()))

        // Deep links through the classic Apple Event (robust across macOS versions); the modern
        // application(_:open:) below also forwards, and the OS makes the app single-instance.
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleGetURLEvent(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL))
    }

    override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    override func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        return true
    }

    /// Never quit out from under a locked-down midterm (the macOS counterpart of swallowing
    /// Alt+F4 on Windows). The kiosk presentation options already hide Quit; this is the belt.
    override func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        return MasterSATNative.shared.isLockedDown() ? .terminateCancel : .terminateNow
    }

    @objc private func handleGetURLEvent(_ event: NSAppleEventDescriptor, withReplyEvent reply: NSAppleEventDescriptor) {
        if let url = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue {
            deliver(url)
        }
    }

    override func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { deliver(url.absoluteString) }
    }

    func register(window: MainFlutterWindow) {
        mainWindow = window
    }

    /// Drain the links that queued before the window was ready (the launch channel calls this
    /// through takePending).
    func takePendingUrls() -> [String] {
        let urls = pendingUrls
        pendingUrls.removeAll()
        return urls
    }

    private func deliver(_ url: String) {
        if let window = mainWindow, window.deliverLaunchUrl(url) {
            return
        }
        pendingUrls.append(url)
        if pendingUrls.count > 8 { pendingUrls.removeFirst(pendingUrls.count - 8) }
    }
}
