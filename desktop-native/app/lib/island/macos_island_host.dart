// MacosIslandHost — DEVELOPMENT ONLY (architecture §2.6, §9 tier B): the same island protocol on
// the macOS dev runner, through webview_flutter's WKWebView. It checks flows, not looks; nothing
// here ships (the Windows app uses TextureIslandHost).
//
// Transport (the island's `webkit` transport, island/src/transport.ts):
//   web → native  webkit.messageHandlers.ms.postMessage(JSON text)  → JavaScriptChannel "ms"
//   native → web  runJavaScript("window.msIsland.receive(<json>)")
//
// The island build is served from a loopback HTTP server bound to 127.0.0.1 on a random port
// (IslandFolderServer): WKWebView refuses ES-module scripts over file://, and the island's CSP
// (`script-src 'self'`) holds for a real origin. https://island.mastersat.example/<page> maps to
// http://127.0.0.1:<port>/<page>. Navigation away from that origin is refused, like the Windows
// policy (plugins/ms_webview2/windows/ms_policy.cc).
//
// Where the island comes from (resolveDevIslandSource), first match wins:
//   1. MS_ISLAND_URL  an already running dev server (e.g. `npm run dev` → http://127.0.0.1:5317/)
//   2. MS_ISLAND_DIR  a folder with content.html
//   3. desktop-native/island/build/island   (`npm run build`), found by walking up from the
//      working directory and from the executable
//   4. desktop-native/packaging/s0-probe    (the S0 probe page; protocol only, not the runner)
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:ms_webview2/ms_webview2.dart' show WebviewBlockedEvent, WebviewProcessFailedKind, WebviewProcessFailure;
import 'package:path/path.dart' as p;
import 'package:webview_flutter/webview_flutter.dart';

import 'island_host.dart';
import 'protocol.dart';
import 'texture_island_host.dart';

/// Where the macOS development host loads the island from.
@immutable
class IslandSource {
  const IslandSource.folder(String this.folder, {this.isProbe = false}) : url = null;
  const IslandSource.url(Uri this.url) : folder = null, isProbe = false;

  /// A folder holding content.html / desmos.html (served over loopback HTTP).
  final String? folder;

  /// A running server's base URL (pages are resolved against it).
  final Uri? url;

  /// True for the S0 probe page (packaging/s0-probe), not the real island.
  final bool isProbe;

  @override
  String toString() => folder != null ? 'folder $folder${isProbe ? ' (S0 probe)' : ''}' : 'url $url';
}

/// Finds the island for development runs (see the file comment for the order). Null when there
/// is nothing to load.
IslandSource? resolveDevIslandSource({
  Map<String, String>? environment,
  String? workingDirectory,
  String? executable,
  bool Function(String path)? fileExists,
}) {
  final env = environment ?? Platform.environment;
  final exists = fileExists ?? (String path) => File(path).existsSync();

  final url = env['MS_ISLAND_URL'];
  if (url != null && url.trim().isNotEmpty) {
    final uri = Uri.tryParse(url.trim());
    if (uri != null && isLoopbackDevUrl(uri)) {
      return IslandSource.url(uri.path.endsWith('/') ? uri : uri.replace(path: '${uri.path}/'));
    }
  }
  final dir = env['MS_ISLAND_DIR'];
  if (dir != null && dir.trim().isNotEmpty && exists(p.join(dir.trim(), 'content.html'))) {
    return IslandSource.folder(p.normalize(dir.trim()));
  }

  final starts = <String>[
    workingDirectory ?? Directory.current.path,
    p.dirname(executable ?? Platform.resolvedExecutable),
  ];
  for (final relative in const [
    ['island', 'build', 'island'],
    ['packaging', 's0-probe'],
  ]) {
    for (final start in starts) {
      final root = _findDesktopNative(start, exists);
      if (root == null) continue;
      final folder = p.joinAll([root, ...relative]);
      if (exists(p.join(folder, 'content.html'))) {
        return IslandSource.folder(folder, isProbe: relative.first == 'packaging');
      }
    }
  }
  return null;
}

/// The nearest `desktop-native` folder at or above [start] (recognised by its VERSION file and
/// app/pubspec.yaml).
String? _findDesktopNative(String start, bool Function(String) exists) {
  var dir = p.normalize(p.absolute(start));
  for (var i = 0; i < 24; i++) {
    for (final candidate in [dir, p.join(dir, 'desktop-native')]) {
      if (exists(p.join(candidate, 'VERSION')) && exists(p.join(candidate, 'app', 'pubspec.yaml'))) {
        return candidate;
      }
    }
    final parent = p.dirname(dir);
    if (parent == dir) break;
    dir = parent;
  }
  return null;
}

