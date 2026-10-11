// The S1 harness (architecture §10, "S1: content island in texture mode").
//
// `MasterSAT.exe --s1-harness` (once lib/main.dart routes the flag, see the integration request
// in the windows-host report) or a build of this file as the entry point
// (`flutter build windows -t lib/island/s1_harness.dart`) opens one screen:
//
//   * the content island (the platform's IslandHost: WebView2 texture on Windows) showing the
//     fixture questions from desktop-native/contracts/v1 — Reading and Writing (module 311) and
//     Math (module 301), with their images;
//   * an automatic timing run: host create → page `ready`, module load, first render, and 40
//     next-question round trips per subject (p50 / p95 / max against the 50 ms budget), written
//     to %TEMP%\mastersat-s1.json, plus the island's own pixels (CapturePreview) to
//     %TEMP%\mastersat-s1-island.png;
//   * Back / Next, highlighter, zoom, a Flutter marker drawn at every selection rectangle (the
//     overlay-position check at 100 / 125 / 150 %), a box Flutter draws over the island, the
//     power events the runner reports (sleep / resume / display change) with a check that the
//     island still answers afterwards;
//   * a lockdown toggle (ms_lock_enter / ms_lock_exit with the 3 s heartbeat) when
//     mastersat_native.dll is present, released automatically after two minutes;
//   * the owner's S1 checklist with tick boxes; "Save results" writes the ticks into the JSON.
//
// Owner-facing diagnostics, not student-facing; nothing here talks to the network.
import 'dart:async';
import 'dart:convert';
import 'dart:ffi' as ffi;
import 'dart:io';
import 'dart:math' as math;

import 'package:ffi/ffi.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' hide KeyMessage;
import 'package:path/path.dart' as p;

import '../core/api/fixture_v1_api.dart';
import '../core/models/models.dart';
import '../native/native_bridge.dart';
import 'island_host.dart';
import 'island_host_factory.dart';
import 'protocol.dart';
import 'protocol_convert.dart';
import 'texture_island_host.dart';

/// The flag the runner passes through to Dart.
const String s1HarnessFlag = '--s1-harness';

/// True when the process was started as the S1 harness.
bool isS1HarnessLaunch(List<String> args) => args.contains(s1HarnessFlag);

/// The results file name in the temp folder (packaging/ci/s0-diagnostics.ps1 collects it).
const String s1ResultsFileName = 'mastersat-s1.json';

/// The island screenshot file name in the temp folder.
const String s1PreviewFileName = 'mastersat-s1-island.png';

/// The next-question budget (architecture §2.9: 95th percentile ≤ 50 ms).
const double s1NextQuestionBudgetMs = 50;

/// Entry point when this file is built as the target (CI's S0 step does this until
/// lib/main.dart routes `--s1-harness`).
Future<void> main(List<String> args) => runS1Harness(args);

/// Starts the harness app. [lockdown] defaults to mastersat_native.dll when it is loadable.
Future<void> runS1Harness(
  List<String> args, {
  IslandHostFactory? hostFactory,
  S1Lockdown? lockdown,
  Directory? resultsDirectory,
}) async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    S1HarnessApp(
      controller: S1Controller(
        hostFactory: hostFactory ?? islandHostFactory(),
        lockdown: lockdown ?? DllS1Lockdown.tryLoad(),
        resultsDirectory: resultsDirectory ?? s1DefaultResultsDirectory(),
      ),
    ),
  );
}

/// %TEMP% on Windows (the folder the S0 script reads), the system temp folder elsewhere.
Directory s1DefaultResultsDirectory() {
  final temp = Platform.isWindows ? Platform.environment['TEMP'] : null;
  return temp != null && temp.isNotEmpty ? Directory(temp) : Directory.systemTemp;
}

// =================================================================================================
// Fixture content
// =================================================================================================

/// One subject's module from the v1 fixtures.
class S1Module {
  const S1Module({
    required this.subject,
    required this.label,
    required this.moduleId,
    required this.questions,
    required this.media,
  });

  /// `rw` | `math` (the island's `init.subject`).
  final String subject;
  final String label;
  final int moduleId;
  final List<Question> questions;

  /// key → (mime, bytes)
  final Map<String, ({String mime, Uint8List bytes})> media;

  /// Reading and Writing: module 311 of the resume fixture; Math: module 301 of the fresh one.
  static List<S1Module> fixtures() => [
    _fromBundle('pastpaper_open.response.resume.json', 'rw', 'Reading and Writing'),
    _fromBundle('pastpaper_open.response.json', 'math', 'Math'),
  ];

  static S1Module _fromBundle(String file, String subject, String label) {
    final bundle = ExamBundle.fromJson(JsonReader(FixtureV1Api.fixture(file)));
    final module = bundle.modules.firstWhere((m) => (m.questions ?? const []).isNotEmpty);
    final media = <String, ({String mime, Uint8List bytes})>{};
    for (final ref in bundle.media) {
      final bytes = FixtureV1Api.fixtureMedia(ref.key);
      if (bytes != null) media[ref.key] = (mime: s1MimeFor(ref.key), bytes: bytes);
    }
    return S1Module(subject: subject, label: label, moduleId: module.id, questions: module.questions!, media: media);
  }
}

/// The `media.put` mime type for a media key.
String s1MimeFor(String key) => switch (p.extension(key).toLowerCase()) {
  '.jpg' || '.jpeg' => 'image/jpeg',
  '.gif' => 'image/gif',
  '.webp' => 'image/webp',
  '.svg' => 'image/svg+xml',
  _ => 'image/png',
};

// =================================================================================================
// Measurements
// =================================================================================================

