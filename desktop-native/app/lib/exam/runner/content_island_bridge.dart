// ContentIslandBridge — keeps the question-card island (architecture §2.4/§2.7) in step with
// an ExamSession, and turns the island's events into session actions.
//
// Native → island:
//   on `ready`      init → module.load → media.put × N → question.show (a full replay; the
//                   same path recovers a crashed island);
//   module change   module.load → media.put → question.show;
//   question change question.show;
//   same question   state.patch with the fields that changed (the authoritative echo);
//   view change     view.set with the fields that changed (zoom, split, highlighter,
//                   eliminator, inputLocked, calcReservePx).
// Island → native:
//   answer.choose / answer.input / answer.eliminate / flag.toggle → the session action, then an
//   immediate state.patch with the session's verdict (so a refused change is painted back);
//   eliminator.toggle, split.changed, annot.changed → the session;
//   selection / selection.clear / annot.click / key / focus / errors → callbacks.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../../core/models/models.dart';
import '../../island/island_host.dart';
import '../../island/protocol.dart';
import '../../island/protocol_convert.dart';
import '../session_contract.dart';

/// The `media.put` mime types the schema allows.
const _allowedMimes = {'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'};

/// What `selection.get` answered.
@immutable
class IslandSelection {
  const IslandSelection({required this.qid, this.container, this.text});
  final int qid;
  final AnnotationContainer? container;
  final String? text;

  bool get isEmpty => (text ?? '').trim().isEmpty;
}

class ContentIslandBridge {
  ContentIslandBridge({
    required this.session,
    required this.host,
    this.calcReservePx,
    this.extraView,
    this.hideIsland,
    this.onSelection,
    this.onSelectionClear,
    this.onAnnotClick,
    this.onKey,
    this.onFocus,
    this.onDiagnostic,
    this.selectionTimeout = const Duration(milliseconds: 400),
  });

  final ExamSession session;
  final IslandHost host;

  /// The px the island keeps free for the calculator (`calcReserve`, ExamRunnerPage.tsx:1185).
  final double Function()? calcReservePx;

  /// Fires when something behind [calcReservePx] or [hideIsland] changes (the runner's tools).
  final Listenable? extraView;

  /// True while the island must be hidden although the student is answering — the windowed
  /// fallback's freeze-frame (architecture §2.6: snapshot → hide the window → overlay).
  final bool Function()? hideIsland;

  final void Function(SelectionMessage m)? onSelection;
  final VoidCallback? onSelectionClear;
  final void Function(AnnotClickMessage m)? onAnnotClick;

  /// An allowed key the island forwarded (it never forwards while the SPR input has focus).
  final void Function(String key)? onKey;
  final void Function(bool inIsland)? onFocus;

  /// Island errors, dropped messages, images that failed, crashes (diagnostics only).
  final void Function(String where, String message)? onDiagnostic;

  /// How long [currentSelection] waits for `selection.current`.
  final Duration selectionTimeout;

  StreamSubscription<IslandEvent>? _sub;
  bool _attached = false;
  bool _ready = false;
  bool _loading = false;
  bool _islandChange = false;
  int _generation = 0;

  int? _loadedModuleId;
  int? _shownQid;
  int? _shownIndex;
  final Map<int, _QState> _sent = {};
  _View? _view;
  bool? _visible;

  int _req = 0;
  final Map<int, Completer<IslandSelection>> _pending = {};

  /// Whether the island page has said `ready` (and not crashed since).
  bool get ready => _ready;

  /// The question the island is showing (null before the first `question.show`).
  int? get shownQuestionId => _shownQid;

  /// Subscribe to the island and the session. Call once; the host may open before or after.
  void attach() {
    if (_attached) return;
    _attached = true;
    _sub = host.events.listen(_onEvent);
    session.addListener(_sync);
    extraView?.addListener(refresh);
  }

  /// Re-evaluates visibility and the view fields (call after [hideIsland] or
  /// [calcReservePx] change outside [extraView]).
  void refresh() {
    if (!_ready || !_attached) return;
    _syncVisibility();
    _syncView();
  }

