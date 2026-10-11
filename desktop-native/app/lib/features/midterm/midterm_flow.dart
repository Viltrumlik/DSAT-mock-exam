// A midterm in the app, end to end: rules → access code → pre-check → lock + bind → open → the
// locked runner (heartbeat, off-screen rule, battery) → handed in → released → the result.
// Ported from 0.1.0's MidtermScreen.tsx, on top of the MidtermEngine.
//
// The screen is DERIVED from the engine (the attempt, the server's refusal, the lock) and the
// few choices the student made on the way in — never stored as "the current screen" — so a
// resume, a lost lock or a moved session all land on the right screen however they arrive.
//
// Three invariants:
//  * a running paper is never on screen unlocked (resume or a lost lock → the pre-check, in
//    resume mode, covering the paper);
//  * every way out — done, forfeit, moved, update, an error, dispose — releases the machine;
//  * a blip never ejects a student: refusals that can be fixed silently are, inside the engine.
import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../core/api/v1_api.dart';
import '../../core/models/models.dart';
import '../../exam/engine/midterm_engine.dart';
import '../../exam/session_contract.dart';
import '../../native/native_bridge.dart';
import 'code_screen.dart';
import 'midterm_copy.dart';
import 'overlays.dart';
import 'precheck_screen.dart';
import 'rules_screen.dart';
import 'status_screens.dart';

/// What the flow shows.
enum MidtermView {
  /// prepare is in flight.
  opening,

  /// prepare failed (no connection, server error): Try again / Back.
  openFailed,
  rules,
  code,
  precheck,

  /// The paper is running but not locked here (a restart, a lost lock, a refusal).
  resumePrecheck,
  running,

  /// Between modules, waiting for the server's Module 2.
  transition,

  /// The module boundary passed with no connection.
  offlineWaiting,

  /// The last module is being handed in.
  submitting,

  /// The off-screen rule ended the sitting (shown for a moment, then the result).
  terminated,
  done,
  sessionMoved,
  updateRequired,

  /// The server said the sitting is not live; the engine is re-reading it.
  checking,

  /// Nothing to show (the sitting ended or never began).
  notOpen,
}

enum _Step { rules, code, precheck }

enum _Load { opening, failed, ready }

/// The slots the runner gets on a midterm (0.1.0's ExamRunner took the same two).
@immutable
class MidtermRunnerSlots {
  const MidtermRunnerSlots({required this.session, required this.headerExtra, required this.banner});

  final ExamSession session;

  /// Top-right of the header: the battery reading.
  final Widget headerExtra;

  /// Under the header: reconnecting / low battery.
  final Widget banner;
}

typedef MidtermRunnerBuilder = Widget Function(BuildContext context, MidtermRunnerSlots slots);

class MidtermFlowController extends ChangeNotifier {
  MidtermFlowController(this.engine, {this.forfeitHold = const Duration(seconds: 6), this.ownsEngine = true}) {
    engine.addListener(_changed);
    engine.blocked.addListener(_changed);
    engine.lockdown.addListener(_changed);
    engine.offscreen.addListener(_changed);
    engine.offscreenNotice.addListener(_changed);
    engine.battery.addListener(_changed);
    engine.result.addListener(_changed);
    engine.problem.addListener(_changed);
  }

  final MidtermEngine engine;

  /// How long the forfeit explanation stays before moving on by itself (the website's 6 s).
  final Duration forfeitHold;

  /// Dispose the engine with the flow (it releases the machine).
  final bool ownsEngine;

  _Load _load = _Load.opening;
  _Step _step = _Step.rules;
  bool _updateRequired = false;
  bool _forfeitSeen = false;
  Timer? _forfeitTimer;
  bool _disposed = false;
  Object? _loadError;

  /// Why prepare failed (diagnostics).
  Object? get loadError => _loadError;

  void _changed() {
    if (_disposed) return;
    _armForfeitHold();
    notifyListeners();
  }

