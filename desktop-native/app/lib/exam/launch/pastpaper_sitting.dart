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
//  * the machine LOCKDOWN (0.2.4, the learning center's request), exactly as a midterm locks:
//    the engine's LockdownController (`ms_lock_enter`, the 3 s heartbeat, the silent re-lock),
//    taken on the Welcome's Start and at once when a running sitting is reopened, and held
//    through the module transition until Save & Exit (the countdown's too), the hand-in of the
//    last module, or any other way out (an error → Home, dispose, the window closing). The lock
//    IS the runner's full screen (LockdownWindowControls): leaving it shows the website's
//    full-screen warning and its 10-second countdown; the More menu has no "Full screen".
//    A refused lock (the pre-check failed) shows the midterm's pre-check screen, saying "test":
//    "Lock and start" / "Lock and resume", Back to Home. A past paper never starts unlocked,
//    and a running one is never on screen unlocked except under that warning. No off-screen
//    strikes and no server session — the lock is local;
//  * the display kept awake while the sitting is open (architecture §6).
//
// The runner is keyed by the attempt id (one screen per sitting); it mounts once the attempt
// is known. Report a problem goes through the default path, ExamSession.reportProblem — the
// engine queues `POST /api/question-reports/reports/` on the outbox's low lane with an
// idempotency key.
import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../features/midterm/midterm_copy.dart' show PrecheckCopy;
import '../../features/midterm/precheck_screen.dart';
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
import 'pastpaper_lockdown.dart';

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
  final IslandDiagnostics? islandDiagnostics;
  final void Function(String where, String message)? onDiagnostic;
  final Duration batteryPeriod;
  final bool animate;

  @override
  State<PastpaperSittingScreen> createState() => _PastpaperSittingScreenState();
}

/// Which pre-check covers the paper: before the clock starts, or over a running sitting.
enum _Precheck { start, resume }

class _PastpaperSittingScreenState extends State<PastpaperSittingScreen> {
  late final ContentIslandGuard _island;
  late final BatteryPoller _battery;
  late final LockdownWindowControls _window;
  bool _leaving = false;

  /// Back from the resume pre-check: Save & Exit is on its way.
  bool _saving = false;
  _Precheck? _precheck;

  PastpaperEngine get e => widget.engine;

  @override
  void initState() {
    super.initState();
    _island = ContentIslandGuard(factory: widget.islandFactory, diagnostics: widget.islandDiagnostics)..start();
    _battery = BatteryPoller(widget.native, period: widget.batteryPeriod);
    _window = LockdownWindowControls(engine: e, onRefused: _onLockRefused);
    _keepAwake(true);
    e.addListener(_onEngine);
    e.lockdown.addListener(_onEngine);
    e.problem.addListener(_rebuild);
    _island.unavailable.addListener(_rebuild);
    _ensureLocked(); // a cached copy may already be running
  }

  void _onEngine() {
    _ensureLocked();
    _rebuild();
  }

  /// A running paper is never on screen unlocked: the reopen of a running sitting locks at once
  /// (Start locks through the runner); a refusal covers the paper with the pre-check. A lock the
  /// watchdog took away and could not silently re-take ([LockdownController.lost]) is the
  /// runner's full-screen warning instead, as on the website.
  void _ensureLocked() {
    if (_leaving || !mounted) return;
    if (_precheck != null) {
      // The sitting ended under the pre-check (finished elsewhere, the last module in): the
      // runner says so and leaves.
      if (e.phase == ExamPhase.done || e.phase == ExamPhase.submitting) _precheck = null;
      return;
    }
    final l = e.lockdown;
    if (!e.lockdownWanted || l.locked || l.lost) return;
    try {
      e.lock();
    } on Object catch (err) {
      _precheck = _Precheck.resume;
      widget.onDiagnostic?.call('lockdown', 'lock refused on reopen: $err');
    }
  }