  Future<void> dispose() async {
    if (!_attached) return;
    _attached = false;
    session.removeListener(_sync);
    extraView?.removeListener(refresh);
    await _sub?.cancel();
    for (final c in _pending.values) {
      if (!c.isCompleted) c.complete(IslandSelection(qid: _currentQid ?? 0));
    }
    _pending.clear();
  }

  int? get _currentQid => session.questions.isEmpty ? null : session.currentQuestion.id;

  // ---- native → island ----------------------------------------------------------------------

  void _post(IslandMessage m) {
    if (!_attached || host.state == IslandHostState.disposed) return;
    host.post(m);
  }

  void _reset() {
    _ready = false;
    _loading = false;
    _generation++;
    _loadedModuleId = null;
    _shownQid = null;
    _shownIndex = null;
    _sent.clear();
    _view = null;
    _visible = null;
  }

  _View _currentView() => _View(
    zoom: session.zoom,
    split: session.split,
    highlighterOn: session.highlighterOn,
    eliminatorOn: session.eliminatorOn,
    inputLocked: session.inputLocked,
    calcReservePx: calcReservePx?.call() ?? 0,
  );

  void _replay() {
    final v = _currentView();
    _post(
      InitMessage(
        mode: 'exam',
        kind: session.kind == ExamKind.midterm ? 'midterm' : 'pastpaper',
        subject: session.test.isMath ? 'math' : 'rw',
        overlays: host.canDrawOverIsland ? 'native' : 'inline',
        zoom: v.zoom,
        split: v.split,
        highlighterOn: v.highlighterOn,
        eliminatorOn: v.eliminatorOn,
        calcReservePx: v.calcReservePx,
      ),
    );
    _view = v;
    if (v.inputLocked) _post(const ViewSetMessage(inputLocked: true));
    _sync();
  }

  void _sync() {
    if (!_ready || !_attached) return;
    _syncVisibility();
    if (session.questions.isEmpty) return;
    if (_loadedModuleId != session.moduleId) {
      if (!_loading) unawaited(_loadModule());
      _syncView();
      return;
    }
    if (_loading) return;
    final q = session.currentQuestion;
    if (_shownQid != q.id || _shownIndex != session.currentIndex) {
      _showQuestion();
    } else if (!_islandChange) {
      _patchIfChanged(q.id);
    }
    _syncView();
  }

  void _syncVisibility() {
    // The island is only on screen while answering (architecture §2.6: hidden on Welcome,
    // Check Your Work and the transition; in windowed mode that also hides the HWND).
    final visible = session.phase == ExamPhase.running && !(hideIsland?.call() ?? false);
    if (_visible == visible) return;
    _visible = visible;
    unawaited(host.setVisible(visible));
  }

  Future<void> _loadModule() async {
    final gen = ++_generation;
    _loading = true;
    final moduleId = session.moduleId;
    final questions = List.of(session.questions);
    _post(moduleLoadMessage(moduleId, questions));
    _shownQid = null;
    _shownIndex = null;
    _sent.clear();
    final keys = session.moduleMediaKeys.toList();
    final blobs = await Future.wait(
      keys.map((k) async {
        try {
          return await session.media(k);
        } on Object catch (e) {
          onDiagnostic?.call('media', 'image $k failed: $e');
          return null;
        }
      }),
    );
    if (gen != _generation || !_attached) return;
    for (var i = 0; i < keys.length; i++) {
      final b = blobs[i];
      if (b == null) {
        onDiagnostic?.call('media', 'image ${keys[i]} is missing');
        continue;
      }
      if (!_allowedMimes.contains(b.mime)) {
        onDiagnostic?.call('media', 'image ${keys[i]} has unsupported type ${b.mime}');
        continue;
      }
      _post(MediaPutMessage(key: b.key, mime: b.mime, b64: base64Encode(b.bytes)));
    }
    _loadedModuleId = moduleId;
    _loading = false;
    _sync();
  }

  _QState _stateOf(int qid) => _QState(
    answer: session.answerFor(qid),
    eliminated: (session.eliminatedFor(qid).toList()..sort()),
    flagged: session.isFlagged(qid),
  );

