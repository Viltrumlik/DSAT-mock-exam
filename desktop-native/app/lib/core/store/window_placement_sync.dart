// Remembers the main window's size and position per student (architecture §6 "Window
// behaviour": size and position are remembered). The Windows runner (windows-host) owns the
// native half:
//
//   MethodChannel('mastersat/window')
//     Dart → native  'restorePlacement'  {x, y, width, height, maximized} — apply if on-screen
//     native → Dart  'placementChanged'  {x, y, width, height, maximized} — after a move/resize
//                                         ends (WM_EXITSIZEMOVE) or the window is maximised
//
// Without the native half (tests, the macOS dev runner) this does nothing.
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'settings_store.dart';

class WindowPlacementSync {
  WindowPlacementSync({this._channel = const MethodChannel(channelName), this.debounce = const Duration(milliseconds: 500)}) {
    _channel.setMethodCallHandler(_handle);
  }

  static const channelName = 'mastersat/window';

  final MethodChannel _channel;
  final Duration debounce;
  SettingsStore? _settings;
  Timer? _pending;
  WindowPlacement? _latest;

  /// Restores [settings]' saved placement and saves later changes there.
  Future<void> attach(SettingsStore settings) async {
    _settings = settings;
    final saved = settings.windowPlacement;
    if (saved == null) return;
    try {
      await _channel.invokeMethod<void>('restorePlacement', saved.toJson());
    } on MissingPluginException {
      // No native half.
    } on PlatformException catch (e) {
      debugPrint('mastersat/window restorePlacement failed: ${e.message}');
    }
  }

  void detach() {
    _flush();
    _settings = null;
  }

  Future<Object?> _handle(MethodCall call) async {
    if (call.method != 'placementChanged' || call.arguments is! Map) return null;
    try {
      _latest = WindowPlacement.fromJson((call.arguments as Map).cast<String, Object?>());
    } catch (_) {
      return null;
    }
    _pending?.cancel();
    _pending = Timer(debounce, _flush);
    return null;
  }

  void _flush() {
    _pending?.cancel();
    _pending = null;
    final p = _latest;
    final s = _settings;
    if (p == null || s == null || p == s.windowPlacement) return;
    unawaited(s.setWindowPlacement(p));
  }

  void dispose() {
    _pending?.cancel();
    _channel.setMethodCallHandler(null);
  }
}