  bool get _terminated =>
      engine.doneReason == ExamDoneReason.terminated || (engine.offscreen.value?.terminated ?? false);

  void _armForfeitHold() {
    if (!_terminated || _forfeitSeen || _forfeitTimer != null) return;
    _forfeitTimer = Timer(forfeitHold, () {
      _forfeitSeen = true;
      _changed();
    });
  }

  /// The paper has been opened in this process (its module is in memory).
  bool get _live => engine.liveModuleId != null;

  MidtermView get view {
    if (_load == _Load.opening) return MidtermView.opening;
    if (_load == _Load.failed) return MidtermView.openFailed;
    if (_terminated && !_forfeitSeen) return MidtermView.terminated;
    final phase = engine.phase;
    if (phase == ExamPhase.done) return MidtermView.done;
    final blocked = engine.blocked.value;
    if (_updateRequired || blocked == MidtermBlockReason.updateRequired) return MidtermView.updateRequired;
    if (blocked == MidtermBlockReason.sessionReplaced) return MidtermView.sessionMoved;
    if (blocked == MidtermBlockReason.notLive) return MidtermView.checking;
    final attempt = engine.lastAttempt;
    if (!_live) {
      if (attempt == null) return MidtermView.notOpen;
      if (attempt.state.isActive) return _step == _Step.code ? MidtermView.code : MidtermView.resumePrecheck;
      if (attempt.state == AttemptState.notStarted) {
        return switch (_step) {
          _Step.rules => MidtermView.rules,
          _Step.code => MidtermView.code,
          _Step.precheck => MidtermView.precheck,
        };
      }
      return MidtermView.notOpen;
    }
    // A running paper is never on screen unlocked.
    final lock = engine.lockdown;
    final refused = blocked != null;
    if (!lock.locked || lock.lost || refused) return MidtermView.resumePrecheck;
    return switch (phase) {
      ExamPhase.running || ExamPhase.review => MidtermView.running,
      ExamPhase.transition => MidtermView.transition,
      ExamPhase.offlineWaiting => MidtermView.offlineWaiting,
      ExamPhase.submitting => MidtermView.submitting,
      _ => MidtermView.notOpen,
    };
  }

  MidtermPrepareResponse? get prepared => engine.prepared;

  // ---- actions ----------------------------------------------------------------------------

  /// Load the sitting (prepare). Never throws: failures become [MidtermView.openFailed].
  Future<void> load() async {
    _load = _Load.opening;
    _loadError = null;
    _changed();
    try {
      final p = await engine.prepare();
      if (_disposed) return;
      _step = p.attempt.state.isActive ? _Step.precheck : _Step.rules;
      _load = _Load.ready;
    } on UpdateRequired catch (e) {
      _loadError = e;
      _updateRequired = true;
      _load = _Load.ready;
    } on Object catch (e) {
      _loadError = e;
      _load = _Load.failed;
    }
    _changed();
  }

  /// "I'm ready — continue": the code screen unless prepare said none is needed.
  void proceedFromRules() {
    final p = engine.prepared;
    _step = (p == null || !p.mayProceed) ? _Step.code : _Step.precheck;
    _changed();
  }

  /// Verify the teacher's code. Throws [ApiError] (403 `code_incorrect`) or a network error
  /// for the code screen to show.
  Future<void> submitCode(String code) async {
    final p = await engine.prepare(code: code);
    if (p.requiresCode && !p.codeVerified) {
      throw const ApiError(status: 403, body: ApiErrorBody(code: 'code_incorrect'));
    }
    _step = _Step.precheck;
    _changed();
  }

  void backToRules() {
    _step = _Step.rules;
    _changed();
  }