/// Nearest-rank percentile of [values] (0 < q ≤ 1); null when empty.
double? s1Percentile(List<double> values, double q) {
  if (values.isEmpty) return null;
  final sorted = [...values]..sort();
  final rank = (q * sorted.length).ceil().clamp(1, sorted.length);
  return sorted[rank - 1];
}

double _round1(double v) => (v * 10).roundToDouble() / 10;

/// Timings for one subject.
class S1SubjectTimings {
  double? moduleLoadMs;
  double? islandModuleLoadMs;
  int failedQuestions = 0;
  double? firstRenderMs;
  final List<double> nextMs = [];
  final List<double> islandNextMs = [];
  int timeouts = 0;

  double? get nextP95 => s1Percentile(nextMs, .95);

  Map<String, Object?> toJson() => {
    'moduleLoadMs': moduleLoadMs == null ? null : _round1(moduleLoadMs!),
    'islandModuleLoadMs': islandModuleLoadMs,
    'failedQuestions': failedQuestions,
    'firstRenderMs': firstRenderMs == null ? null : _round1(firstRenderMs!),
    'next': {
      'n': nextMs.length,
      'p50': _r(s1Percentile(nextMs, .5)),
      'p95': _r(nextP95),
      'max': _r(nextMs.isEmpty ? null : nextMs.reduce(math.max)),
      'islandP50': _r(s1Percentile(islandNextMs, .5)),
      'islandP95': _r(s1Percentile(islandNextMs, .95)),
      'timeouts': timeouts,
    },
  };

  static double? _r(double? v) => v == null ? null : _round1(v);
}

/// One power event from the runner (MethodChannel 'mastersat/power') and whether the island still
/// answered a `question.show` afterwards.
class S1PowerEvent {
  S1PowerEvent(this.event, this.at);
  final String event;
  final DateTime at;
  bool? islandAnswered;
  double? answerMs;

  Map<String, Object?> toJson() => {
    'event': event,
    'at': at.toUtc().toIso8601String(),
    'islandAnswered': islandAnswered,
    'answerMs': answerMs == null ? null : _round1(answerMs!),
  };
}

/// The owner's S1 checklist (architecture §10). The ids are stable keys in the results JSON.
const List<({String id, String text})> s1Checklist = [
  (id: 'render', text: 'Reading and Writing and Math questions render: math notation, the table and the images.'),
  (id: 'speed', text: 'The next question appears at once (the timing panel shows p95 under 50 ms).'),
  (
    id: 'selection',
    text: 'Select text in the card: the yellow marker sits on the selection at 100 %, 125 % and 150 % display scale.',
  ),
  (id: 'cursor', text: 'The cursor is an I-beam over text and an arrow everywhere else (never a hand).'),
  (
    id: 'resume',
    text: 'After sleep and wake, a display or monitor change, and Ctrl+Win+Shift+B, the card is still drawn and still answers.',
  ),
  (id: 'lockdown', text: 'With lockdown on you can see the card, and Snipping Tool and PrintScreen capture black.'),
  (id: 'border', text: 'No yellow border around the card and no double cursor.'),
  (id: 'keys', text: 'Click into the card: F5, Ctrl+R, Ctrl+P, Ctrl+F, F12 and Alt+Left do nothing.'),
  (id: 'memory', text: 'Task Manager: MasterSAT and its WebView2 processes stay at or under 350 MB.'),
  (id: 'look', text: 'Scrolling and text look right.'),
  (id: 'renderer', text: 'Renderer recorded (Impeller on and off tried; write the one that shipped in the notes).'),
];

// =================================================================================================
// Lockdown
// =================================================================================================

/// The part of the native library the harness needs.
abstract class S1Lockdown {
  /// Where it comes from (shown on screen and in the JSON).
  String get description;

  /// ms_lock_enter: the captured precheck JSON. Throws [NativeBridgeException] (errPrecheck when
  /// the machine is not ready).
  String enter();

  /// ms_lock_exit (safe when not locked).
  void exit();

  /// ms_heartbeat: true while locked.
  bool heartbeat();

  /// Over the app's NativeBridge (what lib/main.dart passes once the rust workstream's
  /// FfiNativeBridge is merged).
  static S1Lockdown fromBridge(NativeBridge bridge) => _BridgeS1Lockdown(bridge);
}

class _BridgeS1Lockdown implements S1Lockdown {
  _BridgeS1Lockdown(this.bridge);
  final NativeBridge bridge;

  @override
  String get description => 'NativeBridge ${bridge.libraryVersion}';

  @override
  String enter() => bridge.lockEnter().raw;

  @override
  void exit() => bridge.lockExit();

  @override
  bool heartbeat() => bridge.heartbeat();
}

typedef _LockEnterC = ffi.Int32 Function(ffi.Pointer<ffi.Pointer<Utf8>>);
typedef _LockEnterDart = int Function(ffi.Pointer<ffi.Pointer<Utf8>>);
typedef _NoArgIntC = ffi.Int32 Function();
typedef _NoArgIntDart = int Function();
typedef _FreeC = ffi.Void Function(ffi.Pointer<Utf8>);
typedef _FreeDart = void Function(ffi.Pointer<Utf8>);
typedef _LastErrorC = ffi.Pointer<Utf8> Function();
typedef _VersionC = ffi.Pointer<Utf8> Function();

