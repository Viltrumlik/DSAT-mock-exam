import Foundation

/// Where the rest of the repository is, found from this file's own path (`#filePath`) rather
/// than from the working directory: `swift test` runs from `ios/MasterSATKit`, Xcode from
/// elsewhere. The kit's tests live in `ios/MasterSATKit/Tests/MasterSATKitTests/`, so the
/// repository root is five folders up. Used by the tests that hold the kit to something outside
/// it — the backend's constants, the app's bundled animations.
enum RepoPaths {
    static let root: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        return url
    }()

    static func file(_ relativePath: String) -> URL {
        root.appendingPathComponent(relativePath)
    }

    static func exists(_ relativePath: String) -> Bool {
        FileManager.default.fileExists(atPath: file(relativePath).path)
    }
}