  /// "Lock and start" / "Lock and resume" from a fresh process: lock, bind, open. Throws what
  /// the pre-check should show; routes the refusals that have their own screen.
  Future<void> lockAndOpen() async {
    try {
      await engine.lockAndBind();
      await engine.openPaper();
    } on MidtermCodeRequired {
      engine.release();
      _step = _Step.code;
      _changed();
    } on MidtermBlocked catch (e) {
      switch (e.reason) {
        case MidtermBlockReason.updateRequired:
          engine.release();
          _updateRequired = true;
          _changed();
        case MidtermBlockReason.notLive:
          engine.release();
          // The sitting already ended: re-read it (it lands on the result).
          await load();
        default:
          rethrow;
      }
    }
  }

  /// "Lock and resume" over a paper already in memory (a lost lock, a refusal mid-paper).
  Future<void> relock() async {
    if (!_live) return lockAndOpen();
    try {
      await engine.relock();
    } on MidtermBlocked catch (e) {
      if (e.reason == MidtermBlockReason.updateRequired) {
        engine.release();
        _updateRequired = true;
        _changed();
        return;
      }
      rethrow;
    }
  }

  /// Back from the (fresh) pre-check: if it locked the machine, Back unlocks it.
  void backFromPrecheck() {
    engine.release();
    _step = _Step.rules;
    _changed();
  }

  /// "See your result" on the forfeit screen.
  void seeResult() {
    _forfeitSeen = true;
    _forfeitTimer?.cancel();
    _changed();
  }

  void dismissNotice() => engine.guard.dismissNotice();

  /// Every exit path releases the machine first.
  void release() => engine.release();

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _forfeitTimer?.cancel();
    engine.removeListener(_changed);
    if (!engine.disposed) {
      engine.blocked.removeListener(_changed);
      engine.lockdown.removeListener(_changed);
      engine.offscreen.removeListener(_changed);
      engine.offscreenNotice.removeListener(_changed);
      engine.battery.removeListener(_changed);
      engine.result.removeListener(_changed);
      engine.problem.removeListener(_changed);
    }
    engine.release();
    if (ownsEngine) engine.dispose();
    super.dispose();
  }
}

/// The midterm, as a widget. app-core gives it the engine (via the controller), the native
/// bridge (pre-check, Close), the runner (runner-ui), and where to go next.
class MidtermFlow extends StatefulWidget {
  const MidtermFlow({
    super.key,
    required this.controller,
    required this.native,
    required this.runnerBuilder,
    required this.onExit,
    this.onOpenReport,
    this.onUpdateNow,
    this.onDownload,
    this.scoringScale,
    this.passMark,
    this.isRetake = false,
  });

  final MidtermFlowController controller;
  final NativeBridge native;
  final MidtermRunnerBuilder runnerBuilder;

  /// Back to Home (the machine is already released).
  final VoidCallback onExit;

  /// Open the midterm result page (results feature).
  final VoidCallback? onOpenReport;
  final Future<void> Function(void Function(int percent) onProgress)? onUpdateNow;
  final VoidCallback? onDownload;

  /// Rules-screen extras the v1 `rules` block does not carry yet (see the integration notes).
  final String? scoringScale;
  final int? passMark;
  final bool isRetake;

  @override
  State<MidtermFlow> createState() => _MidtermFlowState();
}

class _MidtermFlowState extends State<MidtermFlow> {
  MidtermFlowController get c => widget.controller;

  @override
  void initState() {
    super.initState();
    if (c.engine.prepared == null) unawaited(c.load());
  }

  void _exit() {
    c.release();
    widget.onExit();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(listenable: c, builder: (context, _) => _screen(context, c.view));
  }

