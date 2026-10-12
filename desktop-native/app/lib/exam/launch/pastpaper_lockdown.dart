// A past paper's lockdown as the runner's window (0.2.4, the learning center's request:
// "full screen is mandatory on a past paper; leaving it shows the website's 10-second warning;
// unless they Save & Exit, it stays in lockdown like a midterm").
//
// `ms_lock_enter` IS full screen on Windows (borderless over the window's monitor, topmost,
// the keyboard guard), so the runner's window controls are the lock itself:
//
//  * isFullscreen      — the machine is locked and the lock was not lost;
//  * setFullscreen(on) — locks (the Welcome's Start, the warning's "Return to full screen");
//                        a refusal is handed to the sitting, which shows the pre-check;
//  * fullscreenLocked  — always: the runner enforces full screen, and the More menu has no
//                        "Full screen" / "Exit full screen" (the lock owns the window).
//
// The engine owns the LockdownController (the midterm's, unchanged) and lets go by itself;
// this adapter only reads it and asks for it.
import 'package:flutter/foundation.dart';

import '../engine/pastpaper_engine.dart';
import '../runner/runner_window.dart';

class LockdownWindowControls implements RunnerWindowControls {
  LockdownWindowControls({required this.engine, required this.onRefused}) {
    engine.lockdown.addListener(_sync);
    _sync();
  }

  final PastpaperEngine engine;

  /// The lock was refused (the pre-check failed, or Windows refused): the sitting covers the
  /// paper with the pre-check. Called before [setFullscreen] rethrows.
  final void Function(Object error) onRefused;

  final ValueNotifier<bool> _held = ValueNotifier(false);
  bool _disposed = false;

  void _sync() {
    if (_disposed) return;
    final l = engine.lockdown;
    _held.value = l.locked && !l.lost;
  }

  @override
  bool get fullscreenSupported => true;

  @override
  bool get fullscreenLocked => true;

  @override
  ValueListenable<bool> get isFullscreen => _held;

  @override
  Future<void> setFullscreen(bool on) async {
    // Leaving is not the runner's to do: Save & Exit (or the end of the paper) releases it.
    if (!on || _disposed) return;
    try {
      engine.lock();
    } on Object catch (e) {
      onRefused(e);
      rethrow;
    }
    _sync();
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    engine.lockdown.removeListener(_sync);
    _held.dispose();
  }
}