/// mastersat_native.dll bound directly (only the five functions the harness needs; the app's full
/// binding is the rust workstream's FfiNativeBridge). The runner already loaded and initialised
/// the DLL (ms_init), so this opens the same module.
class DllS1Lockdown implements S1Lockdown {
  DllS1Lockdown._(ffi.DynamicLibrary lib)
    : _enter = lib.lookupFunction<_LockEnterC, _LockEnterDart>('ms_lock_enter'),
      _exit = lib.lookupFunction<_NoArgIntC, _NoArgIntDart>('ms_lock_exit'),
      _heartbeat = lib.lookupFunction<_NoArgIntC, _NoArgIntDart>('ms_heartbeat'),
      _free = lib.lookupFunction<_FreeC, _FreeDart>('ms_free'),
      _lastError = lib.lookupFunction<_LastErrorC, _LastErrorC>('ms_last_error'),
      _version = lib.lookupFunction<_VersionC, _VersionC>('ms_version');

  /// The DLL beside the exe, or null when this build has none (or not on Windows).
  static DllS1Lockdown? tryLoad() {
    if (!Platform.isWindows) return null;
    try {
      return DllS1Lockdown._(ffi.DynamicLibrary.open('mastersat_native.dll'));
    } on Object {
      return null;
    }
  }

  final _LockEnterDart _enter;
  final _NoArgIntDart _exit;
  final _NoArgIntDart _heartbeat;
  final _FreeDart _free;
  final _LastErrorC _lastError;
  final _VersionC _version;

  @override
  String get description {
    final v = _version();
    return 'mastersat_native.dll ${v == ffi.nullptr ? '?' : v.toDartString()}';
  }

  String? _takeLastError() {
    final e = _lastError();
    if (e == ffi.nullptr) return null;
    try {
      return e.toDartString();
    } finally {
      _free(e);
    }
  }

  @override
  String enter() {
    final out = calloc<ffi.Pointer<Utf8>>();
    try {
      final code = _enter(out);
      String? json;
      if (out.value != ffi.nullptr) {
        json = out.value.toDartString();
        _free(out.value);
      }
      if (code != NativeStatus.ok) {
        throw NativeBridgeException(code, 'ms_lock_enter', [_takeLastError(), json].whereType<String>().join(' '));
      }
      return json ?? '';
    } finally {
      calloc.free(out);
    }
  }

  @override
  void exit() {
    final code = _exit();
    if (code != NativeStatus.ok) throw NativeBridgeException(code, 'ms_lock_exit', _takeLastError());
  }

  @override
  bool heartbeat() => _heartbeat() == 1;
}

// =================================================================================================
// Controller
// =================================================================================================

enum S1Phase { starting, running, interactive, failed }

/// Drives the island through the S1 sequence and keeps everything the screen shows.
class S1Controller extends ChangeNotifier {
  S1Controller({
    required this.hostFactory,
    required this.lockdown,
    required this.resultsDirectory,
    List<S1Module>? modules,
    this.nextIterations = 40,
    this.waitTimeout = const Duration(seconds: 5),
    this.readyTimeout = const Duration(seconds: 30),
    this.lockdownAutoRelease = const Duration(minutes: 2),
    MethodChannel? powerChannel,
    DateTime Function()? now,
  }) : modules = modules ?? S1Module.fixtures(),
       _powerChannel = powerChannel ?? const MethodChannel('mastersat/power'),
       _now = now ?? DateTime.now,
       startedAt = (now ?? DateTime.now)();

  final IslandHostFactory hostFactory;
  final S1Lockdown? lockdown;
  final Directory resultsDirectory;
  final List<S1Module> modules;
  final int nextIterations;
  final Duration waitTimeout;
  final Duration readyTimeout;
  final Duration lockdownAutoRelease;
  final MethodChannel _powerChannel;
  final DateTime Function() _now;

  IslandHost? _host;
  IslandHost? get host => _host;
  StreamSubscription<IslandEvent>? _sub;

  S1Phase phase = S1Phase.starting;
  String status = 'Starting the island…';
  final List<String> log = [];
  final List<String> problems = [];
  final List<S1PowerEvent> powerEvents = [];
  final Map<String, bool> manual = {for (final c in s1Checklist) c.id: false};
  String notes = '';

  // Timings.
  /// When the harness was created (not when the results were first written).
  final DateTime startedAt;
  double? openMs;
  double? readyMs;
  String? islandBuild;
  String? webview2Version;
  final Map<String, S1SubjectTimings> timings = {};
  int crashes = 0;
  int dropped = 0;
  String? resultsPath;
  String? previewPath;
  int? previewBytes;

  // Interactive state.
  int moduleIndex = 0;
  int questionIndex = 0;
  bool highlighterOn = false;
  bool eliminatorOn = false;
  double zoom = 1.0;
  final Map<int, String> answers = {};
  final Set<int> flagged = {};
  final Map<int, Set<String>> eliminated = {};
  final Map<int, Map<String, List<IslandAnnotation>>> annotations = {};
  SelectionMessage? selection;
  final List<String> recentMessages = [];

  // Lockdown.
  bool locked = false;
  String? lockdownError;
  String? precheck;
  Timer? _heartbeatTimer;
  Timer? _autoRelease;

  bool _disposed = false;
  bool _ready = false;
  Completer<void>? _readyWaiter;
  final List<_Waiter> _waiters = [];
  int _showSeq = 0;
  final List<({int seq, int qid})> _pendingShows = [];
  final Map<int, Completer<QuestionShownMessage?>> _showWaiters = {};

  S1Module get module => modules[moduleIndex];
  Question get question => module.questions[questionIndex];

  // ---------------------------------------------------------------------------------------------
  // Start + automatic run
  // ---------------------------------------------------------------------------------------------