  Widget _screen(BuildContext context, MidtermView view) {
    final e = c.engine;
    final subject = subjectLabelFor(e.prepared?.rules.subject ?? e.test.subject);
    switch (view) {
      case MidtermView.opening:
        return const MidtermWaitingScreen(key: ValueKey('opening'), message: MidtermCopy.opening);
      case MidtermView.openFailed:
        return MidtermErrorScreen(
          key: const ValueKey('openFailed'),
          title: MidtermCopy.openFailedTitle,
          body: MidtermCopy.openFailedBody,
          onRetry: () => unawaited(c.load()),
          onHome: _exit,
        );
      case MidtermView.rules:
        final p = e.prepared!;
        return MidtermRulesScreen(
          key: const ValueKey('rules'),
          rules: p.rules,
          requiresCode: p.requiresCode,
          onProceed: c.proceedFromRules,
          scoringScale: widget.scoringScale,
          passMark: widget.passMark,
          isRetake: widget.isRetake,
        );
      case MidtermView.code:
        return MidtermCodeScreen(key: const ValueKey('code'), onSubmitCode: c.submitCode, onBack: c.backToRules);
      case MidtermView.precheck:
        return MidtermPrecheckScreen(
          key: const ValueKey('precheck'),
          native: widget.native,
          resume: false,
          onContinue: c.lockAndOpen,
          onBack: c.backFromPrecheck,
        );
      case MidtermView.resumePrecheck:
        return MidtermPrecheckScreen(
          key: const ValueKey('resumePrecheck'),
          native: widget.native,
          resume: true,
          onContinue: c.relock,
          onBack: _exit,
        );
      case MidtermView.running:
        return _running(context);
      case MidtermView.transition:
      case MidtermView.offlineWaiting:
        final to = e.transition?.toOrder ?? (e.moduleOrder + 1);
        return MidtermWaitingScreen(
          key: const ValueKey('transition'),
          title: MidtermCopy.continuingTo(to),
          message: subject,
          detail: view == MidtermView.offlineWaiting ? MidtermCopy.waitingForConnection : null,
        );
      case MidtermView.submitting:
        return MidtermWaitingScreen(
          key: const ValueKey('submitting'),
          message: MidtermCopy.handingIn,
          detail: e.online ? null : MidtermCopy.waitingForConnection,
        );
      case MidtermView.terminated:
        return MidtermTerminatedScreen(key: const ValueKey('terminated'), onContinue: c.seeResult);
      case MidtermView.done:
        return MidtermDoneScreen(
          key: const ValueKey('done'),
          result: e.result.value,
          failed: e.result.value == null && !e.online,
          onHome: _exit,
          onOpenReport: widget.onOpenReport,
        );
      case MidtermView.sessionMoved:
        return MidtermSessionMovedScreen(key: const ValueKey('sessionMoved'), onHome: _exit);
      case MidtermView.updateRequired:
        return MidtermUpdateRequiredScreen(
          key: const ValueKey('updateRequired'),
          onHome: _exit,
          onUpdateNow: widget.onUpdateNow,
          onDownload: widget.onDownload,
        );
      case MidtermView.checking:
        return const MidtermWaitingScreen(key: ValueKey('checking'), message: MidtermCopy.checkingMidterm);
      case MidtermView.notOpen:
        return MidtermErrorScreen(
          key: const ValueKey('notOpen'),
          title: MidtermCopy.notOpenTitle,
          body: MidtermCopy.notOpenBody,
          onHome: _exit,
        );
    }
  }

  Widget _running(BuildContext context) {
    final e = c.engine;
    final off = e.offscreen.value;
    final counting = off?.countingDown ?? false;
    final notice = e.offscreenNotice.value;
    final battery = e.battery.value;
    final runner = widget.runnerBuilder(
      context,
      MidtermRunnerSlots(
        session: e,
        headerExtra: MidtermBatteryIndicator(battery: battery),
        banner: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [ReconnectingBanner(show: !e.online), LowBatteryBanner(battery: battery)],
        ),
      ),
    );
    return Stack(
      key: const ValueKey('running'),
      fit: StackFit.expand,
      children: [
        runner,
        if (notice != null && !counting) OffscreenNotice(text: notice, onDismiss: c.dismissNotice),
        if (counting)
          Positioned.fill(
            child: OffscreenWarning(
              secondsLeft: off!.graceRemaining?.inSeconds ?? 0,
              chancesLeft: offscreenChancesLeft(off.violations, off.limit),
            ),
          ),
      ],
    );
  }
}
