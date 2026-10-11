import Cocoa
import FlutterMacOS
import WebKit

// macOS is the DEVELOPMENT runner only; it never ships (the app ships on Windows).
//
// MethodChannel("mastersat/dev_capture") lets the integration tour save what the window shows
// without Screen Recording permission (this Mac has none to give):
//   "setContentSize" {width, height}  — resize the window's content to that many points
//   "snapshotWebViews"                — every WKWebView in the window (the question islands):
//                                        [{x, y, width, height (points, top-left origin),
//                                          png (FlutterStandardTypedData)}]
// Flutter's own layer capture (OffsetLayer.toImage) has the Flutter pixels; the islands are
// platform views it cannot see, so the tour composites these snapshots over it.
class MainFlutterWindow: NSWindow {
  private var captureChannel: FlutterMethodChannel?

  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)

    let channel = FlutterMethodChannel(
      name: "mastersat/dev_capture",
      binaryMessenger: flutterViewController.engine.binaryMessenger)
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

    super.awakeFromNib()
  }

  private func webViews(in view: NSView) -> [WKWebView] {
    var found: [WKWebView] = []
    if let web = view as? WKWebView {
      found.append(web)
    }
    for sub in view.subviews {
      found.append(contentsOf: webViews(in: sub))
    }
    return found
  }

  private func snapshotWebViews(result: @escaping FlutterResult) {
    guard let content = self.contentView else {
      result([])
      return
    }
    let views = webViews(in: content).filter { !$0.isHidden && $0.bounds.width > 0 && $0.bounds.height > 0 }
    if views.isEmpty {
      result([])
      return
    }
    var shots: [[String: Any]] = []
    var pending = views.count
    for web in views {
      var rect = web.convert(web.bounds, to: content)
      if !content.isFlipped {
        rect.origin.y = content.bounds.height - rect.origin.y - rect.height
      }
      web.takeSnapshot(with: nil) { image, _ in
        if let image = image, let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:])
        {
          shots.append([
            "x": rect.origin.x, "y": rect.origin.y,
            "width": rect.width, "height": rect.height,
            "png": FlutterStandardTypedData(bytes: png),
          ])
        }
        pending -= 1
        if pending == 0 {
          result(shots)
        }
      }
    }
  }
}