  Future<void> start() async {
    _powerChannel.setMethodCallHandler(_onPowerCall);
    final total = Stopwatch()..start();
    try {
      webview2Version = await TextureIslandHost.runtimeVersion();
      _log('WebView2 runtime: ${webview2Version ?? 'not found'}');
      final host = hostFactory(IslandKind.content);
      _log('opening ${host.runtimeType}');
      _host = host;
      _readyWaiter = Completer<void>();
      _sub = host.events.listen(_onEvent);
      notifyListeners();
      await host.open();
      openMs = _ms(total);
      _log('host open in ${openMs!.toStringAsFixed(1)} ms (${host.runtimeType})');
      await _readyWaiter!.future.timeout(readyTimeout);
      readyMs = _ms(total);
      _log('island ready in ${readyMs!.toStringAsFixed(1)} ms (build ${islandBuild ?? '?'})');
    } on Object catch (e) {
      _fail('The island did not start: $e');
      await writeResults();
      return;
    }

    phase = S1Phase.running;
    for (var m = 0; m < modules.length && !_disposed; m++) {
      await _runSubject(m);
    }
    if (_disposed) return;
    await _capturePreview();
    await writeResults();
    // Back to the first Reading and Writing question for the owner.
    await _load(0);
    await _show(0);
    phase = S1Phase.interactive;
    status = 'Timing run done. Work through the checklist, then Save results.';
    notifyListeners();
  }

  Future<void> _runSubject(int m) async {
    final t = timings.putIfAbsent(modules[m].subject, S1SubjectTimings.new);
    status = 'Timing ${modules[m].label}…';
    notifyListeners();
    await _load(m, timings: t);
    final first = await _show(0);
    t.firstRenderMs = first?.$1;
    final n = modules[m].questions.length;
    for (var i = 0; i < nextIterations && !_disposed; i++) {
      final shown = await _show((i + 1) % n);
      if (shown == null) {
        t.timeouts++;
      } else {
        t.nextMs.add(shown.$1);
        t.islandNextMs.add(shown.$2);
      }
    }
    _log('${modules[m].label}: next p95 ${t.nextP95?.toStringAsFixed(1) ?? '—'} ms over ${t.nextMs.length}');
  }

  /// init → media.put → module.load, waiting for module.loaded.
  Future<void> _load(int m, {S1SubjectTimings? timings}) async {
    final host = _host;
    if (host == null) return;
    moduleIndex = m;
    questionIndex = 0;
    selection = null;
    final mod = modules[m];
    host.post(
      InitMessage(
        mode: 'exam',
        kind: 'pastpaper',
        subject: mod.subject,
        overlays: 'native',
        zoom: zoom,
        split: .5,
        highlighterOn: highlighterOn,
        eliminatorOn: eliminatorOn,
        calcReservePx: 0,
      ),
    );
    for (final e in mod.media.entries) {
      host.post(MediaPutMessage(key: e.key, mime: e.value.mime, b64: base64Encode(e.value.bytes)));
    }
    final sw = Stopwatch()..start();
    final loaded = await _expect<ModuleLoadedMessage>(
      (msg) => msg.moduleId == mod.moduleId,
      () => host.post(moduleLoadMessage(mod.moduleId, mod.questions)),
    );
    if (loaded == null) {
      _problem('${mod.label}: no module.loaded within ${waitTimeout.inSeconds} s');
    } else {
      timings?.moduleLoadMs = _ms(sw);
      timings?.islandModuleLoadMs = loaded.ms.toDouble();
      timings?.failedQuestions = loaded.failed.length;
      if (loaded.failed.isNotEmpty) _problem('${mod.label}: the island could not build questions ${loaded.failed}');
    }
    notifyListeners();
  }

  /// question.show for [index]; (native round trip ms, island-reported ms) or null on timeout.
  Future<(double, double)?> _show(int index) async {
    final host = _host;
    if (host == null) return null;
    questionIndex = index;
    selection = null;
    final q = question;
    // The island answers every question.show in order. A late answer to a show that already
    // timed out belongs to that show, never to a newer show of the same question.
    final seq = ++_showSeq;
    final completer = Completer<QuestionShownMessage?>();
    _showWaiters[seq] = completer;
    _pendingShows.add((seq: seq, qid: q.id));
    if (_pendingShows.length > 200) _pendingShows.removeAt(0);
    final sw = Stopwatch()..start();
    host.post(_showMessage(index));
    QuestionShownMessage? shown;
    try {
      shown = await completer.future.timeout(waitTimeout);
    } on TimeoutException {
      shown = null;
    } finally {
      _showWaiters.remove(seq);
    }
    notifyListeners();
    if (shown == null) return null;
    return (_ms(sw), shown.ms.toDouble());
  }

  void _onShown(QuestionShownMessage m) {
    final i = _pendingShows.indexWhere((e) => e.qid == m.qid);
    if (i < 0) return;
    final entry = _pendingShows[i];
    // Shows before it were never answered (the island dropped them); forget them.
    _pendingShows.removeRange(0, i + 1);
    final waiter = _showWaiters.remove(entry.seq);
    if (waiter != null && !waiter.isCompleted) waiter.complete(m);
  }

  QuestionShowMessage _showMessage(int index) {
    final q = module.questions[index];
    final a = annotations[q.id] ?? const {};
    return QuestionShowMessage(
      qid: q.id,
      index: index,
      total: module.questions.length,
      answer: answers[q.id],
      eliminated: (eliminated[q.id] ?? const <String>{}).toList()..sort(),
      flagged: flagged.contains(q.id),
      annotations: IslandAnnotationSet(
        passage: a['passage'] ?? const [],
        question: a['question'] ?? const [],
        choices: a['choices'] ?? const [],
      ),
    );
  }

