// More → Full screen on a past paper (architecture §7 #10), backed by the real window.
//
// The native half is the Windows runner's `mastersat/window` channel (windows/runner/
// flutter_window.cpp): `setFullscreen {on}` → bool. Full screen is borderless over the
// window's monitor; leaving restores the exact placement (style, size, maximised). The runner
// refuses while the window is already borderless — a midterm's lockdown owns the window then —
// and the remembered placement is never saved from the full-screen rectangle.
//
// macOS (development runner): no implementation; the More menu hides "Full screen" (null), as
// the website does when the Fullscreen API is unavailable.
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../runner/runner_window.dart';

class NativeRunnerWindowControls implements RunnerWindowControls {
  NativeRunnerWindowControls({this._channel = const MethodChannel(channelName)});

  static const channelName = 'mastersat/window';

  final MethodChannel _channel;
  final ValueNotifier<bool> _full = ValueNotifier(false);
  bool _disposed = false;

  @override
  bool get fullscreenSupported => true;

  @override
  ValueListenable<bool> get isFullscreen => _full;

  @override
  Future<void> setFullscreen(bool on) async {
    if (_disposed) return;
    bool applied;
    try {
      applied = await _channel.invokeMethod<bool>('setFullscreen', {'on': on}) ?? false;
    } on MissingPluginException {
      applied = false;
    }
    if (_disposed) return;
    if (!applied) throw StateError('the window refused ${on ? 'full screen' : 'leaving full screen'}');
    _full.value = on;
  }

  /// Leaves full screen if this sitting entered it (back on Home the window is normal again).
  Future<void> restore() async {
    if (!_full.value || _disposed) return;
    try {
      await setFullscreen(false);
    } on Object {
      // The window keeps its state; nothing to tell the student.
    }
  }

  void dispose() {
    _disposed = true;
    _full.dispose();
  }
}

/// Window controls for this platform: the native runner on Windows, none elsewhere.
NativeRunnerWindowControls? platformWindowControls({required bool isWindows}) =>
    isWindows ? NativeRunnerWindowControls() : null;
