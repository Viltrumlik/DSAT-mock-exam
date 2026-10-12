// ExamRunnerScreen — the native exam runner (architecture §2.3 "Exam runner", §3), the
// counterpart of pages/ExamRunnerPage.tsx. It renders an [ExamSession] and never talks to the
// network, the store or the clock itself:
//
//   header · colour rule · [question card = content island] · colour rule · footer
//
// plus everything that floats over the card (Directions, the navigator, the More menu, the
// floating tools, the highlight toolbar, the shortcuts help, Report a problem, toasts) and the
// full-window states (Welcome, Check Your Work, module transition, Submitting…, offline).
//
// The question card is the content island ([IslandHost], kind content). A
// [ContentIslandBridge] translates session state into `render`-side protocol messages and the
// island's events (answer, eliminate, flag, SPR input, selection rect, forwarded keys) into
// session actions. Keyboard shortcuts run here when Flutter has focus and arrive as `key`
// messages when the island has it; one switch ([runnerShortcutsEnabled]) turns them off.
//
// Forced full screen (ExamRunnerPage.tsx:405-470, 786-795): where the window's full screen is
// held for the sitting ([RunnerWindowControls.fullscreenLocked] — a past paper's lockdown),
// leaving it while a module is on screen raises [FullscreenWarning] after a 400 ms grace; it
// counts down 10 s and then runs the same Save & Exit as the More menu. Never on Welcome,
// loading, the module transition, Check Your Work or the exit screens, and never on a midterm
// (its off-screen rule supersedes it, as `!proctored` does on the website).
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../../core/models/models.dart';
import '../../island/island_host.dart';
import '../../island/protocol.dart';
import '../../native/native_bridge.dart' show BatteryStatus;
import '../session_contract.dart';
import '../tokens/bluebook_tokens.dart';
import '../tools/annotation_toolbar.dart';
import '../tools/calculator/desmos_controller.dart';
import '../tools/calculator/desmos_panel.dart';
import '../tools/directions_overlay.dart';
import '../tools/keyboard_shortcuts.dart';
import '../tools/notes_panel.dart';
import '../tools/reference_sheet.dart';
import '../tools/report_problem_dialog.dart';
import 'check_your_work.dart';
import 'content_island_bridge.dart';
import 'exam_footer.dart';
import 'exam_header.dart';
import 'fullscreen_warning.dart';
import 'more_menu.dart';
import 'question_navigator.dart';
import 'runner_style.dart';
import 'runner_toasts.dart';
import 'runner_tools.dart';
import 'runner_window.dart';
import 'sat_color_rule.dart';
import 'status_screens.dart';
import 'welcome_screen.dart';

/// How the sitting left the runner.
@immutable
class RunnerExit {
  const RunnerExit(this.reason, {this.pausedOnServer});

  final ExamDoneReason reason;

  /// Save & Exit only: whether the server froze the clock (false offline).
  final bool? pausedOnServer;

  @override
  bool operator ==(Object other) =>
      other is RunnerExit && other.reason == reason && other.pausedOnServer == pausedOnServer;

  @override
  int get hashCode => Object.hash(reason, pausedOnServer);

  @override
  String toString() => 'RunnerExit($reason, pausedOnServer: $pausedOnServer)';
}

/// The one switch for keyboard shortcuts (architecture §2.8 "Keyboard and focus"): off while
/// loading and on every non-answering screen (Welcome, Check Your Work, the transition,
/// Submitting, offline), while a dialog is open, during the off-screen countdown, while input
/// is locked (0:00), while the runner is inert under a lockdown/midterm screen, and while
/// Save & Exit is in flight. Typing in a text field is checked separately.
bool runnerShortcutsEnabled({
  required ExamPhase phase,
  required bool inputLocked,
  bool offscreenCountingDown = false,
  bool dialogOpen = false,
  bool inert = false,
  bool busy = false,
}) => phase == ExamPhase.running && !inputLocked && !offscreenCountingDown && !dialogOpen && !inert && !busy;

/// ExamRunnerPage.tsx:1197-1203 — the px the question keeps free for the calculator: the
/// paper allows one (`calculatorAllowed`, the RULE — not "is Math": a Foundation Math midterm
/// is worked by hand), it is open, and this is not a grid-in (its directions column already
/// sits on the left).
double calcReserveFor({
  required bool calculatorAllowed,
  required bool calculatorOpen,
  required bool enlarged,
  required bool isGridIn,
}) {
  if (!calculatorAllowed || !calculatorOpen || isGridIn) return 0;
  return enlarged ? BluebookTokens.calcReserveEnlarged : BluebookTokens.calcReserve;
}

/// useExamTools.ts:36-37 — ±0.1, rounded to 2 places, clamped to 0.8–1.6.
double zoomStep(double zoom, int direction) {
  final next = double.parse((zoom + direction * examZoomStep).toStringAsFixed(2));
  return next.clamp(examMinZoom, examMaxZoom).toDouble();
}

class ExamRunnerScreen extends StatefulWidget {
  const ExamRunnerScreen({
    super.key,
    required this.session,
    required this.islandFactory,
    this.contentHost,
    this.submitReport,
    this.onExit,
    this.window,
    this.battery,
    this.inert = false,
    this.overlay,
    this.banner,
    this.nativeScientificOnly = true,
    this.animate = true,
    this.navLockDuration = BluebookTokens.navLock,
    this.onDiagnostic,
  });

  final ExamSession session;

  /// Creates island hosts: the Desmos island always comes from here, the content island too
  /// unless [contentHost] is given.
  final IslandHostFactory islandFactory;