  Future<void> _capturePreview() async {
    final host = _host;
    if (host == null) return;
    try {
      final png = await host.capturePreview();
      if (png == null || png.isEmpty) {
        _log('capturePreview: not available on this host');
        return;
      }
      final file = File(p.join(resultsDirectory.path, s1PreviewFileName));
      await file.writeAsBytes(png, flush: true);
      previewPath = file.path;
      previewBytes = png.length;
      _log('island pixels saved (${png.length} bytes)');
    } on Object catch (e) {
      _problem('capturePreview failed: $e');
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Island events
  // ---------------------------------------------------------------------------------------------

  void _onEvent(IslandEvent event) {
    switch (event) {
      case IslandMessageEvent(:final message):
        _onMessage(message);
      case IslandDroppedEvent(:final reason):
        dropped++;
        _problem('dropped an invalid island message: $reason');
      case IslandCrashedEvent(:final reason):
        crashes++;
        _ready = false;
        _problem('island crashed: $reason');
    }
  }

  void _onMessage(IslandMessage m) {
    if (recentMessages.length >= 8) recentMessages.removeAt(0);
    recentMessages.add(m.t);
    if (m is QuestionShownMessage) _onShown(m);
    for (final w in [..._waiters]) {
      if (w.matches(m)) {
        _waiters.remove(w);
        w.completer.complete(m);
      }
    }
    switch (m) {
      case ReadyMessage(:final build):
        islandBuild = build;
        final firstReady = !(_readyWaiter?.isCompleted ?? true);
        if (firstReady) {
          _readyWaiter!.complete();
        } else if (!_ready && phase == S1Phase.interactive) {
          // Recreated after a crash: replay from our own state (architecture §2.5).
          _log('island recreated; replaying init → module.load → question.show');
          final m = moduleIndex, q = questionIndex;
          scheduleMicrotask(() => unawaited(_load(m).then((_) => _show(q))));
        }
        _ready = true;
      case AnswerChooseMessage(:final qid, :final key):
        answers[qid] = key;
        _host?.post(StatePatchMessage(qid: qid, answer: key));
      case AnswerInputMessage(:final qid, :final value):
        answers[qid] = value;
        _host?.post(StatePatchMessage(qid: qid, answer: value));
      case AnswerEliminateMessage(:final qid, :final key, :final on):
        final set = eliminated.putIfAbsent(qid, () => <String>{});
        on ? set.add(key) : set.remove(key);
        _host?.post(StatePatchMessage(qid: qid, eliminated: set.toList()..sort()));
      case FlagToggleMessage(:final qid):
        flagged.contains(qid) ? flagged.remove(qid) : flagged.add(qid);
        _host?.post(StatePatchMessage(qid: qid, flagged: flagged.contains(qid)));
      case EliminatorToggleMessage():
        eliminatorOn = !eliminatorOn;
        _host?.post(ViewSetMessage(eliminatorOn: eliminatorOn));
      case SelectionMessage():
        selection = m;
      case SelectionClearMessage():
        selection = null;
      case AnnotChangedMessage(:final qid, :final container, :final list):
        annotations.putIfAbsent(qid, () => {})[container] = list;
      case KeyMessage(:final key):
        if (phase == S1Phase.interactive) {
          // Never re-enter the island from inside its own event.
          if (key == 'ArrowRight') scheduleMicrotask(() => unawaited(next()));
          if (key == 'ArrowLeft') scheduleMicrotask(() => unawaited(back()));
        }
      case ErrorMessage(:final where, :final message):
        _problem('island error in $where: $message');
      default:
        break;
    }
    notifyListeners();
  }

  Future<T?> _expect<T extends IslandMessage>(bool Function(T) test, void Function() send) async {
    final waiter = _Waiter((m) => m is T && test(m));
    _waiters.add(waiter);
    send();
    try {
      return await waiter.completer.future.timeout(waitTimeout) as T?;
    } on TimeoutException {
      _waiters.remove(waiter);
      return null;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Interactive actions
  // ---------------------------------------------------------------------------------------------

  bool get interactive => phase == S1Phase.interactive;

  Future<void> next() async {
    if (!interactive) return;
    await _show((questionIndex + 1) % module.questions.length);
  }

  Future<void> back() async {
    if (!interactive) return;
    final n = module.questions.length;
    await _show((questionIndex - 1 + n) % n);
  }

  Future<void> switchSubject(int m) async {
    if (!interactive || m == moduleIndex) return;
    await _load(m);
    await _show(0);
  }

  void toggleHighlighter() {
    highlighterOn = !highlighterOn;
    _host?.post(ViewSetMessage(highlighterOn: highlighterOn));
    notifyListeners();
  }

  void setZoom(double value) {
    zoom = double.parse(value.clamp(0.8, 1.6).toStringAsFixed(1));
    _host?.post(ViewSetMessage(zoom: zoom));
    notifyListeners();
  }

  /// Highlight the current selection yellow (the toolbar's first swatch).
  void highlightSelection() {
    final s = selection;
    if (s == null) return;
    _host?.post(AnnotApplyMessage(selectionId: s.selectionId, op: 'highlight', color: 'yellow'));
    selection = null;
    notifyListeners();
  }

  void setManual(String id, bool value) {
    manual[id] = value;
    notifyListeners();
  }

  Future<void> rerunTiming() async {
    if (!interactive) return;
    phase = S1Phase.running;
    timings.clear();
    notifyListeners();
    for (var m = 0; m < modules.length && !_disposed; m++) {
      await _runSubject(m);
    }
    if (_disposed) return;
    await writeResults();
    await _load(0);
    await _show(0);
    phase = S1Phase.interactive;
    status = 'Timing run done again.';
    notifyListeners();
  }

  // ---------------------------------------------------------------------------------------------
  // Lockdown
  // ---------------------------------------------------------------------------------------------

  Future<void> toggleLockdown() async {
    final l = lockdown;
    if (l == null) return;
    lockdownError = null;
    if (!locked) {
      try {
        precheck = l.enter();
        locked = true;
        _log('lockdown on');
        _heartbeatTimer = Timer.periodic(const Duration(seconds: 3), (_) {
          if (!l.heartbeat()) {
            _stopLockTimers();
            locked = false;
            _log('lockdown released by the watchdog');
            notifyListeners();
          }
        });
        _autoRelease = Timer(lockdownAutoRelease, () {
          _log('lockdown released automatically after ${lockdownAutoRelease.inSeconds} s');
          unawaited(toggleLockdown());
        });
      } on NativeBridgeException catch (e) {
        lockdownError = e.code == NativeStatus.errPrecheck
            ? 'This computer is not ready for lockdown: ${e.message ?? ''}'
            : e.toString();
      } on Object catch (e) {
        lockdownError = '$e';
      }
    } else {
      _stopLockTimers();
      try {
        l.exit();
      } on Object catch (e) {
        lockdownError = '$e';
      }
      locked = false;
      _log('lockdown off');
    }
    notifyListeners();
  }

  void _stopLockTimers() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    _autoRelease?.cancel();
    _autoRelease = null;
  }

  // ---------------------------------------------------------------------------------------------
  // Power events (runner → Dart, windows/runner/flutter_window.cpp)
  // ---------------------------------------------------------------------------------------------

  Future<Object?> _onPowerCall(MethodCall call) async {
    if (call.method != 'event') return null;
    final args = (call.arguments as Map?)?.cast<Object?, Object?>() ?? const {};
    final name = args['event'] as String? ?? '?';
    final event = S1PowerEvent(name, _now());
    powerEvents.add(event);
    _log('power: $name');
    notifyListeners();
    if (name == 'resume' || name == 'resumeAutomatic' || name == 'displayChanged') {
      // Give the system a moment, then check that the island still draws and answers.
      await Future<void>.delayed(const Duration(seconds: 2));
      if (_disposed || !interactive) return null;
      final shown = await _show(questionIndex);
      event
        ..islandAnswered = shown != null
        ..answerMs = shown?.$1;
      notifyListeners();
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------------------------

  Map<String, Object?> resultsJson() {
    final p95s = [for (final t in timings.values) t.nextP95].whereType<double>();
    final h = _host;
    return {
      'schema': 1,
      'harness': 's1',
      'startedAt': startedAt.toUtc().toIso8601String(),
      'writtenAt': _now().toUtc().toIso8601String(),
      'platform': Platform.operatingSystem,
      'osVersion': Platform.operatingSystemVersion,
      'dartVersion': Platform.version.split(' ').first,
      'releaseMode': kReleaseMode,
      'host': h?.runtimeType.toString(),
      'hostState': h?.state.name,
      'webview2Version': webview2Version,
      'islandBuild': islandBuild,
      'display': _displayJson(),
      'timings': {
        'openMs': openMs == null ? null : _round1(openMs!),
        'readyMs': readyMs == null ? null : _round1(readyMs!),
        'subjects': {for (final e in timings.entries) e.key: e.value.toJson()},
      },
      'budgets': {'nextP95Ms': s1NextQuestionBudgetMs},
      'pass': {
        'started': readyMs != null,
        'nextP95': p95s.isEmpty ? null : p95s.every((v) => v <= s1NextQuestionBudgetMs),
      },
      'preview': previewPath == null ? null : {'path': previewPath, 'bytes': previewBytes},
      'crashes': crashes,
      'droppedMessages': dropped,
      'blocked': h is WebviewIslandHost ? [for (final b in h.blocked) '${b.what} ${b.uri}'] : const <String>[],
      'problems': problems,
      'powerEvents': [for (final e in powerEvents) e.toJson()],
      'lockdown': {
        'available': lockdown != null,
        'source': lockdown?.description,
        'engaged': locked,
        'precheck': precheck,
        'error': lockdownError,
      },
      'manual': manual,
      'notes': notes,
    };
  }

  Map<String, Object?>? _displayJson() {
    final views = WidgetsBinding.instance.platformDispatcher.views;
    if (views.isEmpty) return null;
    final v = views.first;
    return {
      'devicePixelRatio': v.devicePixelRatio,
      'physicalWidth': v.physicalSize.width,
      'physicalHeight': v.physicalSize.height,
      'logicalWidth': _round1(v.physicalSize.width / v.devicePixelRatio),
      'logicalHeight': _round1(v.physicalSize.height / v.devicePixelRatio),
    };
  }

  Future<String?> writeResults() async {
    try {
      final file = File(p.join(resultsDirectory.path, s1ResultsFileName));
      final tmp = File('${file.path}.tmp');
      await tmp.writeAsString(const JsonEncoder.withIndent('  ').convert(resultsJson()), flush: true);
      await tmp.rename(file.path);
      resultsPath = file.path;
      _log('results written to ${file.path}');
      return file.path;
    } on Object catch (e) {
      _problem('could not write the results: $e');
      return null;
    } finally {
      notifyListeners();
    }
  }

  // ---------------------------------------------------------------------------------------------

  void _log(String line) {
    debugPrint('[s1] $line');
    log.add('${_now().toIso8601String().substring(11, 19)}  $line');
    if (log.length > 200) log.removeAt(0);
    if (!_disposed) notifyListeners();
  }

  void _problem(String text) {
    problems.add(text);
    _log('PROBLEM: $text');
  }

  void _fail(String text) {
    phase = S1Phase.failed;
    status = text;
    _problem(text);
  }

  static double _ms(Stopwatch sw) => sw.elapsedMicroseconds / 1000.0;

  @override
  void dispose() {
    _disposed = true;
    _powerChannel.setMethodCallHandler(null);
    _stopLockTimers();
    if (locked) {
      try {
        lockdown?.exit();
      } on Object {
        // Leaving the harness must never keep the machine locked.
      }
    }
    for (final w in _waiters) {
      if (!w.completer.isCompleted) w.completer.complete(null);
    }
    _waiters.clear();
    for (final c in _showWaiters.values) {
      if (!c.isCompleted) c.complete(null);
    }
    _showWaiters.clear();
    unawaited(_sub?.cancel());
    unawaited(_host?.dispose());
    super.dispose();
  }
}

class _Waiter {
  _Waiter(this.matches);
  final bool Function(IslandMessage) matches;
  final Completer<IslandMessage?> completer = Completer<IslandMessage?>();
}

// =================================================================================================
// UI
// =================================================================================================

const _ink = Color(0xFF1F2937);
const _muted = Color(0xFF6B7280);
const _line = Color(0xFFE5E7EB);
const _panel = Color(0xFFF9FAFB);
const _blue = Color(0xFF1D4ED8);
const _good = Color(0xFF047857);
const _bad = Color(0xFFB91C1C);

class S1HarnessApp extends StatefulWidget {
  const S1HarnessApp({super.key, required this.controller, this.autoStart = true});

  final S1Controller controller;
  final bool autoStart;

  @override
  State<S1HarnessApp> createState() => _S1HarnessAppState();
}

class _S1HarnessAppState extends State<S1HarnessApp> {
  @override
  void initState() {
    super.initState();
    if (widget.autoStart) unawaited(widget.controller.start());
  }

  @override
  void dispose() {
    widget.controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'MasterSAT S1 harness',
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: _blue, surface: Colors.white),
      fontFamily: 'Segoe UI',
      splashFactory: NoSplash.splashFactory,
      hoverColor: Colors.transparent,
      highlightColor: Colors.transparent,
      visualDensity: VisualDensity.compact,
    ),
    home: S1HarnessScreen(controller: widget.controller),
  );
}

class S1HarnessScreen extends StatelessWidget {
  const S1HarnessScreen({super.key, required this.controller});

  final S1Controller controller;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Colors.white,
    body: CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.arrowRight): () => unawaited(controller.next()),
        const SingleActivator(LogicalKeyboardKey.arrowLeft): () => unawaited(controller.back()),
      },
      child: Focus(
        autofocus: true,
        child: ListenableBuilder(
          listenable: controller,
          builder: (context, _) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Toolbar(controller: controller),
              const Divider(height: 1, color: _line),
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(child: _IslandArea(controller: controller)),
                    const VerticalDivider(width: 1, color: _line),
                    SizedBox(width: 380, child: _SidePanel(controller: controller)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _Toolbar extends StatelessWidget {
  const _Toolbar({required this.controller});
  final S1Controller controller;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final on = c.interactive;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          const Text(
            'S1 harness',
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: _ink),
          ),
          const SizedBox(width: 8),
          SegmentedButton<int>(
            segments: [
              for (var i = 0; i < c.modules.length; i++) ButtonSegment(value: i, label: Text(c.modules[i].label)),
            ],
            selected: {c.moduleIndex},
            showSelectedIcon: false,
            onSelectionChanged: on ? (s) => unawaited(c.switchSubject(s.first)) : null,
          ),
          OutlinedButton(onPressed: on ? () => unawaited(c.back()) : null, child: const Text('Back')),
          Text(
            'Question ${c.questionIndex + 1} of ${c.module.questions.length}',
            style: const TextStyle(color: _muted),
          ),
          OutlinedButton(onPressed: on ? () => unawaited(c.next()) : null, child: const Text('Next')),
          FilterChip(
            label: const Text('Highlighter'),
            selected: c.highlighterOn,
            onSelected: on ? (_) => c.toggleHighlighter() : null,
          ),
          IconButton(
            tooltip: 'Zoom out',
            onPressed: on ? () => c.setZoom(c.zoom - .1) : null,
            icon: const Icon(Icons.remove),
          ),
          Text('${(c.zoom * 100).round()} %'),
          IconButton(
            tooltip: 'Zoom in',
            onPressed: on ? () => c.setZoom(c.zoom + .1) : null,
            icon: const Icon(Icons.add),
          ),
          FilledButton.tonal(
            onPressed: c.lockdown == null || c.phase == S1Phase.starting ? null : () => unawaited(c.toggleLockdown()),
            child: Text(
              c.lockdown == null ? 'Lockdown not in this build' : (c.locked ? 'Turn lockdown off' : 'Turn lockdown on'),
            ),
          ),
          OutlinedButton(
            onPressed: on ? () => unawaited(c.rerunTiming()) : null,
            child: const Text('Run timing again'),
          ),
          FilledButton(onPressed: () => unawaited(c.writeResults()), child: const Text('Save results')),
        ],
      ),
    );
  }
}