  /// Start, or "Return to full screen", could not lock: show what must change.
  void _onLockRefused(Object err) {
    widget.onDiagnostic?.call('lockdown', 'lock refused: $err');
    if (!mounted || _leaving) return;
    setState(() => _precheck = e.phase == ExamPhase.welcome ? _Precheck.start : _Precheck.resume);
  }

  /// "Lock and start" / "Lock and resume". Throws what the pre-check shows (PrecheckFailed:
  /// the checklist; anything else: the line under it).
  Future<void> _lockAndContinue() async {
    e.lock();
    if (_precheck == _Precheck.start && e.phase == ExamPhase.welcome) await e.start();
    if (mounted) setState(() => _precheck = null);
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
    e.removeListener(_onEngine);
    if (!e.disposed) {
      e.lockdown.removeListener(_onEngine);
      e.problem.removeListener(_rebuild);
      e.releaseLock(); // every way out releases the machine
    }
    _window.dispose();
    _island.unavailable.removeListener(_rebuild);
    unawaited(_island.dispose());
    _battery.dispose();
    _keepAwake(false);
    super.dispose();
    widget.onDispose?.call();
  }

  void _exit({required bool finished}) {
    if (_leaving) return;
    _leaving = true;
    if (!e.disposed) e.releaseLock();
    widget.onExit(finished: finished);
  }

  void _onRunnerExit(RunnerExit exit) => _exit(finished: exit.reason == ExamDoneReason.submitted);

  /// Leaving from over a running paper (the questions cannot be shown; Back on the resume
  /// pre-check): Save & Exit first — the server pauses the clock — then Home.
  Future<void> _saveAndLeave() async {
    if (_leaving || _saving) return;
    if (e.phase == ExamPhase.running || e.phase == ExamPhase.review) {
      setState(() => _saving = true);
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
    if (_saving) {
      return LoadingScreen(
        key: const ValueKey('sitting.saving'),
        label: 'Saving your progress…',
        animate: widget.animate,
      );
    }
    if (e.attemptId == 0) {
      // Still opening: the runner mounts once the attempt is known (it is keyed by its id).
      return LoadingScreen(key: const ValueKey('sitting.loading'), animate: widget.animate);
    }
    final pre = _precheck;
    if (pre != null) {
      return MidtermPrecheckScreen(
        key: ValueKey('sitting.precheck.${pre.name}'),
        native: widget.native,
        resume: pre == _Precheck.resume,
        copy: PrecheckCopy.test,
        onContinue: _lockAndContinue,
        // Before Start nothing runs yet; over a running paper, Save & Exit first.
        onBack: pre == _Precheck.start ? () => _exit(finished: false) : () => unawaited(_saveAndLeave()),
      );
    }
    final l = e.lockdown;
    if (e.lockdownWanted && !l.locked && !l.lost) {
      // The lock is being taken (or the sitting is leaving): never the paper unlocked.
      return LoadingScreen(key: const ValueKey('sitting.locking'), animate: widget.animate);
    }
    final unavailable = _island.unavailable.value;
    return ExamRunnerScreen(
      key: ValueKey(e.attemptId),
      session: e,
      islandFactory: widget.islandFactory,
      contentHost: _island.host,
      // The lockdown is the window: mandatory full screen, the warning, no More → Full screen.
      window: _window,
      // The app-wide update card covers the runner (and the engine let the machine go for it):
      // nothing here may count the student out from under it.
      inert: e.problem.value?.kind == EngineProblemKind.updateRequired,
      battery: _battery,
      banner: _banner(),
      overlay: unavailable
          ? RunnerMessageScreen(
              key: const ValueKey('sitting.islandUnavailable'),
              title: IslandUnavailableCopy.title,
              body: IslandUnavailableCopy.body,
              primaryLabel: 'Back to Home',
              onPrimary: () => unawaited(_saveAndLeave()),
            )
          : null,
      // Scientific-only papers (junior midterms) get Desmos's Scientific calculator, as on the
      // website; the native one is only the offline / Desmos-failed fallback.
      nativeScientificOnly: false,
      animate: widget.animate,
      onExit: _onRunnerExit,
      onDiagnostic: widget.onDiagnostic,
    );
  }
}
