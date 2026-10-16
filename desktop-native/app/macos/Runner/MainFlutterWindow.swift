import Cocoa
import FlutterMacOS
import WebKit

// The MasterSAT exam window on macOS — the production counterpart of
// desktop-native/app/windows/runner/flutter_window.cpp. It hands the window to
// mastersat_native.dylib (ms_init) before Dart runs, and carries the same three runner channels:
//
//  * MethodChannel("mastersat/launch")
//      native -> Dart  "open" {"url": String}    a mastersat:// link handed to the running app
//                      "activate" null            a second launch with no link
//      Dart -> native  "takePending" -> [String]  links that arrived before Dart listened
//                      "focusWindow" -> Bool       bring the window to the front
//  * MethodChannel("mastersat/power")  (native -> Dart, the method IS the event)
//      "suspending" (sleep)  "resumed" (wake)  "timeChanged" (wall clock)  "displayChanged"
//  * MethodChannel("mastersat/window")  (window placement + More -> Full screen)
//      Dart -> native  "restorePlacement" {x,y,width,height,maximized} -> Bool
//                      "setFullscreen" {on: Bool} -> Bool
//      native -> Dart  "placementChanged" {x,y,width,height,maximized}
//
// It also keeps the development capture channel ("mastersat/dev_capture") the macOS integration
// tour uses to snapshot the WebView islands without Screen Recording permission.
//
// The window remembers its size and position in UserDefaults (outside the app bundle, so an
// update never loses it), has a 1000x640 minimum, paints white (no flash), and — because a
// midterm lockdown makes it borderless — overrides canBecomeKey/Main so it keeps the keyboard.
class MainFlutterWindow: NSWindow, NSWindowDelegate {
    private var launchChannel: FlutterMethodChannel?
    private var powerChannel: FlutterMethodChannel?
    private var windowChannel: FlutterMethodChannel?
    private var captureChannel: FlutterMethodChannel?

    private var ownPending: [String] = []
    private var dartListening = false

    // More -> Full screen (non-lockdown); the lockdown drives its own borderless fullscreen.
    private var fullscreenSaved: (styleMask: NSWindow.StyleMask, frame: NSRect)?

    private static let placementKey = "MasterSATWindowFrame"
    private static let zoomedKey = "MasterSATWindowZoomed"
    private static let minWidth: CGFloat = 1000
    private static let minHeight: CGFloat = 640

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    override func awakeFromNib() {
        let flutterViewController = FlutterViewController()
        let windowFrame = self.frame
        self.contentViewController = flutterViewController
        self.setFrame(windowFrame, display: true)

        RegisterGeneratedPlugins(registry: flutterViewController)

        // Hand the window to the native library before Dart runs (keyboard guard idle, watchdog
        // started). The app version is the one baked into Info.plist (CFBundleShortVersionString),
        // the same value desktop-native/VERSION feeds the installer and every lockdown proof.
        let version = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0.0.0"
        MasterSATNative.shared.initialize(window: self, appVersion: version)

        setUpChannels(messenger: flutterViewController.engine.binaryMessenger)
        observeSystemEvents()

        self.backgroundColor = .white
        self.contentMinSize = NSSize(width: MainFlutterWindow.minWidth, height: MainFlutterWindow.minHeight)
        self.delegate = self
        (NSApp.delegate as? AppDelegate)?.register(window: self)
        restorePlacementFromDefaults()

        super.awakeFromNib()
    }

    // MARK: - Channels