  void _showQuestion() {
    final q = session.currentQuestion;
    final s = _stateOf(q.id);
    _post(
      QuestionShowMessage(
        qid: q.id,
        index: session.currentIndex,
        total: session.questions.length,
        answer: s.answer,
        eliminated: s.eliminated,
        flagged: s.flagged,
        annotations: islandAnnotationSet(session.annotationsFor(q.id)),
      ),
    );
    _shownQid = q.id;
    _shownIndex = session.currentIndex;
    _sent[q.id] = s;
  }

  void _patchIfChanged(int qid) {
    final now = _stateOf(qid);
    final before = _sent[qid];
    if (before == now) return;
    _post(
      StatePatchMessage(
        qid: qid,
        answer: before?.answer != now.answer ? (now.answer ?? '') : null,
        eliminated: before == null || !listEquals(before.eliminated, now.eliminated) ? now.eliminated : null,
        flagged: before?.flagged != now.flagged ? now.flagged : null,
      ),
    );
    _sent[qid] = now;
  }

  /// The authoritative echo after an island-originated change: all three fields, always.
  void _echo(int qid) {
    if (qid != _shownQid) return;
    final now = _stateOf(qid);
    _post(StatePatchMessage(qid: qid, answer: now.answer ?? '', eliminated: now.eliminated, flagged: now.flagged));
    _sent[qid] = now;
  }

  void _syncView() {
    if (!_ready || !_attached || _view == null) return;
    final now = _currentView();
    final before = _view!;
    if (now == before) return;
    _post(
      ViewSetMessage(
        zoom: now.zoom != before.zoom ? now.zoom : null,
        split: now.split != before.split ? now.split : null,
        highlighterOn: now.highlighterOn != before.highlighterOn ? now.highlighterOn : null,
        eliminatorOn: now.eliminatorOn != before.eliminatorOn ? now.eliminatorOn : null,
        inputLocked: now.inputLocked != before.inputLocked ? now.inputLocked : null,
        calcReservePx: now.calcReservePx != before.calcReservePx ? now.calcReservePx : null,
      ),
    );
    _view = now;
  }

  /// `annot.apply` for the toolbar.
  void applyAnnotation({
    String? selectionId,
    String? annotId,
    required String op,
    HighlightColor? color,
    UnderlineStyle? underline,
  }) {
    if (!_ready) return;
    _post(
      AnnotApplyMessage(
        selectionId: selectionId,
        annotId: annotId,
        op: op,
        color: color?.wire,
        underline: underline?.wire,
      ),
    );
  }

  /// `selection.get` → the student's current selection (empty on timeout or before ready).
  Future<IslandSelection> currentSelection() {
    final qid = _currentQid ?? 0;
    if (!_ready) return Future.value(IslandSelection(qid: qid));
    final req = ++_req;
    final c = Completer<IslandSelection>();
    _pending[req] = c;
    _post(SelectionGetMessage(req: req));
    return c.future.timeout(
      selectionTimeout,
      onTimeout: () {
        _pending.remove(req);
        return IslandSelection(qid: qid);
      },
    );
  }

  /// Escape inside the island: take keyboard focus back to the frame.
  Future<void> releaseFocus() async {
    _post(const FocusReleaseMessage());
    await host.releaseFocus();
  }

  // ---- island → native ----------------------------------------------------------------------

  /// Island events are handled in a microtask, never inside the host's delivery: a host may
  /// deliver synchronously, and answering (posting) from inside its delivery would re-enter
  /// it. Microtasks keep the order.
  void _onEvent(IslandEvent e) => scheduleMicrotask(() {
        if (_attached) _handle(e);
      });

  void _handle(IslandEvent e) {
    switch (e) {
      case IslandCrashedEvent(:final reason):
        onDiagnostic?.call('island', 'content island crashed: $reason');
        _reset();
      case IslandDroppedEvent(:final reason):
        onDiagnostic?.call('island', 'dropped message: $reason');
      case IslandMessageEvent(:final message):
        _onMessage(message);
    }
  }

  bool _isLive(int qid) => session.questions.any((q) => q.id == qid);