/// Only loopback dev servers: the macOS host never loads anything from the network.
bool isLoopbackDevUrl(Uri uri) =>
    (uri.scheme == 'http' || uri.scheme == 'https') &&
    (uri.host == '127.0.0.1' || uri.host == 'localhost' || uri.host == '::1' || uri.host == '[::1]');

/// Maps an island page URL (https://island.mastersat.example/...) onto [base].
Uri mapIslandUrl(String islandUrl, Uri base) {
  final uri = Uri.parse(islandUrl);
  if (uri.host != islandVirtualHost) {
    throw ArgumentError.value(islandUrl, 'islandUrl', 'not an island page');
  }
  final path = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;
  return base.resolve(path).replace(query: uri.hasQuery ? uri.query : null);
}

/// True when [url] stays on the island's origin ([base]) — everything else is refused.
bool isSameIslandOrigin(String url, Uri base) {
  final uri = Uri.tryParse(url);
  if (uri == null) return false;
  if (uri.scheme == 'about' && (url == 'about:blank' || url == 'about:srcdoc')) return true;
  return uri.scheme == base.scheme && uri.host == base.host && uri.port == base.port;
}

/// A loopback-only static file server for one folder (development). GET/HEAD only, no
/// directory listings, nothing outside the folder, no caching.
class IslandFolderServer {
  IslandFolderServer._(this.root, this._server);

  /// Serves [folder] on 127.0.0.1 at a random free port.
  static Future<IslandFolderServer> start(String folder) async {
    final root = p.normalize(p.absolute(folder));
    if (!Directory(root).existsSync()) {
      throw ArgumentError.value(folder, 'folder', 'does not exist');
    }
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final s = IslandFolderServer._(root, server);
    server.listen(s._handle);
    return s;
  }

  final String root;
  final HttpServer _server;

  /// http://127.0.0.1:port/
  Uri get origin => Uri(scheme: 'http', host: '127.0.0.1', port: _server.port, path: '/');

  static const Map<String, String> contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
    '.map': 'application/json; charset=utf-8',
  };

  /// The file [requestPath] names inside [root], or null when it escapes the folder.
  String? resolve(String requestPath) {
    var path = Uri.decodeComponent(requestPath);
    if (path.contains('\u0000')) return null;
    if (path.isEmpty || path.endsWith('/')) path = '${path}index.html';
    final full = p.normalize(p.join(root, path.startsWith('/') ? path.substring(1) : path));
    if (full != root && !p.isWithin(root, full)) return null;
    return full;
  }

  Future<void> _handle(HttpRequest request) async {
    final response = request.response;
    response.headers
      ..set(HttpHeaders.cacheControlHeader, 'no-store')
      ..set('X-Content-Type-Options', 'nosniff');
    try {
      if (request.method != 'GET' && request.method != 'HEAD') {
        response.statusCode = HttpStatus.methodNotAllowed;
        return;
      }
      String? path;
      try {
        path = resolve(request.uri.path);
      } on ArgumentError {
        path = null;
      }
      final file = path == null ? null : File(path);
      if (file == null || !file.existsSync()) {
        response.statusCode = HttpStatus.notFound;
        return;
      }
      response.headers.set(
        HttpHeaders.contentTypeHeader,
        contentTypes[p.extension(file.path).toLowerCase()] ?? 'application/octet-stream',
      );
      final bytes = await file.readAsBytes();
      response.contentLength = bytes.length;
      if (request.method == 'GET') response.add(bytes);
    } finally {
      await response.close();
    }
  }

  Future<void> close() => _server.close(force: true);
}

/// [IslandWebview] over webview_flutter (WKWebView on macOS).
class WkIslandWebview implements IslandWebview {
  WkIslandWebview(this.source);

  final IslandSource source;

  WebViewController? _controller;
  IslandFolderServer? _server;
  Uri? _base;

  final StreamController<String> _messages = StreamController.broadcast();
  final StreamController<WebviewProcessFailure> _failures = StreamController.broadcast();
  final StreamController<WebviewBlockedEvent> _blocked = StreamController.broadcast();
  final StreamController<String> _loadErrors = StreamController.broadcast();

  /// The origin the island is served from (after [initialize]).
  Uri? get base => _base;