  /// A content island the integrator already created (and maybe opened, so WebView2 start-up
  /// overlaps the `open` request). The runner opens it if it is still idle, and disposes only
  /// a host it created itself.
  final IslandHost? contentHost;

  /// Sends a question report. The integrator wires it to `POST
  /// /api/question-reports/reports/` (low-priority lane, idempotency key); by default it goes
  /// through [ExamSession.reportProblem].
  final ReportSubmitter? submitReport;

  /// The sitting is over (submitted, terminated, or Save & Exit).
  final ValueChanged<RunnerExit>? onExit;

  /// Full screen; null hides "Full screen" in the More menu. Controls that report
  /// [RunnerWindowControls.fullscreenLocked] make full screen mandatory on a past paper (Start
  /// needs it; leaving it raises the full-screen warning) and hide the More menu's item.
  final RunnerWindowControls? window;

  /// The laptop battery (null on a desktop PC / in tests).
  final ValueListenable<BatteryStatus?>? battery;

  /// A screen covers the runner (lockdown pre-check, midterm warnings): shortcuts off.
  final bool inert;

  /// Drawn over everything (e.g. the midterm off-screen warning).
  final Widget? overlay;

  /// A strip under the header and the low-battery banner, above the question card (the
  /// midterm's reconnecting / refused-work banners, a past paper's stuck send). Not modal.
  final Widget? banner;

  /// Scientific-only papers use the native scientific calculator, never Desmos.
  final bool nativeScientificOnly;

  /// Goldens freeze the spinners.
  final bool animate;
  final Duration navLockDuration;
  final void Function(String where, String message)? onDiagnostic;

  @override
  State<ExamRunnerScreen> createState() => ExamRunnerScreenState();
}

class ExamRunnerScreenState extends State<ExamRunnerScreen> {
  late final RunnerTools tools = RunnerTools(navLockDuration: widget.navLockDuration);
  final RunnerToasts toasts = RunnerToasts();
  late final IslandHost content;
  late final bool _ownsContent;
  late final ContentIslandBridge bridge;
  DesmosController? _desmos;

  final FocusNode _rootFocus = FocusNode(debugLabel: 'runner');
  final GlobalKey _stackKey = GlobalKey(debugLabel: 'runner.stack');
  final GlobalKey _topChromeKey = GlobalKey(debugLabel: 'runner.topChrome');
  final GlobalKey _islandKey = GlobalKey(debugLabel: 'runner.island');
  final GlobalKey _moreButtonKey = GlobalKey(debugLabel: 'runner.moreButton');
  final GlobalKey _moreMenuKey = GlobalKey(debugLabel: 'runner.moreMenu');
  final GlobalKey _toolbarKey = GlobalKey(debugLabel: 'runner.toolbar');
  final LayerLink _moreLink = LayerLink();

  StreamSubscription<ExamNotice>? _notices;
  double _directionsTop = 84; // ExamRunnerPage.tsx:259 default anchor
  bool _starting = false;
  bool _submitting = false;
  bool _exiting = false;
  SaveAndExitResult? _savedOffline;
  bool _exitHandled = false;
  bool _islandFocused = false;
  Uint8List? _frozen;
  bool _freezing = false;
  int? _moduleId;
  final Set<int> _firedTimerToasts = {};
  Rect? _islandBounds;

  // The full-screen warning (ExamRunnerPage.tsx showFsWarning / fsCountdown).
  Timer? _fsGrace;
  Timer? _fsTick;
  bool _fsWarning = false;
  int? _fsSecondsLeft;

  ExamSession get session => widget.session;

  /// The Desmos controller once the calculator was first opened (tests).
  DesmosController? get desmos => _desmos;

  /// Whether a key press would run a shortcut right now (tests, help).
  bool get shortcutsEnabled => runnerShortcutsEnabled(
    phase: session.phase,
    inputLocked: session.inputLocked,
    offscreenCountingDown: session.offscreen.value?.countingDown ?? false,
    dialogOpen: tools.reportOpen,
    inert: widget.inert || widget.overlay != null || _fsWarning,
    busy: _exiting || _savedOffline != null,
  );

  /// The full-screen warning is up (tests).
  bool get fullscreenWarningVisible => _fsWarning;

  /// Its countdown (null while hidden).
  int? get fullscreenSecondsLeft => _fsSecondsLeft;

  bool get _isMath => session.test.isMath;

