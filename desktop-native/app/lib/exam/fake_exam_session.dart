// FakeExamSession — a complete in-memory ExamSession driven by the contract fixtures.
// The runner builder develops against it; widget tests and goldens use it. It has no
// network, store or engine: answers live in maps, the clock is a periodic Timer (works
// under fake_async), and module 2 comes from the bundle (past papers) or from the fixture
// midterm submit response (midterms).
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../core/api/fixture_v1_api.dart';
import '../core/models/models.dart';
import 'session_contract.dart';

class FakeExamSession extends ExamSession {
  FakeExamSession({
    required ExamBundle bundle,
    List<ModuleContent> laterModules = const [],
    this.studentName = 'Aziza Karimova',
    ExamPhase initialPhase = ExamPhase.welcome,
    bool online = true,
    this.tick = true,
    this.transitionDelay = const Duration(milliseconds: 300),
  }) : _bundle = bundle,
       // ignore: prefer_initializing_formals
       _online = online,
       _phase = initialPhase {
    kind = bundle.attempt.kind == AttemptKind.midterm ? ExamKind.midterm : ExamKind.pastpaper;
    _modules = [
      for (final m in bundle.modules)
        if (m.questions != null) m,
      ...laterModules,
    ];
    if (_modules.isEmpty) throw ArgumentError('FakeExamSession needs at least one module with questions');
    final liveId = bundle.attempt.module?.id ?? _modules.first.id;
    _moduleIndex = _modules.indexWhere((m) => m.id == liveId).clamp(0, _modules.length - 1);
    for (final e in bundle.answers.entries) {
      _answers[e.key] = Map.of(e.value);
    }
    for (final e in bundle.flagged.entries) {
      _flags[e.key] = e.value.toSet();
    }
    for (final row in bundle.annotations) {
      _annotations.putIfAbsent(row.targetId, () => {})[row.container] = List.of(row.data);
    }
    _remaining = ValueNotifier(Duration(milliseconds: bundle.attempt.timing.remainingMs ?? _durationMs));
    if (bundle.attempt.midterm != null) {
      _offscreen.value = null;
    }
    if (_phase == ExamPhase.running) _startTicker();
  }

  /// Reading & Writing past paper resumed in module 1 (6 questions, saved answers, a flag,
  /// highlights) — `pastpaper_open.response.resume.json`.
  factory FakeExamSession.readingWriting({ExamPhase initialPhase = ExamPhase.running, bool tick = true}) =>
      FakeExamSession(
        bundle: _bundleFrom('pastpaper_open.response.resume.json'),
        initialPhase: initialPhase,
        tick: tick,
      );

  /// Math past paper, fresh (Welcome screen first) — `pastpaper_open.response.json`.
  factory FakeExamSession.math({ExamPhase initialPhase = ExamPhase.welcome, bool tick = true}) =>
      FakeExamSession(bundle: _bundleFrom('pastpaper_open.response.json'), initialPhase: initialPhase, tick: tick);

  /// Two-module Math midterm in module 1; module 2 from `midterm_submit.response.json`.
  factory FakeExamSession.midterm({ExamPhase initialPhase = ExamPhase.running, bool tick = true}) {
    final next = SubmitOutcome.fromJson(JsonReader.of(FixtureV1Api.fixture('midterm_submit.response.json')));
    return FakeExamSession(
      bundle: _bundleFrom('midterm_open.response.json'),
      laterModules: [next.nextModule!],
      initialPhase: initialPhase,
      tick: tick,
    );
  }

  static ExamBundle _bundleFrom(String file) => ExamBundle.fromJson(JsonReader.of(FixtureV1Api.fixture(file)));

  final ExamBundle _bundle;
  late final List<ModuleContent> _modules;
  late int _moduleIndex;

  /// When false the countdown never moves (goldens, deterministic widget tests).
  final bool tick;
  final Duration transitionDelay;

  /// Every action, in order ("select 2001 B", "toggleFlag 2003", …) — for "every button
  /// does something" sweeps.
  final List<String> log = [];

  /// What [reportProblem] answers (tests can change it).
  ReportOutcome nextReportOutcome = ReportOutcome.sent;

  @override
  late final ExamKind kind;

  @override
  final String studentName;

  @override
  int get attemptId => _bundle.attempt.id;

  @override
  TestInfo get test => _bundle.test;

  @override
  int get moduleOrder => _modules[_moduleIndex].order;