class _IslandArea extends StatelessWidget {
  const _IslandArea({required this.controller});
  final S1Controller controller;

  @override
  Widget build(BuildContext context) {
    final host = controller.host;
    final selection = controller.selection;
    return ColoredBox(
      color: Colors.white,
      child: Stack(
        children: [
          Positioned.fill(child: host == null ? const SizedBox.expand() : host.build(context)),
          // A box Flutter draws over the island: proves native overlays sit on top (texture mode).
          Positioned(
            right: 12,
            bottom: 12,
            child: IgnorePointer(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: const Color(0xE61D4ED8), borderRadius: BorderRadius.circular(6)),
                child: const Text(
                  'Drawn by Flutter over the card',
                  style: TextStyle(color: Colors.white, fontSize: 12),
                ),
              ),
            ),
          ),
          // The selection rectangle the island reported, in the same logical pixels.
          if (selection != null) ...[
            Positioned(
              left: selection.rect.x,
              top: selection.rect.y,
              width: math.max(2, selection.rect.w),
              height: math.max(2, selection.rect.h),
              child: IgnorePointer(
                child: DecoratedBox(
                  decoration: BoxDecoration(border: Border.all(color: const Color(0xFFFFD21A), width: 2)),
                ),
              ),
            ),
            Positioned(
              left: selection.rect.x,
              top: math.max(0, selection.rect.y - 40),
              child: Material(
                elevation: 3,
                borderRadius: BorderRadius.circular(6),
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: TextButton(onPressed: controller.highlightSelection, child: const Text('Highlight')),
                ),
              ),
            ),
          ],
          if (controller.phase == S1Phase.failed)
            Positioned.fill(
              child: ColoredBox(
                color: const Color(0xF2FFFFFF),
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(controller.status, style: const TextStyle(color: _bad, fontSize: 15)),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _SidePanel extends StatelessWidget {
  const _SidePanel({required this.controller});
  final S1Controller controller;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    return Material(
      color: _panel,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              c.status,
              style: const TextStyle(color: _ink, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              'Island: ${c.host?.runtimeType ?? '—'} · ${c.host?.state.name ?? 'idle'}'
              '${c.islandBuild == null ? '' : ' · ${c.islandBuild}'}\n'
              'WebView2: ${c.webview2Version ?? 'not found'}',
              style: const TextStyle(color: _muted, fontSize: 12),
            ),
            if (c.host is WebviewIslandHost)
              ValueListenableBuilder<String?>(
                valueListenable: (c.host! as WebviewIslandHost).problem,
                builder: (context, problem, _) => problem == null
                    ? const SizedBox.shrink()
                    : Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(problem, style: const TextStyle(color: _bad, fontSize: 12)),
                      ),
              ),
            const _Heading('Timing'),
            _kv('Host open', c.openMs),
            _kv('Page ready', c.readyMs),
            for (final e in c.timings.entries) ...[
              const SizedBox(height: 6),
              Text(
                e.key == 'rw' ? 'Reading and Writing' : 'Math',
                style: const TextStyle(fontWeight: FontWeight.w600, color: _ink, fontSize: 13),
              ),
              _kv('Module load', e.value.moduleLoadMs),
              _kv('First question', e.value.firstRenderMs),
              _kv('Next question p50', s1Percentile(e.value.nextMs, .5)),
              _kv('Next question p95', e.value.nextP95, budget: s1NextQuestionBudgetMs),
              _kv('Next question max', e.value.nextMs.isEmpty ? null : e.value.nextMs.reduce(math.max)),
            ],
            if (c.resultsPath != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('Saved to ${c.resultsPath}', style: const TextStyle(color: _muted, fontSize: 12)),
              ),
            const _Heading('Lockdown'),
            Text(
              c.lockdown == null
                  ? 'mastersat_native.dll is not in this build, so lockdown cannot be tested here.'
                  : '${c.lockdown!.description}. ${c.locked ? 'On. It turns itself off after ${c.lockdownAutoRelease.inMinutes} minutes.' : 'Off.'}',
              style: const TextStyle(color: _ink, fontSize: 13),
            ),
            if (c.lockdownError != null) Text(c.lockdownError!, style: const TextStyle(color: _bad, fontSize: 12)),
            const _Heading('Checklist'),
            const Text(
              'Go through each line on this computer and tick it when it holds. '
              'Use the toolbar to move between questions and subjects. Save results when you are done.',
              style: TextStyle(color: _muted, fontSize: 12),
            ),
            for (final item in s1Checklist)
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: c.manual[item.id] ?? false,
                onChanged: (v) => c.setManual(item.id, v ?? false),
                title: Text(item.text, style: const TextStyle(fontSize: 13, color: _ink)),
              ),
            TextField(
              decoration: const InputDecoration(labelText: 'Notes', isDense: true, border: OutlineInputBorder()),
              minLines: 2,
              maxLines: 4,
              onChanged: (v) => c.notes = v,
            ),
            if (c.powerEvents.isNotEmpty) ...[
              const _Heading('Sleep, wake and display changes'),
              for (final e in c.powerEvents)
                Text(
                  '${e.event}: ${e.islandAnswered == null
                      ? 'checking…'
                      : e.islandAnswered!
                      ? 'the card answered in ${e.answerMs!.toStringAsFixed(1)} ms'
                      : 'the card did NOT answer'}',
                  style: TextStyle(fontSize: 12, color: e.islandAnswered == false ? _bad : _ink),
                ),
            ],
            const _Heading('Log'),
            for (final line in c.log.reversed.take(30))
              Text(
                line,
                style: const TextStyle(fontSize: 11, color: _muted, fontFamily: 'Consolas'),
              ),
          ],
        ),
      ),
    );
  }

  Widget _kv(String label, double? ms, {double? budget}) {
    final ok = budget == null || ms == null ? null : ms <= budget;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: const TextStyle(fontSize: 13, color: _ink)),
          ),
          Text(
            ms == null
                ? '—'
                : '${ms.toStringAsFixed(1)} ms${ok == null
                      ? ''
                      : ok
                      ? '  within budget'
                      : '  over budget'}',
            style: TextStyle(
              fontSize: 13,
              color: ok == null
                  ? _ink
                  : ok
                  ? _good
                  : _bad,
            ),
          ),
        ],
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 18, bottom: 6),
    child: Text(
      text,
      style: const TextStyle(fontWeight: FontWeight.w700, color: _ink, fontSize: 14),
    ),
  );
}
