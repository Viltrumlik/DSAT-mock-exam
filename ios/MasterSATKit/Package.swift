// swift-tools-version: 6.0
import PackageDescription

// The exam engine and API layer live here rather than in the app target so they can be
// built and tested with the plain Swift toolchain — no Xcode, no simulator, no UI. The
// runner's correctness rules (autosave timing, draft recovery, snapshot merging) are the
// part of this app that must never regress, so they are also the part that must stay
// testable from a terminal.
let package = Package(
    name: "MasterSATKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "MasterSATKit", targets: ["MasterSATKit"]),
    ],
    targets: [
        .target(name: "MasterSATKit"),
        .testTarget(name: "MasterSATKitTests", dependencies: ["MasterSATKit"]),
    ]
)