  @override
  int get moduleCount => _bundle.attempt.moduleIds.length;

  @override
  int get moduleId => _modules[_moduleIndex].id;

  int get _durationMs => _modules[_moduleIndex].timeLimitMinutes * 60000;

  // ---- questions ------------------------------------------------------------------------

  @override
  List<Question> get questions => _modules[_moduleIndex].questions!;

  int _index = 0;
  @override
  int get currentIndex => _index;

  final Map<int, Map<int, String>> _answers = {};
  final Map<int, Set<int>> _flags = {};
  final Map<int, Set<String>> _eliminated = {};
  final Map<int, Map<AnnotationContainer, List<Annotation>>> _annotations = {};

  /// All answers of the live module (tests).
  Map<int, String> get moduleAnswers => Map.unmodifiable(_answers[moduleId] ?? const {});

  @override
  String? answerFor(int questionId) => _answers[moduleId]?[questionId];

  @override
  bool isFlagged(int questionId) => _flags[moduleId]?.contains(questionId) ?? false;

  @override
  Set<String> eliminatedFor(int questionId) => Set.unmodifiable(_eliminated[questionId] ?? const <String>{});

  bool _eliminatorOn = false;
  @override
  bool get eliminatorOn => _eliminatorOn;

  @override
  Map<AnnotationContainer, List<Annotation>> annotationsFor(int questionId) =>
      Map.unmodifiable(_annotations[questionId] ?? const {});

  // ---- tools / view ---------------------------------------------------------------------

  bool _highlighterOn = false;
  @override
  bool get highlighterOn => _highlighterOn;

  double _zoom = 1.0;
  @override
  double get zoom => _zoom;

  double _split = 0.5;
  @override
  double get split => _split;

  String _notes = '';
  @override
  String get notes => _notes;

  Object? _desmos;
  @override
  Object? get desmosState => _desmos;

  // ---- time -----------------------------------------------------------------------------

  late final ValueNotifier<Duration> _remaining;
  @override
  ValueListenable<Duration> get remaining => _remaining;

  bool _paused = false;
  @override
  bool get paused => _paused;

  @override
  bool get canPause => kind == ExamKind.pastpaper && _online && _phase == ExamPhase.running;

  Timer? _ticker;

