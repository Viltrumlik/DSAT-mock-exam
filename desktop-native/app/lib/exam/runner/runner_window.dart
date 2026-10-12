// What the runner needs from the app window (architecture §7 #10: "Full screen (More) —
// Native, through Rust"). The integrator implements it over the window plugin / native
// bridge; null means the window cannot change (the More menu then hides "Full screen", as
// MoreMenu.tsx does with `fullscreenAvailable={false}`), and a midterm's lockdown window is
// already full screen.
//
// A past paper's lockdown (0.2.4) owns the window instead: its controls report
// [RunnerWindowControls.fullscreenLocked], and the runner then enforces full screen the way
// ExamRunnerPage.tsx does — Start must reach it, leaving it shows the full-screen warning with
// its 10-second countdown, and the More menu offers no way out of it.
import 'package:flutter/foundation.dart';

abstract class RunnerWindowControls {
  /// Whether the window can enter/leave full screen here.
  bool get fullscreenSupported;

  /// The current state (the More menu reads "Full screen" / "Exit full screen").
  ValueListenable<bool> get isFullscreen;

  /// Full screen is held by something the student does not toggle (a past paper's lockdown):
  /// it is mandatory while a module is on screen (leaving it shows the full-screen warning),
  /// Start does not start the clock without it, and the More menu hides "Full screen" /
  /// "Exit full screen". [setFullscreen] (true) is how the runner asks for it back.
  bool get fullscreenLocked;

  Future<void> setFullscreen(bool on);
}

/// In-memory controls for tests and fixture mode.
class FakeRunnerWindowControls implements RunnerWindowControls {
  FakeRunnerWindowControls({this.fullscreenSupported = true, this.fullscreenLocked = false, bool initial = false})
    : _full = ValueNotifier(initial);

  @override
  final bool fullscreenSupported;

  @override
  final bool fullscreenLocked;

  final ValueNotifier<bool> _full;

  /// Every call, in order ("fullscreen on" / "fullscreen off").
  final List<String> log = [];

  /// When set, [setFullscreen] throws it (the window or the lock refused).
  Object? refuse;

  @override
  ValueListenable<bool> get isFullscreen => _full;

  @override
  Future<void> setFullscreen(bool on) async {
    log.add('fullscreen ${on ? 'on' : 'off'}');
    final error = refuse;
    if (error != null) throw error;
    _full.value = on;
  }

  /// The window left (or re-entered) full screen without the runner asking — Windows, or a
  /// lockdown that let go.
  void simulateExternal(bool on) => _full.value = on;

  void dispose() => _full.dispose();
}