  @override
  void initState() {
    super.initState();
    _ownsContent = widget.contentHost == null;
    content = widget.contentHost ?? widget.islandFactory(IslandKind.content);
    bridge = ContentIslandBridge(
      session: session,
      host: content,
      calcReservePx: () => session.questions.isEmpty
          ? 0
          : calcReserveFor(
              calculatorAllowed: session.calculatorAllowed,
              calculatorOpen: tools.calculatorOpen,
              enlarged: tools.calculatorEnlarged,
              isGridIn: session.currentQuestion.isMathInput,
            ),
      extraView: tools,
      hideIsland: () => _frozen != null || _freezing,
      onSelection: _onIslandSelection,
      onSelectionClear: tools.dismissToolbar,
      onAnnotClick: _onIslandAnnotClick,
      onKey: _onIslandKey,
      onFocus: (inIsland) => _islandFocused = inIsland,
      onDiagnostic: widget.onDiagnostic,
    )..attach();
    _moduleId = session.questions.isEmpty ? null : session.moduleId;
    session.addListener(_onSession);
    session.remaining.addListener(_onRemaining);
    session.offscreen.addListener(_onSession);
    tools.addListener(_onTools);
    widget.battery?.addListener(_rebuild);
    widget.window?.isFullscreen.addListener(_onWindow);
    _notices = session.notices.listen(_onNotice);
    if (content.state == IslandHostState.idle) {
      unawaited(
        content.open().catchError((Object e) {
          widget.onDiagnostic?.call('island', 'content island failed to open: $e');
        }),
      );
    }
    _onRemaining();
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkDone());
    _syncFullscreenWarning();
  }

  @override
  void didUpdateWidget(ExamRunnerScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    assert(
      identical(oldWidget.session, widget.session) && identical(oldWidget.contentHost, widget.contentHost),
      'Each sitting gets its own ExamRunnerScreen: key it by the attempt id.',
    );
    if (oldWidget.battery != widget.battery) {
      oldWidget.battery?.removeListener(_rebuild);
      widget.battery?.addListener(_rebuild);
    }
    if (oldWidget.window != widget.window) {
      oldWidget.window?.isFullscreen.removeListener(_onWindow);
      widget.window?.isFullscreen.addListener(_onWindow);
    }
    if (oldWidget.window != widget.window || oldWidget.inert != widget.inert || oldWidget.overlay != widget.overlay) {
      _syncFullscreenWarning();
    }
  }

  @override
  void dispose() {
    session.removeListener(_onSession);
    session.remaining.removeListener(_onRemaining);
    session.offscreen.removeListener(_onSession);
    tools.removeListener(_onTools);
    widget.battery?.removeListener(_rebuild);
    widget.window?.isFullscreen.removeListener(_onWindow);
    _fsGrace?.cancel();
    _fsTick?.cancel();
    unawaited(_notices?.cancel());
    unawaited(bridge.dispose());
    _desmos?.dispose();
    if (_ownsContent) unawaited(content.dispose());
    tools.dispose();
    toasts.dispose();
    _rootFocus.dispose();
    super.dispose();
  }

  void _rebuild() {
    if (mounted) setState(() {});
  }

  void _onWindow() {
    if (!mounted) return;
    _syncFullscreenWarning();
    setState(() {});
  }

  // ---- forced full screen -------------------------------------------------------------------

  /// ExamRunnerPage.tsx `fsEnforced`: only while the student is ACTIVELY in a past-paper module
  /// — never on Welcome, loading, the transition, Check Your Work, the exit screens, or under a
  /// screen the owner draws over the runner; never on a midterm.
  bool get _fsEnforced {
    final w = widget.window;
    return w != null &&
        w.fullscreenSupported &&
        w.fullscreenLocked &&
        session.kind == ExamKind.pastpaper &&
        session.phase == ExamPhase.running &&
        session.questions.isNotEmpty &&
        !_exiting &&
        _savedOffline == null &&
        !widget.inert &&
        widget.overlay == null;
  }

  /// Shows the warning only after the student has stayed OUT of full screen for the grace
  /// (so a transient change never flashes it); hides it — and stops its countdown — the
  /// moment they are back or the module is no longer on screen.
  void _syncFullscreenWarning() {
    if (!mounted) return;
    final out = _fsEnforced && !widget.window!.isFullscreen.value;
    if (!out) {
      _fsGrace?.cancel();
      _fsGrace = null;
      _fsTick?.cancel();
      _fsTick = null;
      if (_fsWarning || _fsSecondsLeft != null) {
        // Every caller rebuilds next (a session or window change, a widget update, Save & Exit).
        _fsWarning = false;
        _fsSecondsLeft = null;
        _syncFreeze();
      }
      return;
    }
    if (_fsWarning || _fsGrace != null) return;
    _fsGrace = Timer(fullscreenWarningGrace, () {
      _fsGrace = null;
      if (!mounted || !(_fsEnforced && !widget.window!.isFullscreen.value)) return;
      // Nothing floats over the warning, and the keyboard leaves the question card.
      tools.closeTransient();
      if (_islandFocused) {
        _islandFocused = false;
        unawaited(content.releaseFocus());
      }
      setState(() {
        _fsWarning = true;
        _fsSecondsLeft = fullscreenWarningSeconds;
      });
      _syncFreeze();
      _fsTick = Timer.periodic(const Duration(seconds: 1), (t) {
        if (!mounted) {
          t.cancel();
          return;
        }
        final left = (_fsSecondsLeft ?? 0) - 1;
        setState(() => _fsSecondsLeft = left);
        if (left <= 0) {
          t.cancel();
          _fsTick = null;
          // The off-full-screen kick: save their progress and take them out of the test
          // (resumable), exactly as Save & Exit in the More menu does.
          unawaited(_saveAndExit());
        }
      });
    });
  }

  /// "Return to full screen": ask the window (the lockdown) for it again. A refusal leaves the
  /// warning up; the owner may cover the runner with its reason.
  Future<void> _returnToFullscreen() async {
    final w = widget.window;
    if (w == null) return;
    try {
      await w.setFullscreen(true);
    } on Object catch (e) {
      widget.onDiagnostic?.call('window', 'return to full screen refused: $e');
    }
  }

  // ---- session → UI -------------------------------------------------------------------------

  void _onSession() {
    if (!mounted) return;
    final moduleId = session.questions.isEmpty ? null : session.moduleId;
    if (moduleId != _moduleId) {
      // A new module: nothing from the last one hangs over it (ExamRunnerPage.tsx:381-383).
      _moduleId = moduleId;
      _firedTimerToasts.clear();
      tools.closeTransient();
      tools.closeHelp();
    }
    _enforceCalculatorRule();
    _syncFullscreenWarning();
    if (session.phase != ExamPhase.running) {
      // Check Your Work / transition / end replace the frame: drop what floated over it.
      if (tools.moreOpen || tools.navigatorOpen || tools.directionsOpen || tools.toolbar != null) {
        tools.closeTransient();
      }
    }
    _checkDone();
    setState(() {});
  }

  void _checkDone() {
    if (!mounted || _exitHandled || session.phase != ExamPhase.done) return;
    final reason = session.doneReason;
    if (reason == null) return;
    if (reason == ExamDoneReason.savedAndExited && (_exiting || _savedOffline != null)) return;
    _exitHandled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) => widget.onExit?.call(RunnerExit(reason)));
  }

  /// The 5-minute / 1-minute / time's-up toasts, once each per module.
  void _onRemaining() {
    if (session.phase != ExamPhase.running && session.phase != ExamPhase.review) return;
    final secs = session.remaining.value.inSeconds;
    final message = timerToastFor(secs);
    if (message == null) return;
    final at = timerToastThreshold(secs);
    if (_firedTimerToasts.add(at)) toasts.showTimer(message);
  }

  void _onNotice(ExamNotice n) {
    switch (n.kind) {
      // The report dialog toasts its own outcome (website wording); the timer toast covers 0:00.
      case ExamNoticeKind.reportSent || ExamNoticeKind.reportDeduped || ExamNoticeKind.reportQueued:
      case ExamNoticeKind.timeUp:
        return;
      case ExamNoticeKind.reconnected:
        toasts.push(n.message, tone: ToastTone.success);
      default:
        toasts.push(n.message);
    }
  }

  /// The calculator is a RULE, not a tool (ExamToolsLayer.tsx, 2026-10-11): on a paper that
  /// offers none — a Foundation Math midterm is worked by hand — an open flag must not outlive
  /// the rule. It can arrive after the panel was opened (the sitting's own rules replace the
  /// prepared ones at open), and the header button that would close it is gone by then.
  void _enforceCalculatorRule() {
    if (tools.calculatorOpen && !session.calculatorAllowed) tools.closeCalculator();
  }

  void _onTools() {
    if (!mounted) return;
    _enforceCalculatorRule();
    // The Desmos island is created on the first Calculator click, and only on a paper that
    // allows a calculator (architecture §2.4).
    if (tools.calculatorOpen && session.calculatorAllowed && _desmos == null) {
      _desmos = DesmosController(
        session: session,
        factory: widget.islandFactory,
        onDiagnostic: widget.onDiagnostic,
        onKey: (key) {
          if (key == 'Escape') unawaited(_desmos?.host?.releaseFocus());
        },
      );
    }
    _syncFreeze();
    setState(() {});
  }

  // ---- windowed fallback: freeze-frame ------------------------------------------------------

  /// Overlays that must draw over the card. In texture mode they simply do; in the windowed
  /// fallback the island is swapped for its last frame first (architecture §2.6).
  bool get _overlayOverCard =>
      _fsWarning ||
      tools.moreOpen ||
      tools.navigatorOpen ||
      tools.directionsOpen ||
      tools.helpOpen ||
      tools.reportOpen ||
      tools.referenceOpen;

  bool get _overlaysVisible => content.canDrawOverIsland || _frozen != null;

  void _syncFreeze() {
    if (content.canDrawOverIsland) return;
    final need = _overlayOverCard && session.phase == ExamPhase.running;
    if (need && _frozen == null && !_freezing) {
      _freezing = true;
      unawaited(() async {
        Uint8List? png;
        try {
          png = await content.capturePreview();
        } on Object catch (e) {
          widget.onDiagnostic?.call('island', 'freeze-frame failed: $e');
        }
        _freezing = false;
        if (!mounted) return;
        setState(() => _frozen = png ?? Uint8List(0));
        bridge.refresh();
        // Closed again while we captured.
        if (!_overlayOverCard) _syncFreeze();
      }());
    } else if (!need && _frozen != null) {
      setState(() => _frozen = null);
      bridge.refresh();
    }
  }

  // ---- island events ------------------------------------------------------------------------

  Offset _islandOrigin() {
    final island = _islandKey.currentContext?.findRenderObject() as RenderBox?;
    final stack = _stackKey.currentContext?.findRenderObject() as RenderBox?;
    if (island == null || stack == null || !island.attached || !stack.attached) return Offset.zero;
    return stack.globalToLocal(island.localToGlobal(Offset.zero));
  }

  /// useAnnotator.ts:112-133 — a new selection is painted in the active colour at once, and
  /// the toolbar opens over it.
  void _onIslandSelection(SelectionMessage m) {
    if (!content.canDrawOverIsland || session.phase != ExamPhase.running) return;
    if (session.questions.isEmpty || m.qid != session.currentQuestion.id) return;
    final color = tools.activeColor;
    bridge.applyAnnotation(selectionId: m.selectionId, op: 'highlight', color: color);
    tools.showToolbar(
      ToolbarRequest(
        qid: m.qid,
        container: AnnotationContainer.fromWire(m.container),
        x: m.rect.x + m.rect.w / 2,
        top: m.rect.y,
        bottom: m.rect.y + m.rect.h,
        selectionId: m.selectionId,
        color: color,
        text: m.text,
      ),
    );
  }

  /// useAnnotator.ts:139-150 — clicking an existing mark re-opens the toolbar to edit it.
  void _onIslandAnnotClick(AnnotClickMessage m) {
    if (!content.canDrawOverIsland || session.phase != ExamPhase.running) return;
    tools.showToolbar(
      ToolbarRequest(
        qid: m.qid,
        container: AnnotationContainer.fromWire(m.container),
        x: m.rect.x + m.rect.w / 2,
        top: m.rect.y,
        bottom: m.rect.y + m.rect.h,
        annotId: m.annotId,
        color: HighlightColor.fromWireOrNull(m.current.color),
        underline: UnderlineStyle.fromWireOrNull(m.current.underline),
      ),
    );
  }

  void _toolbarColor(HighlightColor color) {
    final t = tools.toolbar;
    tools.setActiveColor(color);
    if (t == null) return;
    bridge.applyAnnotation(selectionId: t.selectionId, annotId: t.annotId, op: 'highlight', color: color);
    tools.updateToolbar(t.copyWith(color: color));
  }

  void _toolbarUnderline(UnderlineStyle style) {
    final t = tools.toolbar;
    if (t == null) return;
    bridge.applyAnnotation(selectionId: t.selectionId, annotId: t.annotId, op: 'underline', underline: style);
    tools.updateToolbar(t.copyWith(underline: style));
  }

  void _toolbarDelete() {
    final t = tools.toolbar;
    if (t != null) bridge.applyAnnotation(selectionId: t.selectionId, annotId: t.annotId, op: 'remove');
    tools.dismissToolbar();
  }

  /// The toolbar's note button: open Notes with the selection quoted (architecture §2.8).
  void _toolbarNote() {
    final text = tools.toolbar?.text?.trim() ?? '';
    if (text.isNotEmpty) {
      final current = session.notes;
      final quote = '> "$text"\n';
      session.setNotes(current.isEmpty ? quote : (current.endsWith('\n') ? '$current$quote' : '$current\n$quote'));
    }
    tools.openNotes();
  }

  void _onIslandKey(String key) {
    if (key == 'Escape') {
      unawaited(bridge.releaseFocus());
      _islandFocused = false;
      _rootFocus.requestFocus();
      _escape();
      return;
    }
    final sc = shortcutForDomKey(key);
    if (sc != null) runShortcut(sc);
  }

  // ---- keyboard -----------------------------------------------------------------------------

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is KeyUpEvent) return KeyEventResult.ignored;
    // The island has the keyboard (texture mode forwards keys to the page): it sends the
    // allowed shortcuts itself as `key` messages — and never while its SPR input has focus,
    // where ← / → must move the caret, not the question.
    if (_islandFocused) return KeyEventResult.ignored;
    if (event.logicalKey == LogicalKeyboardKey.escape) {
      if (isTypingInTextField() && !tools.notesOpen) return KeyEventResult.ignored;
      return _escape() ? KeyEventResult.handled : KeyEventResult.ignored;
    }
    if (isTypingInTextField()) return KeyEventResult.ignored;
    final sc = shortcutForKeyEvent(event);
    if (sc == null) return KeyEventResult.ignored;
    return runShortcut(sc) ? KeyEventResult.handled : KeyEventResult.ignored;
  }

  /// Escape closes the topmost transient thing (the toolbar first, as useAnnotator does).
  bool _escape() {
    if (tools.toolbar != null) {
      tools.dismissToolbar();
    } else if (tools.moreOpen) {
      tools.closeMore();
    } else if (tools.helpOpen) {
      tools.closeHelp();
    } else if (tools.navigatorOpen) {
      tools.closeNavigator();
    } else if (tools.directionsOpen) {
      tools.closeDirections();
    } else {
      return false;
    }
    return true;
  }

  /// useKeyboardShortcuts.ts:39-50 + ExamRunnerPage.tsx:515-540. Returns whether it ran.
  bool runShortcut(RunnerShortcut sc) {
    if (!shortcutsEnabled) return false;
    // The shortcuts help is modal: only `?` (which closes it) gets through.
    if (tools.helpOpen && sc != RunnerShortcut.help) return false;
    switch (sc) {
      case RunnerShortcut.previous:
        _guardedBack();
      case RunnerShortcut.next:
        _guardedNext();
      case RunnerShortcut.choiceA || RunnerShortcut.choiceB || RunnerShortcut.choiceC || RunnerShortcut.choiceD:
        final q = session.currentQuestion;
        if (q.isMathInput) return false;
        final keys = q.choiceKeys;
        final i = sc.choiceIndex!;
        if (i >= keys.length) return false;
        session.select(q.id, keys[i]);
      case RunnerShortcut.mark:
        session.toggleFlag(session.currentQuestion.id);
      case RunnerShortcut.navigator:
        tools.closeMore();
        tools.toggleNavigator();
      case RunnerShortcut.help:
        tools.toggleHelp();
    }
    return true;
  }

  // ---- actions ------------------------------------------------------------------------------

  void _guardedNext() => tools.withNavLock(session.next);
  void _guardedBack() => tools.withNavLock(session.back);

  void _toggleDirections() {
    if (!tools.directionsOpen) {
      final box = _topChromeKey.currentContext?.findRenderObject() as RenderBox?;
      final stack = _stackKey.currentContext?.findRenderObject() as RenderBox?;
      if (box != null && stack != null && box.attached) {
        _directionsTop = stack.globalToLocal(box.localToGlobal(Offset(0, box.size.height))).dy;
      }
    }
    tools.toggleDirections();
  }

  Future<void> _togglePause() async {
    if (session.paused) {
      await session.resume();
    } else {
      await session.pause(); // offline: false + the "needs a connection" notice
    }
  }

  Future<void> _toggleFullscreen() async {
    final w = widget.window;
    if (w == null) return;
    await w.setFullscreen(!w.isFullscreen.value);
  }

  Future<void> _start() async {
    if (_starting) return;
    setState(() => _starting = true);
    try {
      final w = widget.window;
      if (w != null && w.fullscreenSupported && !w.isFullscreen.value) {
        try {
          await w.setFullscreen(true);
        } on Object catch (e) {
          widget.onDiagnostic?.call('window', 'full screen refused: $e');
          // Mandatory full screen (a past paper's lockdown): the clock does not start without
          // it. The owner shows why (the pre-check) and starts the module itself once locked.
          if (w.fullscreenLocked) return;
        }
      }
      await session.start();
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Future<void> _submitModule() async {
    if (_submitting) return;
    setState(() => _submitting = true);
    try {
      await session.submitModule();
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _saveAndExit() async {
    if (_exiting) return;
    tools.closeTransient();
    setState(() => _exiting = true);
    _syncFullscreenWarning();
    final result = await session.saveAndExit();
    if (!mounted) return;
    _exitHandled = true;
    if (result.pausedOnServer) {
      setState(() => _exiting = false);
      widget.onExit?.call(RunnerExit(ExamDoneReason.savedAndExited, pausedOnServer: true));
    } else {
      setState(() {
        _exiting = false;
        _savedOffline = result;
      });
    }
  }

  void _openReport() {
    if (session.questions.isEmpty) return;
    tools.dismissToolbar();
    tools.openReport(questionId: session.currentQuestion.id, questionNumber: session.currentIndex + 1);
  }

  Future<ReportOutcome> _defaultSubmit(QuestionReportRequest r) =>
      session.reportProblem(questionId: r.questionId, category: r.category, message: r.message);

  Future<String?> _reportPrefill(int questionId) async {
    final sel = await bridge.currentSelection();
    return sel.qid == questionId ? sel.text : null;
  }

  QuestionCellState _cellState(int i) {
    final q = session.questions[i];
    return QuestionCellState(
      answered: session.isAnswered(q.id),
      flagged: session.isFlagged(q.id),
      current: i == session.currentIndex,
    );
  }

  // ---- pointer: focus, outside clicks -------------------------------------------------------

  bool _inside(GlobalKey key, Offset global) {
    final box = key.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.attached || !box.hasSize) return false;
    return (box.localToGlobal(Offset.zero) & box.size).contains(global);
  }

  void _onPointerDown(PointerDownEvent e) {
    // Under the full-screen warning nothing below it takes a click, focus included.
    if (_fsWarning) return;
    final p = e.position;
    if (tools.moreOpen && !_inside(_moreButtonKey, p) && !_inside(_moreMenuKey, p)) tools.closeMore();
    final inIsland = _inside(_islandKey, p) && session.phase == ExamPhase.running && _frozen == null;
    if (tools.toolbar != null && !inIsland && !_inside(_toolbarKey, p)) tools.dismissToolbar();
    if (inIsland) {
      // Texture mode: route the keyboard to the page (the SPR input, island shortcuts). A
      // focused text field (Notes) lets go, as a browser's would.
      if (!tools.reportOpen) _rootFocus.requestFocus();
      _islandFocused = true;
      unawaited(content.focus());
      return;
    }
    if (tools.reportOpen) return; // the dialog keeps its own focus scope
    if (_islandFocused) {
      _islandFocused = false;
      unawaited(content.releaseFocus());
    }
    // A press outside a text field blurs it, as a browser does, so shortcuts work again.
    if (!_pointerOnTextField(p)) _rootFocus.requestFocus();
  }

  bool _pointerOnTextField(Offset global) {
    final result = HitTestResult();
    WidgetsBinding.instance.hitTestInView(result, global, View.of(context).viewId);
    return result.path.any((entry) => entry.target is RenderEditable);
  }

  // ---- build --------------------------------------------------------------------------------

  void _reportIslandBounds() {
    if (content.canDrawOverIsland) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final box = _islandKey.currentContext?.findRenderObject() as RenderBox?;
      if (box == null || !box.attached || !box.hasSize) return;
      final r = box.localToGlobal(Offset.zero) & box.size;
      if (r == _islandBounds) return;
      _islandBounds = r;
      content.setBounds(r);
    });
  }

  Widget _card() {
    _reportIslandBounds();
    final frozen = _frozen;
    final Widget surface = frozen == null
        ? content.build(context)
        : (frozen.isEmpty
              ? const ColoredBox(color: BluebookTokens.surface)
              : Image.memory(frozen, fit: BoxFit.fill, gaplessPlayback: true));
    final island = KeyedSubtree(
      key: _islandKey,
      child: SizedBox.expand(child: surface),
    );
    final dockNotes = tools.notesOpen && !content.canDrawOverIsland;
    if (!dockNotes) return island;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(child: island),
        SizedBox(
          width: BluebookTokens.notesRect.width,
          child: NotesPanel(session: session, onClose: tools.toggleNotes, docked: true),
        ),
      ],
    );
  }

  Widget _frame() {
    final s = session;
    final battery = widget.battery?.value;
    final hasQuestions = s.questions.isNotEmpty;
    final pauseAllowed = s.kind == ExamKind.pastpaper;
    final header = ExamHeader(
      title: s.title,
      directionsOpen: tools.directionsOpen,
      onToggleDirections: _toggleDirections,
      timer: ExamTimer(
        remaining: s.remaining,
        hidden: tools.timerHidden,
        onToggleHidden: tools.toggleTimerHidden,
        pauseAllowed: pauseAllowed,
        paused: s.paused,
        pauseAvailable: s.online,
        onTogglePause: pauseAllowed ? () => unawaited(_togglePause()) : null,
      ),
      showCalculator: s.calculatorAllowed,
      calculatorOpen: tools.calculatorOpen,
      onToggleCalculator: tools.toggleCalculator,
      // ExamRunnerPage.tsx:1086-1089 — past-paper Math only.
      showReference: s.referenceSheetAvailable && _isMath,
      referenceOpen: tools.referenceOpen,
      onToggleReference: tools.toggleReference,
      highlighterOn: s.highlighterOn,
      onToggleHighlighter: s.toggleHighlighter,
      battery: battery,
      more: KeyedSubtree(
        key: _moreButtonKey,
        child: MoreMenuButton(link: _moreLink, open: tools.moreOpen, onTap: tools.toggleMore),
      ),
    );
    return ColoredBox(
      color: BluebookTokens.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KeyedSubtree(
            key: _topChromeKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                header,
                const SatColorRule(),
                LowBatteryBanner(battery: battery),
                ?widget.banner,
              ],
            ),
          ),
          Expanded(child: _card()),
          const SatColorRule(),
          ExamFooter(
            studentName: s.studentName,
            navLabel: hasQuestions ? 'Question ${s.currentIndex + 1} of ${s.questions.length}' : '',
            onToggleNavigator: () {
              tools.closeMore();
              tools.toggleNavigator();
            },
            canGoBack: s.currentIndex > 0,
            onBack: _guardedBack,
            isLastQuestion: hasQuestions && s.currentIndex == s.questions.length - 1,
            onNext: _guardedNext,
            onSubmitModule: s.openReview,
            submitting: s.phase == ExamPhase.submitting,
            navLocked: tools.navLocked,
          ),
        ],
      ),
    );
  }

  List<Widget> _overlays() {
    final s = session;
    final out = <Widget>[];
    final canOverlay = _overlaysVisible;
    if (tools.directionsOpen && canOverlay) {
      out.add(
        DirectionsOverlay(
          key: const ValueKey('directions'),
          anchorBottom: _directionsTop,
          widthFraction: _isMath ? 0.5 : s.split,
          isMath: _isMath,
          // The wording follows the RULE: a Math paper with no calculator says so.
          calculatorAllowed: s.calculatorAllowed,
          onClose: tools.closeDirections,
        ),
      );
    }
    if (tools.navigatorOpen && canOverlay) {
      out.add(
        Positioned.fill(
          child: QuestionNavigator(
            key: const ValueKey('navigator'),
            title: s.title,
            count: s.questions.length,
            stateOf: _cellState,
            onJump: s.goTo,
            onGoToReview: s.openReview,
            onClose: tools.closeNavigator,
          ),
        ),
      );
    }
    // ExamToolsLayer.tsx order: calculator, reference, notes, help, toolbar. The calculator
    // mounts on the RULE and the open flag together, never on the flag alone (the flag is tool
    // state that can outlive the rule; ExamToolsLayer.tsx `calculatorEnabled && calculatorOpen`).
    if (s.calculatorAllowed && tools.calculatorOpen && _desmos != null) {
      out.add(
        DesmosPanel(
          key: const ValueKey('calculator'),
          controller: _desmos!,
          tools: tools,
          scientificOnly: s.scientificOnly,
          nativeScientificOnly: widget.nativeScientificOnly,
          animate: widget.animate,
        ),
      );
    }
    if (tools.referenceOpen && canOverlay) {
      out.add(ReferenceSheet(key: const ValueKey('reference'), onClose: tools.toggleReference));
    }
    if (tools.notesOpen && content.canDrawOverIsland) {
      out.add(NotesPanel(key: const ValueKey('notes'), session: s, onClose: tools.toggleNotes));
    }
    if (tools.helpOpen && canOverlay) {
      out.add(
        Positioned.fill(
          child: KeyboardShortcutsHelp(key: const ValueKey('help'), onClose: tools.closeHelp),
        ),
      );
    }
    final t = tools.toolbar;
    if (t != null && content.canDrawOverIsland && t.qid == (s.questions.isEmpty ? null : s.currentQuestion.id)) {
      final origin = _islandOrigin();
      out.add(
        Positioned.fill(
          child: AnnotationToolbar(
            barKey: _toolbarKey,
            anchorX: origin.dx + t.x,
            anchorTop: origin.dy + t.top,
            anchorBottom: origin.dy + t.bottom,
            activeColor: t.color,
            activeUnderline: t.underline,
            onColor: _toolbarColor,
            onUnderline: _toolbarUnderline,
            onDelete: _toolbarDelete,
            onAddNote: _toolbarNote,
          ),
        ),
      );
    }
    if (tools.moreOpen && canOverlay) {
      final fs = widget.window;
      out.add(
        MoreMenuPanel(
          hitKey: _moreMenuKey,
          link: _moreLink,
          onClose: tools.closeMore,
          items: moreMenuItems(
            isFullscreen: fs?.isFullscreen.value ?? false,
            // The lockdown owns a past paper's full screen: no "Full screen" / "Exit full screen".
            onToggleFullscreen: fs != null && fs.fullscreenSupported && !fs.fullscreenLocked
                ? () => unawaited(_toggleFullscreen())
                : null,
            highlighterOn: s.highlighterOn,
            onToggleHighlighter: s.toggleHighlighter,
            notesOpen: tools.notesOpen,
            onToggleNotes: tools.toggleNotes,
            onReportProblem: s.questions.isEmpty ? null : _openReport,
            onZoomIn: () => s.setZoom(zoomStep(s.zoom, 1)),
            onZoomOut: () => s.setZoom(zoomStep(s.zoom, -1)),
            paused: s.paused,
            onTogglePause: s.kind == ExamKind.pastpaper ? () => unawaited(_togglePause()) : null,
            onToggleHelp: tools.toggleHelp,
          ),
          onSaveAndExit: s.canSaveAndExit ? () => unawaited(_saveAndExit()) : null,
        ),
      );
    }
    if (tools.reportOpen && canOverlay && tools.reportQuestionId != null) {
      out.add(
        Positioned.fill(
          child: ReportProblemDialog(
            key: ValueKey('report.${tools.reportQuestionId}'),
            questionId: tools.reportQuestionId!,
            questionNumber: tools.reportQuestionNumber,
            attemptId: s.attemptId,
            submit: widget.submitReport ?? _defaultSubmit,
            onClose: () {
              tools.closeReport();
              _rootFocus.requestFocus();
            },
            onToast: (message, {error = false}) =>
                toasts.push(message, tone: error ? ToastTone.error : ToastTone.success),
            prefill: () => _reportPrefill(tools.reportQuestionId!),
          ),
        ),
      );
    }
    return out;
  }

  Widget _fullScreen() {
    final s = session;
    if (_exiting) return LoadingScreen(label: 'Saving your progress…', animate: widget.animate);
    if (_savedOffline != null) {
      return SavedOfflineExitScreen(
        onContinue: () => widget.onExit?.call(const RunnerExit(ExamDoneReason.savedAndExited, pausedOnServer: false)),
      );
    }
    switch (s.phase) {
      case ExamPhase.loading:
        return LoadingScreen(animate: widget.animate);
      case ExamPhase.welcome:
        return WelcomeScreen(
          moduleTitle: s.title,
          subjectLabel: s.subjectLabel,
          kindLabel: s.kind == ExamKind.midterm ? 'Midterm' : 'Past Paper',
          minutes: (s.remaining.value.inSeconds / 60).round(),
          questionCount: s.questions.isEmpty ? null : s.questions.length,
          starting: _starting,
          fullscreenSupported: widget.window?.fullscreenSupported ?? false,
          onStart: () => unawaited(_start()),
        );
      case ExamPhase.review:
        return CheckYourWorkPage(
          moduleTitle: s.title,
          count: s.questions.length,
          // CheckYourWorkPage.tsx:76-92 marks answered and flagged only, never the current one.
          stateOf: (i) {
            final c = _cellState(i);
            return QuestionCellState(answered: c.answered, flagged: c.flagged);
          },
          onJump: s.goTo,
          onBack: () => s.goTo(s.currentIndex),
          onSubmit: () => unawaited(_submitModule()),
          isLastModule: s.moduleOrder >= s.moduleCount,
          studentName: s.studentName,
          submitting: _submitting,
          submitLocked: !s.canSubmitEarly,
        );
      case ExamPhase.transition:
        final t = s.transition;
        final to = t?.toOrder ?? s.moduleOrder + 1;
        return ModuleTransitionScreen(
          toModuleOrder: to,
          moduleTitle: examModuleTitle(
            kind: s.kind,
            subject: s.test.subject,
            testTitle: s.test.title,
            moduleOrder: to,
            moduleCount: s.moduleCount,
          ),
          waitingForServer: t?.waitingForServer ?? false,
          online: s.online,
          animate: widget.animate,
        );
      case ExamPhase.submitting:
        return SubmittingScreen(online: s.online, animate: widget.animate);
      case ExamPhase.offlineWaiting:
        return OfflineWaitingScreen(animate: widget.animate);
      case ExamPhase.done:
        return const ColoredBox(key: ValueKey('done'), color: BluebookTokens.surface);
      case ExamPhase.running:
        return const SizedBox.shrink();
    }
  }

  @override
  Widget build(BuildContext context) {
    final phase = session.phase;
    final running = phase == ExamPhase.running && !_exiting && _savedOffline == null;
    // `.ts-runner` (globals.css:859-865): the runner's text defaults to the chrome face.
    return DefaultTextStyle(
      style: chromeText(16),
      child: NoSelection(
        child: Focus(
          focusNode: _rootFocus,
          autofocus: true,
          onKeyEvent: _onKey,
          child: Listener(
            behavior: HitTestBehavior.translucent,
            onPointerDown: _onPointerDown,
            child: GestureDetector(
              // No context menu anywhere in the runner.
              onSecondaryTap: () {},
              behavior: HitTestBehavior.translucent,
              child: ColoredBox(
                color: BluebookTokens.surface,
                child: Stack(
                  key: _stackKey,
                  children: [
                    // The frame stays mounted (offstage) on the other screens so the island
                    // keeps its page and state.
                    Positioned.fill(
                      child: Offstage(
                        offstage: !running,
                        child: TickerMode(enabled: running, child: _frame()),
                      ),
                    ),
                    if (!running) Positioned.fill(child: _fullScreen()),
                    if (running) ..._overlays(),
                    if (phase == ExamPhase.running || phase == ExamPhase.review)
                      Positioned.fill(child: RunnerToastLayer(toasts: toasts))
                    else
                      Positioned.fill(child: RunnerToastLayer(toasts: toasts, showTimer: false)),
                    if (_fsWarning)
                      Positioned.fill(
                        child: FullscreenWarning(
                          secondsLeft: _fsSecondsLeft,
                          onReturn: () => unawaited(_returnToFullscreen()),
                        ),
                      ),
                    if (widget.overlay != null) Positioned.fill(child: widget.overlay!),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