    private func setUpChannels(messenger: FlutterBinaryMessenger) {
        let launch = FlutterMethodChannel(name: "mastersat/launch", binaryMessenger: messenger)
        launch.setMethodCallHandler { [weak self] call, result in
            guard let self = self else { result(nil); return }
            switch call.method {
            case "takePending":
                self.dartListening = true
                var urls = self.ownPending
                self.ownPending.removeAll()
                if let app = NSApp.delegate as? AppDelegate {
                    urls.append(contentsOf: app.takePendingUrls())
                }
                result(urls)
            case "focusWindow":
                self.bringToFront()
                result(true)
            default:
                result(FlutterMethodNotImplemented)
            }
        }
        launchChannel = launch

        powerChannel = FlutterMethodChannel(name: "mastersat/power", binaryMessenger: messenger)

        let window = FlutterMethodChannel(name: "mastersat/window", binaryMessenger: messenger)
        window.setMethodCallHandler { [weak self] call, result in
            guard let self = self else { result(nil); return }
            switch call.method {
            case "setFullscreen":
                let on = (call.arguments as? [String: Any])?["on"] as? Bool ?? false
                result(self.setFullscreen(on))
            case "restorePlacement":
                result(self.applyPlacement(call.arguments as? [String: Any]))
            default:
                result(FlutterMethodNotImplemented)
            }
        }
        windowChannel = window

        setUpCaptureChannel(messenger: messenger)
    }

    /// Native -> Dart: a mastersat:// link. Returns false when Dart is not listening yet, so the
    /// caller (AppDelegate) queues it.
    @discardableResult
    func deliverLaunchUrl(_ url: String) -> Bool {
        guard dartListening, let channel = launchChannel else { return false }
        channel.invokeMethod("open", arguments: ["url": url])
        bringToFront()
        return true
    }

    private func bringToFront() {
        if isMiniaturized { deminiaturize(nil) }
        NSApp.activate(ignoringOtherApps: true)
        makeKeyAndOrderFront(nil)
    }

    // MARK: - System events (sleep / wake / clock / displays)

