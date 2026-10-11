// One past-paper sitting on screen: the PastpaperEngine (opened by the launcher) rendered by
// the runner, plus what the runner leaves to its owner:
//
//  * the content island, created and opened at once (ContentIslandGuard) — its start-up
//    overlaps the engine's `open` request; "Questions can't be shown on this computer" when
//    WebView2 cannot run;
//  * a load that failed (offline on a first open, a server error, a paper no longer
//    assigned): the engine's own words with "Try again" (retryOpen) and "Back to Home";
//  * a send the server keeps refusing: a strip under the header with "Try again" (retrySend);
//  * the battery reading (polled every 30 s, as the website does inside the app);
//  * full screen (More → Full screen; Start enters it, as on the website) and, on the way out,
//    the window put back;
//  * the display kept awake while the sitting is open (architecture §6).
//
// The runner is keyed by the attempt id (one screen per sitting); it mounts once the attempt
// is known. Report a problem goes through the default path, ExamSession.reportProblem — the
// engine queues `POST /api/question-reports/reports/` on the outbox's low lane with an
// idempotency key.
import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../island/island_host.dart';
import '../../native/native_bridge.dart';
import '../engine/exam_engine.dart';
import '../engine/pastpaper_engine.dart';
import '../runner/icons/lucide_glyphs.dart';
import '../runner/runner.dart';
import '../runner/status_screens.dart';
import '../session_contract.dart';
import 'battery_poller.dart';
import 'island_guard.dart';
import 'launch_ui.dart';
import 'window_controls.dart';

/// How a sitting ended, for the launcher (it becomes the ExamOutcome).
typedef SittingExit = void Function({required bool finished});

class PastpaperSittingScreen extends StatefulWidget {
  const PastpaperSittingScreen({
    super.key,
    required this.engine,
    required this.native,
    required this.islandFactory,
    required this.onExit,
    this.onDispose,
    this.window,
    this.islandDiagnostics,
    this.onDiagnostic,
    this.batteryPeriod = const Duration(seconds: 30),
    this.animate = true,
  });

  /// Opened by the launcher (`rt.pastpaper(id).open()`).
  final PastpaperEngine engine;
  final NativeBridge native;
  final IslandHostFactory islandFactory;
  final SittingExit onExit;

  /// The screen is gone (the launcher disposes the engine here, after the runner let go).
  final VoidCallback? onDispose;
  final NativeRunnerWindowControls? window;
  final IslandDiagnostics? islandDiagnostics;
  final void Function(String where, String message)? onDiagnostic;
  final Duration batteryPeriod;
  final bool animate;

  @override
  State<PastpaperSittingScreen> createState() => _PastpaperSittingScreenState();
}

class _PastpaperSittingScreenState extends State<PastpaperSittingScreen> {
  late final ContentIslandGuard _island;
  late final BatteryPoller _battery;
  bool _leaving = false;

  PastpaperEngine get e => widget.engine;

  @override
  void initState() {
    super.initState();
    _island = ContentIslandGuard(factory: widget.islandFactory, diagnostics: widget.islandDiagnostics)..start();
    _battery = BatteryPoller(widget.native, period: widget.batteryPeriod);
    _keepAwake(true);
    e.addListener(_rebuild);
    e.problem.addListener(_rebuild);
    _island.unavailable.addListener(_rebuild);
  }

  void _keepAwake(bool on) {
    try {
      widget.native.keepAwake(on);
    } on Object catch (err) {
      widget.onDiagnostic?.call('power', 'keep awake ${on ? 'on' : 'off'} failed: $err');
    }
  }

  void _rebuild() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    e.removeListener(_rebuild);
    if (!e.disposed) e.problem.removeListener(_rebuild);
    _island.unavailable.removeListener(_rebuild);
    unawaited(_island.dispose());
    _battery.dispose();
    _keepAwake(false);
    unawaited(widget.window?.restore());
    super.dispose();
    widget.onDispose?.call();
  }

  void _exit({required bool finished}) {
    if (_leaving) return;
    _leaving = true;
    unawaited(widget.window?.restore());
    widget.onExit(finished: finished);
  }

  void _onRunnerExit(RunnerExit exit) => _exit(finished: exit.reason == ExamDoneReason.submitted);

  /// Leaving because the questions cannot be shown: pause on the server when the clock runs.
  Future<void> _leaveUnavailable() async {
    if (e.phase == ExamPhase.running || e.phase == ExamPhase.review) {
      try {
        await e.saveAndExit();
      } on Object {
        // The answers are on disk either way.
      }
    }
    _exit(finished: false);
  }

  static String _titleFor(EngineProblemKind k) => switch (k) {
    EngineProblemKind.notAvailable => 'This paper isn’t available',
    EngineProblemKind.updateRequired => 'Update MasterSAT to continue',
    EngineProblemKind.storageFailed => 'Your saved work couldn’t be read',
    _ => 'This paper couldn’t be opened',
  };

  Widget? _banner() {
    final p = e.problem.value;
    if (p == null || e.phase == ExamPhase.loading) return null;
    return switch (p.kind) {
      // The app-wide update card covers this one.
      EngineProblemKind.updateRequired => null,
      EngineProblemKind.sendStuck => RunnerProblemBanner(
        text: p.message,
        onRetry: p.canRetry ? () => unawaited(e.retrySend()) : null,
      ),
      _ => RunnerProblemBanner(text: p.message),
    };
  }

  @override
  Widget build(BuildContext context) {
    final problem = e.problem.value;
    if (e.phase == ExamPhase.loading && problem != null) {
      return RunnerMessageScreen(
        key: const ValueKey('sitting.loadFailed'),
        icon: problem.kind == EngineProblemKind.loadFailed ? LucideGlyphs.cloudOff : LucideGlyphs.triangleAlert,
        title: _titleFor(problem.kind),
        body: problem.message,
        primaryLabel: problem.canRetry ? 'Try again' : null,
        onPrimary: problem.canRetry ? () => unawaited(e.retryOpen()) : null,
        secondaryLabel: 'Back to Home',
        onSecondary: () => _exit(finished: false),
      );
    }
    if (e.attemptId == 0) {
      // Still opening: the runner mounts once the attempt is known (it is keyed by its id).
      return LoadingScreen(key: const ValueKey('sitting.loading'), animate: widget.animate);
    }
    final unavailable = _island.unavailable.value;
    return ExamRunnerScreen(
      key: ValueKey(e.attemptId),
      session: e,
      islandFactory: widget.islandFactory,
      contentHost: _island.host,
      window: widget.window,
      battery: _battery,
      banner: _banner(),
      overlay: unavailable
          ? RunnerMessageScreen(
              key: const ValueKey('sitting.islandUnavailable'),
              title: IslandUnavailableCopy.title,
              body: IslandUnavailableCopy.body,
              primaryLabel: 'Back to Home',
              onPrimary: () => unawaited(_leaveUnavailable()),
            )
          : null,
      animate: widget.animate,
      onExit: _onRunnerExit,
      onDiagnostic: widget.onDiagnostic,
    );
  }
}
