// What the runner needs from the app window (architecture §7 #10: "Full screen (More) —
// Native, through Rust"). The integrator implements it over the window plugin / native
// bridge; null means the window cannot change (the More menu then hides "Full screen", as
// MoreMenu.tsx does with `fullscreenAvailable={false}`), and a midterm's lockdown window is
// already full screen.
import 'package:flutter/foundation.dart';

abstract class RunnerWindowControls {
  /// Whether the window can enter/leave full screen here.
  bool get fullscreenSupported;

  /// The current state (the More menu reads "Full screen" / "Exit full screen").
  ValueListenable<bool> get isFullscreen;

  Future<void> setFullscreen(bool on);
}

/// In-memory controls for tests and fixture mode.
class FakeRunnerWindowControls implements RunnerWindowControls {
  FakeRunnerWindowControls({this.fullscreenSupported = true, bool initial = false}) : _full = ValueNotifier(initial);

  @override
  final bool fullscreenSupported;

  final ValueNotifier<bool> _full;

  /// Every call, in order ("fullscreen on" / "fullscreen off").
  final List<String> log = [];

  @override
  ValueListenable<bool> get isFullscreen => _full;

  @override
  Future<void> setFullscreen(bool on) async {
    log.add('fullscreen ${on ? 'on' : 'off'}');
    _full.value = on;
  }

  void dispose() => _full.dispose();
}
