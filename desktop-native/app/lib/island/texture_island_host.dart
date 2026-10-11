// TextureIslandHost — the Windows island host (architecture §2.4–2.6): one WebView2 drawn into a
// Flutter texture through the patched ms_webview2 plugin, so native overlays (highlight toolbar,
// More menu, navigator, dialogs) draw over the island (canDrawOverIsland = true).
//
// What the plugin already enforces natively, before the first navigation (plugins/ms_webview2/
// NOTICE): no accelerator keys, no context menu, no DevTools in release, navigation only to
// https://island.mastersat.example/, resources only from the island host (+ Desmos hosts for the
// Desmos island), no new windows / downloads / permissions, island host mapped to
// `<exe dir>\data\island`. This file adds the protocol on top (WebviewIslandHost, shared with the
// macOS development host): every page message is validated against island/protocol/schema.json
// (decodeIncoming) before anything sees it, outgoing messages are checked against the island
// kind, messages posted before `ready` wait in order, and a dead renderer or browser process is
// recreated and announced (IslandCrashedEvent → `ready` again → the owner replays init →
// module.load → media.put → question.show).
import 'dart:async';
import 'dart:collection';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:ms_webview2/ms_webview2.dart';

import 'island_host.dart';
import 'protocol.dart';

/// The extra https hosts each island may load sub-resources from (architecture §2.5). The
/// content island loads nothing from the network.
const Map<IslandKind, List<String>> islandAllowedResourceHosts = {
  IslandKind.content: [],
  IslandKind.desmos: ['www.desmos.com', '*.desmos.com'],
};

/// The virtual host the island folder is served from.
const String islandVirtualHost = 'island.mastersat.example';

/// The cursor an island may show. WebView2 asks for the hand over links and buttons; the app
/// never shows a hand cursor (no browser habits), so it becomes the arrow. Everything else
/// (I-beam over text, resize arrows on the divider) passes through.
MouseCursor islandCursorFor(SystemMouseCursor cursor) =>
    cursor == SystemMouseCursors.click ? SystemMouseCursors.basic : cursor;

/// The part of a web view the island hosts use. [MsWebview2IslandWebview] wraps the real
/// ms_webview2 controller (Windows); the macOS development host wraps WKWebView; tests
/// substitute a fake.
abstract class IslandWebview {
  Future<void> initialize();

  /// Re-map `https://island.mastersat.example/` to [folder] (the Windows plugin maps
  /// `<exe dir>\data\island` by itself; this is for development builds that serve the island
  /// from elsewhere).
  Future<void> mapIslandFolder(String folder);

  Future<void> setAllowedResourceHosts(List<String> hosts);
  Future<void> loadUrl(String url);

  /// PostWebMessageAsJson: [json] arrives in the page as a parsed object (`event.data`).
  Future<void> postWebMessage(String json);

  /// The JSON text of each page message (WebMessageReceived, undecoded).
  Stream<String> get webMessages;

  /// WebView2 ProcessFailed (or the platform's equivalent).
  Stream<WebviewProcessFailure> get processFailures;

  /// What the native island policy refused (diagnostics only).
  Stream<WebviewBlockedEvent> get blocked;

  /// The main page failed to load (diagnostics: a missing island build shows up here).
  Stream<String> get loadErrors;

  Future<Uint8List?> capturePreview();
  Future<void> setVisible(bool visible);
  Future<void> focus();
  Future<void> releaseFocus();
  Widget build(BuildContext context);
  Future<void> dispose();
}

/// [IslandWebview] over ms_webview2's [WebviewController].
class MsWebview2IslandWebview implements IslandWebview {
  MsWebview2IslandWebview([WebviewController? controller]) : controller = controller ?? WebviewController();

  final WebviewController controller;

  @override
  Future<void> initialize() => controller.initialize();

  @override
  Future<void> mapIslandFolder(String folder) => controller.addVirtualHostNameMapping(
        islandVirtualHost,
        folder,
        WebviewHostResourceAccessKind.denyCors,
      );