    private func observeSystemEvents() {
        let workspace = NSWorkspace.shared.notificationCenter
        workspace.addObserver(self, selector: #selector(onSleep), name: NSWorkspace.willSleepNotification, object: nil)
        workspace.addObserver(self, selector: #selector(onWake), name: NSWorkspace.didWakeNotification, object: nil)

        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(onClockChange), name: NSNotification.Name.NSSystemClockDidChange, object: nil)
        center.addObserver(self, selector: #selector(onDisplayChange), name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }

    @objc private func onSleep() { sendPower("suspending") }
    @objc private func onWake() { sendPower("resumed") }
    @objc private func onClockChange() { sendPower("timeChanged") }
    @objc private func onDisplayChange() { sendPower("displayChanged") }

    private func sendPower(_ event: String) {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        powerChannel?.invokeMethod(event, arguments: ["event": event, "wallClockMs": now])
    }

    // MARK: - More -> Full screen (non-lockdown)

    private func setFullscreen(_ on: Bool) -> Bool {
        if on {
            guard fullscreenSaved == nil, let screen = self.screen ?? NSScreen.main else { return false }
            fullscreenSaved = (styleMask, frame)
            styleMask = .borderless
            setFrame(screen.frame, display: true)
            return true
        } else {
            guard let saved = fullscreenSaved else { return false }
            styleMask = saved.styleMask
            setFrame(saved.frame, display: true)
            fullscreenSaved = nil
            return true
        }
    }

    // MARK: - Placement (remembered in UserDefaults, like HKCU on Windows)

    private var isBorderless: Bool { !styleMask.contains(.titled) }

    private func restorePlacementFromDefaults() {
        let defaults = UserDefaults.standard
        guard let raw = defaults.array(forKey: MainFlutterWindow.placementKey) as? [Double], raw.count == 4 else { return }
        let rect = NSRect(x: raw[0], y: raw[1], width: raw[2], height: raw[3])
        guard rect.width >= MainFlutterWindow.minWidth, rect.height >= MainFlutterWindow.minHeight else { return }
        guard NSScreen.screens.contains(where: { $0.visibleFrame.intersects(rect) }) else { return }
        setFrame(rect, display: false)
        if defaults.bool(forKey: MainFlutterWindow.zoomedKey), !isZoomed { zoom(nil) }
    }

    private func savePlacement() {
        guard !isBorderless else { return } // never save a lockdown/full-screen rectangle
        let defaults = UserDefaults.standard
        let f = frame
        defaults.set([Double(f.origin.x), Double(f.origin.y), Double(f.size.width), Double(f.size.height)], forKey: MainFlutterWindow.placementKey)
        defaults.set(isZoomed, forKey: MainFlutterWindow.zoomedKey)
    }

    private func notifyPlacementChanged() {
        guard !isBorderless else { return }
        let f = frame
        windowChannel?.invokeMethod("placementChanged", arguments: [
            "x": Double(f.origin.x), "y": Double(f.origin.y),
            "width": Double(f.size.width), "height": Double(f.size.height),
            "maximized": isZoomed,
        ])
    }

    private func applyPlacement(_ args: [String: Any]?) -> Bool {
        guard let args = args,
              let x = args["x"] as? Double, let y = args["y"] as? Double,
              let w = args["width"] as? Double, let h = args["height"] as? Double,
              w >= Double(MainFlutterWindow.minWidth), h >= Double(MainFlutterWindow.minHeight) else { return false }
        let rect = NSRect(x: x, y: y, width: w, height: h)
        guard NSScreen.screens.contains(where: { $0.visibleFrame.intersects(rect) }) else { return false }
        setFrame(rect, display: true)
        if (args["maximized"] as? Bool) == true, !isZoomed { zoom(nil) }
        return true
    }

    func windowDidResize(_ notification: Notification) { savePlacement(); notifyPlacementChanged() }
    func windowDidMove(_ notification: Notification) { savePlacement(); notifyPlacementChanged() }
    func windowWillClose(_ notification: Notification) { savePlacement() }

    // MARK: - Development capture channel (macOS integration tour; never shipped behaviour)

    private func setUpCaptureChannel(messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(name: "mastersat/dev_capture", binaryMessenger: messenger)
        channel.setMethodCallHandler { [weak self] call, result in
            guard let self = self else {
                result(FlutterError(code: "gone", message: "window closed", details: nil))
                return
            }
            switch call.method {
            case "setContentSize":
                let args = call.arguments as? [String: Any]
                let w = (args?["width"] as? NSNumber)?.doubleValue ?? 1280
                let h = (args?["height"] as? NSNumber)?.doubleValue ?? 820
                self.setContentSize(NSSize(width: w, height: h))
                result(true)
            case "snapshotWebViews":
                self.snapshotWebViews(result: result)
            default:
                result(FlutterMethodNotImplemented)
            }
        }
        captureChannel = channel
    }

    private func webViews(in view: NSView) -> [WKWebView] {
        var found: [WKWebView] = []
        if let web = view as? WKWebView { found.append(web) }
        for sub in view.subviews { found.append(contentsOf: webViews(in: sub)) }
        return found
    }

    private func snapshotWebViews(result: @escaping FlutterResult) {
        guard let content = self.contentView else { result([]); return }
        let views = webViews(in: content).filter { !$0.isHidden && $0.bounds.width > 0 && $0.bounds.height > 0 }
        if views.isEmpty { result([]); return }
        var shots: [[String: Any]] = []
        var pending = views.count
        for web in views {
            var rect = web.convert(web.bounds, to: content)
            if !content.isFlipped { rect.origin.y = content.bounds.height - rect.origin.y - rect.height }
            web.takeSnapshot(with: nil) { image, _ in
                if let image = image, let tiff = image.tiffRepresentation,
                    let rep = NSBitmapImageRep(data: tiff),
                    let png = rep.representation(using: .png, properties: [:]) {
                    shots.append([
                        "x": rect.origin.x, "y": rect.origin.y,
                        "width": rect.width, "height": rect.height,
                        "png": FlutterStandardTypedData(bytes: png),
                    ])
                }
                pending -= 1
                if pending == 0 { result(shots) }
            }
        }
    }

    deinit {
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        NotificationCenter.default.removeObserver(self)
    }
}
