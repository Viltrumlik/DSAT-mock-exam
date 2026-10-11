// One midterm on screen: the exam engine's MidtermFlow (rules → code → pre-check → lock → the
// locked runner → handed in → done) with the pieces only the app can give it:
//
//  * a session good for the whole sitting: `auth.ensureFreshFor(2 h 30 min)` before the flow
//    starts, so no refresh is needed under lockdown (app-core's request);
//  * the runner (runner-ui's ExamRunnerScreen), keyed by the attempt id. The exam engine
//    asked for `headerExtra` / `banner` slots; the runner already draws the battery reading
//    and the low-battery banner from `battery:` (engine.battery), so those two are NOT drawn a
//    second time — only the refused-work and reconnecting strips go in the runner's `banner:`.
//    The off-screen warning and the note after returning are drawn by the flow over the
//    runner; the runner turns its shortcuts off during the countdown by itself, so `inert` and
//    `overlay` stay unused unless the question viewer cannot run (then a message covers it);
//  * one content island for the sitting, created the first time the paper is on screen (no
//    WebView2 on the rules / code / pre-check screens) and kept across a lost lock;
//  * the result ("See your report") and the update (Velopack, with the download as fallback).
//
// Every way out goes through MidtermFlow's exits, which release the machine first.
import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/models/models.dart';
import '../../features/home/update_controller.dart';
import '../../features/midterm/midterm_copy.dart';
import '../../features/midterm/midterm_flow.dart';
import '../../features/midterm/overlays.dart';
import '../../features/midterm/status_screens.dart';
import '../../island/island_host.dart';
import '../../native/native_bridge.dart';
import '../engine/exam_engine.dart';
import '../engine/midterm_engine.dart';
import '../runner/runner.dart';
import 'island_guard.dart';
import 'launch_ui.dart';
import 'pastpaper_sitting.dart' show SittingExit;

/// What the access token must still cover when a midterm starts (architecture §4.2).
const Duration midtermTokenHorizon = Duration(hours: 2, minutes: 30);

class MidtermSittingScreen extends StatefulWidget {
  const MidtermSittingScreen({
    super.key,
    required this.row,
    required this.engine,
    required this.native,
    required this.islandFactory,
    required this.onExit,
    this.auth,
    this.updates,
    this.openDownload,
    this.onDispose,
    this.islandDiagnostics,
    this.onDiagnostic,
    this.animate = true,
  });

  /// The Home row the student started from (rules extras: the scale, re-sit).
  final MidtermRow row;
  final MidtermEngine engine;
  final NativeBridge native;
  final IslandHostFactory islandFactory;

  /// `finished: true` = "See your report" (the launcher opens the result).
  final SittingExit onExit;

  /// Refreshes the session up front (null in tests that do not care).
  final AuthController? auth;

  /// The native updater for "Update now" on the update-required screen.
  final UpdateController? updates;

  /// "Download for Windows" (the website's installer link).
  final VoidCallback? openDownload;
  final VoidCallback? onDispose;
  final IslandDiagnostics? islandDiagnostics;
  final void Function(String where, String message)? onDiagnostic;
  final bool animate;

  @override
  State<MidtermSittingScreen> createState() => _MidtermSittingScreenState();
}

class _MidtermSittingScreenState extends State<MidtermSittingScreen> {
  late final MidtermFlowController _flow;
  ContentIslandGuard? _island;
  bool _ready = false;
  bool _leaving = false;

  MidtermEngine get e => widget.engine;

  @override
  void initState() {
    super.initState();
    _flow = MidtermFlowController(e);
    _flow.addListener(_onFlow);
    final auth = widget.auth;
    if (auth == null) {
      _ready = true;
    } else {
      unawaited(auth.ensureFreshFor(midtermTokenHorizon).then((_) {}, onError: (Object err) {
        widget.onDiagnostic?.call('auth', 'refresh before the midterm failed: $err');
      }).whenComplete(() {
        if (mounted) setState(() => _ready = true);
      }));
    }
  }

  /// The paper is on screen for the first time: start the question viewer now (the flow
  /// builds the runner in the frame that follows).
  void _onFlow() {
    if (_island != null) return;
    final v = _flow.view;
    if (v == MidtermView.running || v == MidtermView.transition) _ensureIsland();
  }

  ContentIslandGuard _ensureIsland() {
    final existing = _island;
    if (existing != null) return existing;
    final island = ContentIslandGuard(factory: widget.islandFactory, diagnostics: widget.islandDiagnostics)..start();
    island.unavailable.addListener(_rebuild);
    return _island = island;
  }

  void _rebuild() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _flow.removeListener(_onFlow);
    _island?.unavailable.removeListener(_rebuild);
    // Releases the machine and disposes the engine (the controller owns it).
    _flow.dispose();
    final island = _island;
    if (island != null) unawaited(island.dispose());
    super.dispose();
    widget.onDispose?.call();
  }

  void _exit({required bool finished}) {
    if (_leaving) return;
    _leaving = true;
    _flow.release();
    widget.onExit(finished: finished);
  }

  Future<void> _updateNow(void Function(int percent) onProgress) async {
    final u = widget.updates;
    if (u == null) throw StateError('no updater');
    void forward() => onProgress(u.percent);
    u.addListener(forward);
    try {
      await u.checkAndDownload();
    } finally {
      u.removeListener(forward);
    }
    if (u.phase == UpdatePhase.failed) throw StateError(u.error ?? 'The update could not be downloaded.');
    if (!u.isReady) throw StateError('No newer version was found.');
    _flow.release();
    u.restartToUpdate();
  }

  static String? _problemText(MidtermEngine e) {
    final p = e.problem.value;
    if (p == null || p.kind == EngineProblemKind.updateRequired) return null;
    return p.message;
  }

  Widget _runner(BuildContext context, MidtermRunnerSlots slots) {
    final island = _ensureIsland();
    final unavailable = island.unavailable.value;
    final text = _problemText(e);
    return ExamRunnerScreen(
      key: ValueKey(slots.session.attemptId),
      session: slots.session,
      islandFactory: widget.islandFactory,
      contentHost: island.host,
      // The battery reading in the header and the low-battery banner (not slots.headerExtra /
      // the battery part of slots.banner: the runner draws them once).
      battery: e.battery,
      banner: (text == null && e.online)
          ? null
          : Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [ProblemBanner(text: text), ReconnectingBanner(show: !e.online)],
            ),
      overlay: unavailable
          ? RunnerMessageScreen(
              key: const ValueKey('sitting.islandUnavailable'),
              title: IslandUnavailableCopy.title,
              body: IslandUnavailableCopy.body,
              primaryLabel: 'Back to Home',
              onPrimary: () => _exit(finished: false),
            )
          : null,
      animate: widget.animate,
      onDiagnostic: widget.onDiagnostic,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) return const MidtermWaitingScreen(key: ValueKey('sitting.refreshing'), message: MidtermCopy.opening);
    return MidtermFlow(
      controller: _flow,
      native: widget.native,
      runnerBuilder: _runner,
      onExit: () => _exit(finished: false),
      onOpenReport: () => _exit(finished: true),
      onUpdateNow: widget.updates == null ? null : _updateNow,
      onDownload: widget.openDownload,
      scoringScale: widget.row.scoringScale.isEmpty ? null : widget.row.scoringScale,
      isRetake: widget.row.resitOpen,
    );
  }
}