  @override
  Future<void> setAllowedResourceHosts(List<String> hosts) => controller.setAllowedResourceHosts(hosts);

  @override
  Future<void> loadUrl(String url) => controller.loadUrl(url);

  @override
  Future<void> postWebMessage(String json) => controller.postWebMessage(json);

  @override
  Stream<String> get webMessages => controller.webMessageRaw;

  @override
  Stream<WebviewProcessFailure> get processFailures => controller.onProcessFailed;

  @override
  Stream<WebviewBlockedEvent> get blocked => controller.onBlocked;

  @override
  Stream<String> get loadErrors => controller.onLoadError.map((status) => 'load error: ${status.name}');

  @override
  Future<Uint8List?> capturePreview() => controller.capturePreview();

  @override
  Future<void> setVisible(bool visible) => controller.setVisible(visible);

  @override
  Future<void> focus() => controller.focus();

  @override
  Future<void> releaseFocus() => WebviewController.releaseFocus();

  @override
  Widget build(BuildContext context) => Webview(controller, cursorMapper: islandCursorFor);

  @override
  Future<void> dispose() => controller.dispose();
}

typedef IslandWebviewFactory = IslandWebview Function();

/// The protocol half of an island host, over any [IslandWebview]. [TextureIslandHost] (Windows)
/// and MacosIslandHost (development) are this class with their own web view.
class WebviewIslandHost extends IslandHost {
  WebviewIslandHost(
    this.kind, {
    required this._webviewFactory,
    this.islandFolder,
    this.canDrawOverIsland = true,
    this.maxRecoveries = 3,
    this.recoveryWindow = const Duration(minutes: 1),
    this.maxQueuedMessages = 256,
    this.readyTimeout = const Duration(seconds: 15),
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  @override
  final IslandKind kind;

  /// Development only: serve the island from this folder instead of `<exe dir>\data\island`.
  final String? islandFolder;

  @override
  final bool canDrawOverIsland;

  /// At most this many automatic recreations within [recoveryWindow]; after that the host stays
  /// [IslandHostState.crashed] instead of looping.
  final int maxRecoveries;
  final Duration recoveryWindow;

  /// Messages posted before `ready` wait in order (bounded; the oldest is dropped).
  final int maxQueuedMessages;

  /// When the page has not said `ready` this long after loading started, [problem] says so
  /// (the state stays `loading`: a slow first start is not a crash).
  final Duration readyTimeout;

  final IslandWebviewFactory _webviewFactory;
  final DateTime Function() _now;

  final StreamController<IslandEvent> _events = StreamController<IslandEvent>.broadcast();
  final ValueNotifier<IslandHostState> _state = ValueNotifier(IslandHostState.idle);
  final ValueNotifier<IslandWebview?> _webview = ValueNotifier(null);
  final ValueNotifier<String?> _problem = ValueNotifier(null);
  final Queue<String> _pending = Queue<String>();
  final List<DateTime> _recoveries = [];
  final List<StreamSubscription<Object?>> _subscriptions = [];

  Timer? _readyTimer;
  bool _visible = true;
  bool _recovering = false;

  /// The last policy refusals (diagnostics; at most 50).
  final List<WebviewBlockedEvent> blocked = [];

  @override
  ValueListenable<IslandHostState> get stateListenable => _state;

  @override
  Stream<IslandEvent> get events => _events.stream;

  /// What is wrong right now, in words (initialization failed, the page did not load, no
  /// `ready`), or null. Diagnostics and the S1 harness show it; it is never student-facing.
  ValueListenable<String?> get problem => _problem;

  /// How many times the island was recreated after a crash.
  int get recoveries => _recoveries.length;

  /// Messages waiting for `ready`.
  int get queuedMessages => _pending.length;

  @override
  Future<void> open() async {
    _checkNotDisposed();
    if (_state.value != IslandHostState.idle) {
      throw StateError('${runtimeType.toString()}(${kind.name}) is already open');
    }
    await _create();
  }

  Future<void> _create() async {
    _state.value = IslandHostState.loading;
    final webview = _webviewFactory();
    _webview.value = webview;
    _subscriptions
      ..add(webview.webMessages.listen((raw) => _onRaw(webview, raw)))
      ..add(webview.processFailures.listen((f) => _onProcessFailed(webview, f)))
      ..add(webview.blocked.listen(_onBlocked))
      ..add(webview.loadErrors.listen((e) => _onLoadError(webview, e)));
    try {
      await webview.initialize();
      if (!_isCurrent(webview)) return;
      final folder = islandFolder;
      if (folder != null) await webview.mapIslandFolder(folder);
      await webview.setAllowedResourceHosts(islandAllowedResourceHosts[kind] ?? const []);
      if (!_visible) await webview.setVisible(false);
      if (!_isCurrent(webview)) return;
      _armReadyTimer();
      await webview.loadUrl(islandPageUrl(kind));
    } on Object catch (error) {
      if (!_isCurrent(webview)) return;
      // No web view (for example the WebView2 runtime is missing): there is nothing to recreate
      // automatically; the state stays crashed and the owner decides what the student sees.
      _readyTimer?.cancel();
      _state.value = IslandHostState.crashed;
      _problem.value = 'the island could not start: $error';
      _events.add(IslandCrashedEvent('initialize failed: $error'));
      rethrow;
    }
  }

  bool _isCurrent(IslandWebview webview) =>
      identical(_webview.value, webview) && _state.value != IslandHostState.disposed;

  void _armReadyTimer() {
    _readyTimer?.cancel();
    _readyTimer = Timer(readyTimeout, () {
      if (_state.value == IslandHostState.loading) {
        _problem.value ??= 'the island page did not say ready within ${readyTimeout.inSeconds} s';
      }
    });
  }

  void _onRaw(IslandWebview from, String raw) {
    if (!_isCurrent(from)) return;
    final event = decodeIncoming(kind, raw);
    if (event is IslandMessageEvent) {
      final m = event.message;
      final isReady = kind == IslandKind.content ? m is ReadyMessage : m is DesmosReadyMessage;
      if (isReady) {
        _readyTimer?.cancel();
        _problem.value = null;
        _state.value = IslandHostState.ready;
        _events.add(event);
        _flush();
        return;
      }
    }
    _events.add(event);
  }

  void _onLoadError(IslandWebview from, String error) {
    if (!_isCurrent(from)) return;
    _problem.value = error;
  }

  void _flush() {
    final webview = _webview.value;
    if (webview == null) return;
    while (_pending.isNotEmpty) {
      unawaited(webview.postWebMessage(_pending.removeFirst()));
    }
  }

  @override
  void post(IslandMessage message) {
    if (!islandAcceptsOutgoing(kind, message)) {
      assert(false, '${message.t} cannot be posted to the ${kind.name} island');
      return;
    }
    final state = _state.value;
    if (state == IslandHostState.disposed) return;
    final json = message.encode();
    final webview = _webview.value;
    if (state == IslandHostState.ready && webview != null) {
      unawaited(webview.postWebMessage(json));
      return;
    }
    if (_pending.length >= maxQueuedMessages) _pending.removeFirst();
    _pending.add(json);
  }

  void _onBlocked(WebviewBlockedEvent event) {
    if (blocked.length >= 50) blocked.removeAt(0);
    blocked.add(event);
  }

  void _onProcessFailed(IslandWebview from, WebviewProcessFailure failure) {
    if (!_isCurrent(from)) return;
    switch (failure.kind) {
      // WebView2 restarts these by itself; the page survives.
      case WebviewProcessFailedKind.gpuProcessExited:
      case WebviewProcessFailedKind.utilityProcessExited:
      case WebviewProcessFailedKind.sandboxHelperProcessExited:
      case WebviewProcessFailedKind.ppapiPluginProcessExited:
      case WebviewProcessFailedKind.frameRenderProcessExited:
        return;
      case WebviewProcessFailedKind.browserProcessExited:
      case WebviewProcessFailedKind.renderProcessExited:
      case WebviewProcessFailedKind.renderProcessUnresponsive:
      case WebviewProcessFailedKind.unknown:
        unawaited(_recover(failure));
    }
  }

  Future<void> _recover(WebviewProcessFailure failure) async {
    if (_recovering) return;
    _recovering = true;
    try {
      _readyTimer?.cancel();
      _state.value = IslandHostState.crashed;
      // Messages for the dead page are meaningless; the owner replays from its own state.
      _pending.clear();
      _events.add(IslandCrashedEvent(failure.toString()));
      final now = _now();
      _recoveries.removeWhere((t) => now.difference(t) > recoveryWindow);
      if (_recoveries.length >= maxRecoveries) {
        _problem.value = 'the island crashed $maxRecoveries times within ${recoveryWindow.inSeconds} s';
        return;
      }
      _recoveries.add(now);
      await _teardownWebview();
      if (_state.value == IslandHostState.disposed) return;
      try {
        await _create();
      } on Object {
        // _create already reported it (crashed + IslandCrashedEvent + problem).
      }
    } finally {
      _recovering = false;
    }
  }

  Future<void> _teardownWebview() async {
    for (final s in _subscriptions) {
      await s.cancel();
    }
    _subscriptions.clear();
    final old = _webview.value;
    _webview.value = null;
    if (old != null) {
      try {
        await old.dispose();
      } on Object {
        // A dead controller may fail to dispose; the next one is independent.
      }
    }
  }

  @override
  void setBounds(Rect logical) {
    // Texture mode: the widget's layout decides the island rectangle.
  }

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<IslandWebview?>(
        valueListenable: _webview,
        builder: (context, webview, _) => ColoredBox(
          // The page background, so a recreated island never flashes another colour.
          color: const Color(0xFFFFFFFF),
          child: webview == null ? const SizedBox.expand() : webview.build(context),
        ),
      );

  @override
  Future<void> focus() async => _webview.value?.focus();

  @override
  Future<void> releaseFocus() async {
    if (_state.value == IslandHostState.ready) post(const FocusReleaseMessage());
    await _webview.value?.releaseFocus();
  }

  @override
  Future<Uint8List?> capturePreview() async {
    final webview = _webview.value;
    if (webview == null || _state.value == IslandHostState.disposed) return null;
    try {
      return await webview.capturePreview();
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  @override
  Future<void> setVisible(bool visible) async {
    _visible = visible;
    await _webview.value?.setVisible(visible);
  }

  @override
  Future<void> dispose() async {
    if (_state.value == IslandHostState.disposed) return;
    _state.value = IslandHostState.disposed;
    _readyTimer?.cancel();
    _pending.clear();
    await _teardownWebview();
    await _events.close();
  }

  void _checkNotDisposed() {
    if (_state.value == IslandHostState.disposed) throw StateError('${runtimeType.toString()} is disposed');
  }
}

/// The Windows island host: WebView2 in a Flutter texture (ms_webview2).
class TextureIslandHost extends WebviewIslandHost {
  TextureIslandHost(
    super.kind, {
    IslandWebviewFactory? webviewFactory,
    super.islandFolder,
    super.maxRecoveries,
    super.recoveryWindow,
    super.maxQueuedMessages,
    super.readyTimeout,
    super.now,
  }) : super(webviewFactory: webviewFactory ?? MsWebview2IslandWebview.new, canDrawOverIsland: true);

  /// The installed WebView2 runtime version, or null when it is missing (or not on Windows).
  static Future<String?> runtimeVersion() async {
    try {
      return await WebviewController.getWebViewVersion();
    } on Object {
      return null;
    }
  }
}