  void _startTicker() {
    _ticker?.cancel();
    if (!tick) return;
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => _onTick());
  }

  void _onTick() {
    if (_paused || (_phase != ExamPhase.running && _phase != ExamPhase.review)) return;
    final left = _remaining.value - const Duration(seconds: 1);
    _remaining.value = left.isNegative ? Duration.zero : left;
    if (_remaining.value == Duration.zero) {
      _ticker?.cancel();
      _timeUp = true;
      _notices.add(ExamNotice.timeUp);
      notifyListeners();
      unawaited(_handIn(auto: true));
    }
  }

  bool _timeUp = false;

  // ---- status ---------------------------------------------------------------------------

  ExamPhase _phase;
  @override
  ExamPhase get phase => _phase;

  SyncStatus _sync = SyncStatus.synced;
  @override
  SyncStatus get syncStatus => _online ? _sync : SyncStatus.offline;

  bool _online;
  @override
  bool get online => _online;

  /// Simulate the connection dropping/returning.
  set online(bool value) {
    if (value == _online) return;
    _online = value;
    _notices.add(value ? ExamNotice.reconnected : ExamNotice.reconnecting);
    if (value && _phase == ExamPhase.offlineWaiting) {
      unawaited(_handIn(auto: true));
    }
    notifyListeners();
  }

  @override
  bool get inputLocked =>
      _timeUp ||
      _phase == ExamPhase.transition ||
      _phase == ExamPhase.review ||
      _phase == ExamPhase.offlineWaiting ||
      (_offscreen.value?.countingDown ?? false);

  ModuleTransition? _transition;
  @override
  ModuleTransition? get transition => _transition;

  final ValueNotifier<OffscreenStatus?> _offscreen = ValueNotifier(null);
  @override
  ValueListenable<OffscreenStatus?> get offscreen => _offscreen;

  ExamDoneReason? _doneReason;
  @override
  ExamDoneReason? get doneReason => _doneReason;

  final StreamController<ExamNotice> _notices = StreamController.broadcast();
  @override
  Stream<ExamNotice> get notices => _notices.stream;

  // ---- media ----------------------------------------------------------------------------

  @override
  Future<MediaBlob?> media(String key) async {
    final bytes = FixtureV1Api.fixtureMedia(key);
    return bytes == null ? null : MediaBlob(key: key, mime: 'image/png', bytes: bytes);
  }

  // ---- actions --------------------------------------------------------------------------

  bool get _canEdit => !inputLocked && (_phase == ExamPhase.running);

  void _changed(String entry) {
    log.add(entry);
    _sync = SyncStatus.savedLocally;
    notifyListeners();
  }

  @override
  Future<void> start() async {
    log.add('start');
    if (_phase != ExamPhase.welcome) return;
    _phase = ExamPhase.running;
    _startTicker();
    notifyListeners();
  }

  @override
  void select(int questionId, String value) {
    if (!_canEdit) return;
    final q = questions.where((q) => q.id == questionId).firstOrNull;
    if (q == null) return;
    if (q.isMathInput ? !isValidSprInput(value) : !q.choiceKeys.contains(value)) return;
    _answers.putIfAbsent(moduleId, () => {})[questionId] = value;
    _changed('select $questionId $value');
  }

  @override
  void clearAnswer(int questionId) {
    if (!_canEdit) return;
    _answers[moduleId]?.remove(questionId);
    _changed('clearAnswer $questionId');
  }

  @override
  void toggleFlag(int questionId) {
    if (!_canEdit) return;
    final flags = _flags.putIfAbsent(moduleId, () => {});
    if (!flags.remove(questionId)) flags.add(questionId);
    _changed('toggleFlag $questionId');
  }

  @override
  void toggleEliminator() {
    if (!_canEdit) return;
    _eliminatorOn = !_eliminatorOn;
    log.add('toggleEliminator');
    notifyListeners();
  }

  @override
  void toggleEliminate(int questionId, String choiceKey) {
    if (!_canEdit) return;
    final set = _eliminated.putIfAbsent(questionId, () => {});
    if (!set.remove(choiceKey)) set.add(choiceKey);
    // Striking out the chosen answer clears it (website ChoiceList rule).
    if (set.contains(choiceKey) && answerFor(questionId) == choiceKey) _answers[moduleId]?.remove(questionId);
    log.add('toggleEliminate $questionId $choiceKey');
    notifyListeners();
  }

  @override
  void goTo(int index) {
    if (index < 0 || index >= questions.length) return;
    if (_phase != ExamPhase.running && _phase != ExamPhase.review) return;
    _index = index;
    if (_phase == ExamPhase.review && !_timeUp) _phase = ExamPhase.running;
    log.add('goTo $index');
    notifyListeners();
  }

  @override
  void next() {
    if (_phase != ExamPhase.running) return;
    log.add('next');
    if (_index >= questions.length - 1) {
      openReview();
      return;
    }
    _index++;
    notifyListeners();
  }

  @override
  void back() {
    if (_phase != ExamPhase.running || _index == 0) return;
    _index--;
    log.add('back');
    notifyListeners();
  }

  @override
  void openReview() {
    if (_phase != ExamPhase.running) return;
    _phase = ExamPhase.review;
    log.add('openReview');
    notifyListeners();
  }

  @override
  Future<void> submitModule() async {
    log.add('submitModule');
    if (!canSubmitEarly && !_timeUp) return;
    await _handIn(auto: false);
  }

  Future<void> _handIn({required bool auto}) async {
    if (_phase == ExamPhase.done || _phase == ExamPhase.submitting) return;
    final last = _moduleIndex >= _modules.length - 1;
    if (kind == ExamKind.midterm && !_online) {
      _phase = ExamPhase.offlineWaiting;
      notifyListeners();
      return;
    }
    if (last) {
      _phase = ExamPhase.submitting;
      _sync = SyncStatus.syncing;
      notifyListeners();
      await Future<void>.delayed(transitionDelay);
      _phase = ExamPhase.done;
      _doneReason = ExamDoneReason.submitted;
      _sync = _online ? SyncStatus.synced : SyncStatus.offline;
      _ticker?.cancel();
      notifyListeners();
      return;
    }
    _transition = ModuleTransition(
      fromOrder: moduleOrder,
      toOrder: _modules[_moduleIndex + 1].order,
      waitingForServer: kind == ExamKind.midterm,
    );
    _phase = ExamPhase.transition;
    notifyListeners();
    await Future<void>.delayed(transitionDelay);
    _moduleIndex++;
    _index = 0;
    _eliminated.clear(); // eliminations reset per module
    _timeUp = false;
    _transition = null;
    _remaining.value = Duration(milliseconds: _durationMs);
    _phase = ExamPhase.running;
    _startTicker();
    notifyListeners();
  }

  @override
  Future<bool> pause() async {
    log.add('pause');
    if (!canPause) {
      if (kind == ExamKind.pastpaper && !_online) _notices.add(ExamNotice.pauseNeedsConnection);
      return false;
    }
    _paused = true;
    notifyListeners();
    return true;
  }

  @override
  Future<void> resume() async {
    log.add('resume');
    if (!_paused) return;
    _paused = false;
    notifyListeners();
  }

  @override
  Future<SaveAndExitResult> saveAndExit() async {
    log.add('saveAndExit');
    if (!canSaveAndExit) return const SaveAndExitResult(pausedOnServer: false);
    final online = _online;
    _paused = online;
    _phase = ExamPhase.done;
    _doneReason = ExamDoneReason.savedAndExited;
    _ticker?.cancel();
    notifyListeners();
    return SaveAndExitResult(pausedOnServer: online);
  }

  @override
  Future<ReportOutcome> reportProblem({
    required int questionId,
    required ReportCategory category,
    required String message,
  }) async {
    log.add('reportProblem $questionId ${category.wire}');
    final outcome = _online ? nextReportOutcome : ReportOutcome.queued;
    _notices.add(switch (outcome) {
      ReportOutcome.sent => ExamNotice.reportSent,
      ReportOutcome.deduped => ExamNotice.reportDeduped,
      ReportOutcome.queued => ExamNotice.reportQueued,
    });
    return outcome;
  }

  @override
  void setZoom(double zoom) {
    final z = ((zoom.clamp(examMinZoom, examMaxZoom)) * 10).roundToDouble() / 10;
    if (z == _zoom) return;
    _zoom = z;
    log.add('setZoom $z');
    notifyListeners();
  }

  @override
  void setSplit(double split) {
    _split = split.clamp(0.25, 0.75);
    log.add('setSplit');
    notifyListeners();
  }

  @override
  void toggleHighlighter() {
    _highlighterOn = !_highlighterOn;
    log.add('toggleHighlighter');
    notifyListeners();
  }

  @override
  void recordAnnotations(int questionId, AnnotationContainer container, List<Annotation> annotations) {
    _annotations.putIfAbsent(questionId, () => {})[container] = List.unmodifiable(annotations);
    log.add('recordAnnotations $questionId ${container.wire}');
    notifyListeners();
  }

  @override
  void setNotes(String text) {
    _notes = text;
    log.add('setNotes');
    notifyListeners();
  }

  @override
  void saveDesmosState(Object? state) {
    _desmos = state;
    log.add('saveDesmosState');
  }

  // ---- test hooks -----------------------------------------------------------------------

  /// Midterm: simulate the student leaving the window (starts the 3 s countdown).
  void simulateOffscreen({int? violations}) {
    if (kind != ExamKind.midterm) return;
    final current = _offscreen.value?.violations ?? _bundle.attempt.midterm?.offscreenViolations ?? 0;
    final count = violations ?? current + 1;
    final limit = _bundle.attempt.midterm?.offscreenLimit ?? 3;
    if (count >= limit) {
      _offscreen.value = OffscreenStatus(violations: count, limit: limit, terminated: true);
      _phase = ExamPhase.done;
      _doneReason = ExamDoneReason.terminated;
      _ticker?.cancel();
    } else {
      _offscreen.value = OffscreenStatus(violations: count, limit: limit, graceRemaining: const Duration(seconds: 3));
    }
    notifyListeners();
  }

  /// Midterm: the student came back within the grace.
  void simulateReturn() {
    final s = _offscreen.value;
    if (s == null) return;
    _offscreen.value = OffscreenStatus(violations: s.violations, limit: s.limit, terminated: s.terminated);
    notifyListeners();
  }

  /// Jump the countdown (e.g. to show the 5-minute warning or 0:00).
  void setRemaining(Duration value) {
    _remaining.value = value;
    if (value == Duration.zero && !_timeUp) {
      _timeUp = true;
      notifyListeners();
      unawaited(_handIn(auto: true));
    }
  }

  @override
  void dispose() {
    _ticker?.cancel();
    unawaited(_notices.close());
    _remaining.dispose();
    _offscreen.dispose();
    super.dispose();
  }
}