  /// Runs an island-originated change (live questions only), then sends ONE full echo.
  void _fromIsland(int qid, VoidCallback action) {
    _islandChange = true;
    try {
      if (_isLive(qid)) action();
    } finally {
      _islandChange = false;
    }
    _echo(qid);
  }

  void _onMessage(IslandMessage m) {
    switch (m) {
      case ReadyMessage():
        _reset();
        _ready = true;
        _replay();
      case ModuleLoadedMessage(:final failed, :final moduleId):
        if (failed.isNotEmpty) onDiagnostic?.call('island', 'module $moduleId: questions $failed failed to render');
      case QuestionShownMessage():
        break;
      case AnswerChooseMessage(:final qid, :final key):
        _fromIsland(qid, () => session.select(qid, key));
      case AnswerInputMessage(:final qid, :final value):
        _fromIsland(qid, () => value.isEmpty ? session.clearAnswer(qid) : session.select(qid, value));
      case AnswerEliminateMessage(:final qid, :final key, :final on):
        _fromIsland(qid, () {
          if (session.eliminatedFor(qid).contains(key) != on) session.toggleEliminate(qid, key);
        });
      case FlagToggleMessage(:final qid):
        _fromIsland(qid, () => session.toggleFlag(qid));
      case EliminatorToggleMessage():
        // The island already flipped its own mode: record that first, so an accepted toggle
        // sends nothing and a refused one (input locked) is put back by view.set.
        _view = _view?.copyWith(eliminatorOn: !_view!.eliminatorOn);
        session.toggleEliminator();
        _syncView();
      case SplitChangedMessage(:final split):
        _view = _view?.copyWith(split: split);
        session.setSplit(split);
        _syncView();
      case AnnotChangedMessage(:final qid, :final container, :final list):
        if (_isLive(qid)) {
          session.recordAnnotations(qid, AnnotationContainer.fromWire(container), [for (final a in list) a.toModel()]);
        }
      case SelectionMessage():
        onSelection?.call(m);
      case SelectionClearMessage():
        onSelectionClear?.call();
      case AnnotClickMessage():
        onAnnotClick?.call(m);
      case SelectionCurrentMessage(:final req, :final qid, :final container, :final text):
        _pending
            .remove(req)
            ?.complete(
              IslandSelection(
                qid: qid,
                container: container == null ? null : AnnotationContainer.fromWire(container),
                text: text,
              ),
            );
      case KeyMessage(:final key):
        onKey?.call(key);
      case FocusMessage(:final inIsland):
        onFocus?.call(inIsland);
      case ErrorMessage(:final where, :final message):
        onDiagnostic?.call('island:$where', message);
      default:
        break;
    }
  }
}

@immutable
class _QState {
  const _QState({required this.answer, required this.eliminated, required this.flagged});
  final String? answer;
  final List<String> eliminated;
  final bool flagged;

  @override
  bool operator ==(Object other) =>
      other is _QState &&
      other.answer == answer &&
      other.flagged == flagged &&
      listEquals(other.eliminated, eliminated);

  @override
  int get hashCode => Object.hash(answer, flagged, Object.hashAll(eliminated));
}

@immutable
class _View {
  const _View({
    required this.zoom,
    required this.split,
    required this.highlighterOn,
    required this.eliminatorOn,
    required this.inputLocked,
    required this.calcReservePx,
  });

  final double zoom;
  final double split;
  final bool highlighterOn;
  final bool eliminatorOn;
  final bool inputLocked;
  final double calcReservePx;

  _View copyWith({double? split, bool? eliminatorOn}) => _View(
    zoom: zoom,
    split: split ?? this.split,
    highlighterOn: highlighterOn,
    eliminatorOn: eliminatorOn ?? this.eliminatorOn,
    inputLocked: inputLocked,
    calcReservePx: calcReservePx,
  );

  @override
  bool operator ==(Object other) =>
      other is _View &&
      other.zoom == zoom &&
      other.split == split &&
      other.highlighterOn == highlighterOn &&
      other.eliminatorOn == eliminatorOn &&
      other.inputLocked == inputLocked &&
      other.calcReservePx == calcReservePx;

  @override
  int get hashCode => Object.hash(zoom, split, highlighterOn, eliminatorOn, inputLocked, calcReservePx);
}
