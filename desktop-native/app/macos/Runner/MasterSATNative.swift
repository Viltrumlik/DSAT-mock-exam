import Foundation

// mastersat_native.dylib, loaded by the runner at launch — the macOS counterpart of the Windows
// runner linking mastersat_native.dll. The library is opened by its path inside the app bundle
// (Contents/Frameworks/libmastersat_native.dylib); Dart's dart:ffi opens the SAME path, so C and
// Dart share one loaded image and one set of Rust statics (the window handle, the lockdown state,
// the pre-check captured at lock time) — exactly as on Windows.
//
// `ms_startup` runs first (Velopack install/update/uninstall hooks), then `ms_init` once the
// window exists. `ms_heartbeat` lets the runner refuse Cmd-Q while a midterm is locked down. A
// development `flutter run` without the dylib built simply finds nothing and the app still starts
// (Dart then falls back to its development bridge), the same as the Windows `MS_HAVE_NATIVE` guard.
final class MasterSATNative {
    static let shared = MasterSATNative()

    typealias StartupFn = @convention(c) (Int32, UnsafePointer<UnsafePointer<CChar>?>?) -> Int32
    typealias InitFn = @convention(c) (Int, UnsafePointer<CChar>?) -> Int32
    typealias HeartbeatFn = @convention(c) () -> Int32

    private let handle: UnsafeMutableRawPointer?
    private let startupFn: StartupFn?
    private let initFn: InitFn?
    private let heartbeatFn: HeartbeatFn?

    private init() {
        var opened: UnsafeMutableRawPointer?
        for path in MasterSATNative.candidatePaths() {
            if let h = dlopen(path, RTLD_NOW | RTLD_GLOBAL) {
                opened = h
                break
            }
        }
        handle = opened
        func sym<T>(_ name: String, _ type: T.Type) -> T? {
            guard let h = opened, let p = dlsym(h, name) else { return nil }
            return unsafeBitCast(p, to: T.self)
        }
        startupFn = sym("ms_startup", StartupFn.self)
        initFn = sym("ms_init", InitFn.self)
        heartbeatFn = sym("ms_heartbeat", HeartbeatFn.self)
    }

    var isLoaded: Bool { handle != nil }

    /// Where to look for the dylib, best first: the shipped app's Frameworks folder, then the
    /// cargo target folders a `flutter run` developer may have built into.
    private static func candidatePaths() -> [String] {
        var paths: [String] = []
        if let frameworks = Bundle.main.privateFrameworksPath {
            paths.append(frameworks + "/libmastersat_native.dylib")
        }
        // Development: desktop-native/native/target/{debug,release}, found from the repo.
        let cwd = FileManager.default.currentDirectoryPath
        for base in [cwd + "/../native/target", cwd + "/native/target", cwd + "/desktop-native/native/target"] {
            for profile in ["debug", "release"] {
                paths.append("\(base)/\(profile)/libmastersat_native.dylib")
            }
        }
        // A bare name lets dyld use its own search path as a last resort.
        paths.append("libmastersat_native.dylib")
        return paths
    }

    /// Velopack's hooks; must run before anything else (it may exit the process on a hook).
    func startup(_ arguments: [String]) {
        guard let startup = startupFn else { return }
        var cstrings: [UnsafeMutablePointer<CChar>?] = arguments.map { strdup($0) }
        defer { for p in cstrings { free(p) } }
        cstrings.withUnsafeMutableBufferPointer { buffer in
            buffer.baseAddress?.withMemoryRebound(to: UnsafePointer<CChar>?.self, capacity: buffer.count) { argv in
                _ = startup(Int32(buffer.count), argv)
            }
        }
    }

    /// Hand the top-level window and the app version to the library (keyboard guard idle, watchdog
    /// started), before the Flutter engine runs Dart.
    func initialize(window: NSWindow, appVersion: String) {
        guard let initialize = initFn else { return }
        let ptr = Int(bitPattern: Unmanaged.passUnretained(window).toOpaque())
        appVersion.withCString { _ = initialize(ptr, $0) }
    }

    /// 1 while a midterm lockdown is engaged (used to refuse quitting mid-exam). 0 when the
    /// library is absent, so a development build is never un-quittable.
    func isLockedDown() -> Bool {
        (heartbeatFn?() ?? 0) == 1
    }
}
