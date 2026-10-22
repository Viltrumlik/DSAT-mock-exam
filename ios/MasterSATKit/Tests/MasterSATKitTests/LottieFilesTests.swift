import Foundation
import Testing
@testable import MasterSATKit

/// The animations the app bundles (`ios/MasterSAT/Resources/Lottie`), checked without a
/// simulator: a clip that will not parse draws nothing, silently, and a clip that grows past the
/// budget is paid for on every launch.
///
/// Read through `RepoPaths`, so the kit's tests hold the app's assets to the same bar as its code.
@Suite struct LottieFilesTests {

    static let folder = "ios/MasterSAT/Resources/Lottie"

    /// The most one clip may weigh: the set ships in every download, and a clip is parsed the
    /// first time it plays.
    static let byteBudget = 15_000

    static let files: [String] = {
        let url = RepoPaths.file(folder)
        let names = (try? FileManager.default.contentsOfDirectory(atPath: url.path)) ?? []
        return names.filter { $0.hasSuffix(".json") }.sorted()
    }()

    private func data(_ name: String) throws -> Data {
        try Data(contentsOf: RepoPaths.file("\(Self.folder)/\(name)"))
    }

    @Test("The animations folder is where the app bundles it, and is not empty")
    func folderHasClips() {
        #expect(RepoPaths.exists(Self.folder), "\(Self.folder) is missing — the app bundles its animations from there")
        #expect(!Self.files.isEmpty, "no .json clips in \(Self.folder)")
    }

    @Test("A clip is a Lottie document: version, frame rate, in and out points, size and layers", arguments: LottieFilesTests.files)
    func isALottieDocument(name: String) throws {
        let object = try JSONSerialization.jsonObject(with: data(name))
        let json = try #require(object as? [String: Any], "\(name) is not a JSON object")

        #expect(json["v"] is String, "\(name): no version `v`")
        let frameRate = try #require(json["fr"] as? Double, "\(name): no frame rate `fr`")
        let inPoint = try #require(json["ip"] as? Double, "\(name): no in point `ip`")
        let outPoint = try #require(json["op"] as? Double, "\(name): no out point `op`")
        let width = try #require(json["w"] as? Double, "\(name): no width `w`")
        let height = try #require(json["h"] as? Double, "\(name): no height `h`")
        #expect(frameRate > 0, "\(name): frame rate must be positive")
        #expect(outPoint > inPoint, "\(name): a clip must last longer than no frames")
        #expect(width > 0 && height > 0, "\(name): an empty canvas draws nothing")

        let layers = try #require(json["layers"] as? [Any], "\(name): no `layers`")
        #expect(!layers.isEmpty, "\(name): no layers, so nothing to draw")
    }

    /// `LottieClip` pauses on this marker for every still picture (`.still`, a loop under Reduce
    /// Motion or Low Power, a settling state under Reduce Motion). A clip without it pauses on its
    /// first frame, which for most of them is blank.
    @Test("A clip has a `rest` marker inside its frames: the picture a still clip shows", arguments: LottieFilesTests.files)
    func hasARestMarker(name: String) throws {
        let object = try JSONSerialization.jsonObject(with: data(name))
        let json = try #require(object as? [String: Any], "\(name) is not a JSON object")
        let markers = try #require(json["markers"] as? [[String: Any]], "\(name): no `markers`")
        let rest = try #require(markers.first { $0["cm"] as? String == "rest" }, "\(name): no marker with `cm` \"rest\"")
        let frame = try #require(rest["tm"] as? Double, "\(name): the `rest` marker has no frame `tm`")
        let inPoint = try #require(json["ip"] as? Double)
        let outPoint = try #require(json["op"] as? Double)
        #expect(frame >= inPoint && frame <= outPoint, "\(name): rests at frame \(frame), outside \(inPoint)...\(outPoint)")
    }

    @Test("A clip is small: at most 15,000 bytes", arguments: LottieFilesTests.files)
    func fitsTheBudget(name: String) throws {
        let size = try data(name).count
        #expect(size <= Self.byteBudget, "\(name) is \(size) bytes; the budget is \(Self.byteBudget)")
    }
}