  @override
  Future<void> initialize() async {
    if (_controller != null) return;
    final folder = source.folder;
    if (folder != null) {
      _server = await IslandFolderServer.start(folder);
      _base = _server!.origin;
    } else {
      _base = source.url;
    }
    final controller = WebViewController(
      onPermissionRequest: (request) {
        _blocked.add(WebviewBlockedEvent('permission', request.types.map((t) => t.name).join(',')));
        unawaited(request.deny());
      },
    );
    await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    try {
      await controller.setBackgroundColor(const Color(0xFFFFFFFF));
    } on UnimplementedError {
      // WKWebView on macOS cannot be made non-opaque through webview_flutter; white is its default.
    }
    await controller.addJavaScriptChannel('ms', onMessageReceived: (m) => _messages.add(m.message));
    await controller.setNavigationDelegate(
      NavigationDelegate(
        onNavigationRequest: (request) {
          final base = _base;
          if (base != null && isSameIslandOrigin(request.url, base)) return NavigationDecision.navigate;
          _blocked.add(WebviewBlockedEvent(request.isMainFrame ? 'navigation' : 'frame', request.url));
          return NavigationDecision.prevent;
        },
        onWebResourceError: (error) {
          if (error.errorType == WebResourceErrorType.webContentProcessTerminated) {
            _failures.add(WebviewProcessFailure(WebviewProcessFailedKind.renderProcessExited.index, -1, 0));
          } else if (error.isForMainFrame ?? true) {
            _loadErrors.add('load error ${error.errorCode}: ${error.description}');
          }
        },
        onHttpError: (error) {
          final code = error.response?.statusCode;
          if (code != null) _loadErrors.add('HTTP $code for ${error.request?.uri}');
        },
      ),
    );
    _controller = controller;
  }

  @override
  Future<void> mapIslandFolder(String folder) async {
    await _server?.close();
    _server = await IslandFolderServer.start(folder);
    _base = _server!.origin;
  }

  @override
  Future<void> setAllowedResourceHosts(List<String> hosts) async {
    // WKWebView offers no per-request filter through webview_flutter; the island's CSP limits
    // sub-resources on macOS. Development only.
  }

  @override
  Future<void> loadUrl(String url) async {
    final base = _base;
    if (_controller == null || base == null) throw StateError('WkIslandWebview is not initialized');
    await _controller!.loadRequest(mapIslandUrl(url, base));
  }

  @override
  Future<void> postWebMessage(String json) async {
    // JSON text is a valid JavaScript expression.
    await _controller?.runJavaScript('window.msIsland&&window.msIsland.receive($json);');
  }

  @override
  Stream<String> get webMessages => _messages.stream;

  @override
  Stream<WebviewProcessFailure> get processFailures => _failures.stream;

  @override
  Stream<WebviewBlockedEvent> get blocked => _blocked.stream;

  @override
  Stream<String> get loadErrors => _loadErrors.stream;

  @override
  Future<Uint8List?> capturePreview() async => null;

  @override
  Future<void> setVisible(bool visible) async {}

  @override
  Future<void> focus() async {}

  @override
  Future<void> releaseFocus() async {}

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null) return const SizedBox.expand();
    return WebViewWidget(controller: controller);
  }

  @override
  Future<void> dispose() async {
    _controller = null;
    await _server?.close();
    _server = null;
    await Future.wait([_messages.close(), _failures.close(), _blocked.close(), _loadErrors.close()]);
  }
}

/// The macOS development island host (WKWebView through webview_flutter).
class MacosIslandHost extends WebviewIslandHost {
  MacosIslandHost(
    super.kind, {
    required this.source,
    IslandWebviewFactory? webviewFactory,
    super.readyTimeout,
    super.now,
  }) : super(webviewFactory: webviewFactory ?? (() => WkIslandWebview(source)), canDrawOverIsland: true);

  final IslandSource source;

  /// A host that only reports why there is no island (no build found).
  static IslandHost unavailable(IslandKind kind, String reason) => _UnavailableIslandHost(kind, reason);
}

/// Shown when the macOS dev runner cannot find any island build.
class _UnavailableIslandHost extends IslandHost {
  _UnavailableIslandHost(this.kind, this.reason);

  @override
  final IslandKind kind;
  final String reason;
  final ValueNotifier<IslandHostState> _state = ValueNotifier(IslandHostState.idle);
  final StreamController<IslandEvent> _events = StreamController.broadcast();

  @override
  ValueListenable<IslandHostState> get stateListenable => _state;

  @override
  Stream<IslandEvent> get events => _events.stream;

  @override
  bool get canDrawOverIsland => true;

  @override
  Future<void> open() async {
    _state.value = IslandHostState.crashed;
    _events.add(IslandCrashedEvent(reason));
  }

  @override
  void post(IslandMessage message) {}

  @override
  void setBounds(Rect logical) {}

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: const Color(0xFFF8FAFC),
    child: Center(
      child: Text(
        'No island build: $reason',
        textDirection: TextDirection.ltr,
        style: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
      ),
    ),
  );

  @override
  Future<void> focus() async {}

  @override
  Future<void> releaseFocus() async {}

  @override
  Future<Uint8List?> capturePreview() async => null;

  @override
  Future<void> setVisible(bool visible) async {}

  @override
  Future<void> dispose() async {
    _state.value = IslandHostState.disposed;
    await _events.close();
  }
}

/// JSON helper for diagnostics.
String describeIslandSource(IslandSource? source) => jsonEncode(
  source == null ? null : {'folder': source.folder, 'url': source.url?.toString(), 'probe': source.isProbe},
);
