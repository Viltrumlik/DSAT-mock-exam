// The signed-in student's ExamRuntime, held for exactly as long as they are signed in
// (exam-engine's request to app-core, wired here):
//
//   identity known  (the per-user store opened: auth.bin at launch, or the first `home`)
//                   → ExamRuntime.open → resumePendingSends() (what a closed app left behind)
//                   → unsentWork.register('exam outbox', rt.unsentCount) — sign-out and
//                     "Delete data on this computer" are blocked while answers are unsent
//   network back    → connectivityHint() on every live engine + the background senders
//   window closing  → closeGracefully() on every live engine (≤ 2 s each), then close
//   sign-out        → the sittings' screens go away, their engines are disposed, THEN close()
//
// The launcher registers every engine it opens with [track] and hands it back with [untrack]
// when its screen closes.
import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';

import '../../core/api/v1_api.dart';
import '../../core/diagnostics/diagnostics.dart';
import '../../core/models/models.dart';
import '../../core/store/unsent_work.dart';
import '../../native/native_bridge.dart';
import '../engine/exam_engine.dart';
import '../engine/exam_runtime.dart';
import '../engine/exam_store.dart';
import '../engine/media_cache.dart';

/// Opens one student's runtime (main.dart: the real database under the app's data folder).
typedef ExamRuntimeOpener = ExamRuntime Function(int userId);

/// What buildAppServices needs to open runtimes: the API, the bridge and the image fetcher are
/// the app's own (one HTTP client); the rest (data folder, PowerEvents, clock) is the caller's.
typedef ExamRuntimeFactory = ExamRuntime Function(
  int userId, {
  required V1Api api,
  required NativeBridge native,
  required MediaFetcher fetchMedia,
});

/// The UnsentWork source name (shown in the "unsent" diagnostics).
const String examOutboxSource = 'exam outbox';

class ExamRuntimeHost extends ChangeNotifier {
  ExamRuntimeHost({
    required this.opener,
    required this.unsentWork,
    this.log,
    Future<void> Function()? settleWidgets,
    this.closeCap = const Duration(seconds: 3),
  }) : _settleWidgets = settleWidgets ?? _twoFrames;

  final ExamRuntimeOpener opener;
  final UnsentWork unsentWork;
  final EventLog? log;

  /// Lets the screens of a closing session unmount (and dispose their engines) first.
  final Future<void> Function() _settleWidgets;

  /// The most a window close waits for the database to close.
  final Duration closeCap;

  ExamRuntime? _rt;
  VoidCallback? _unregister;
  Future<void> _queue = Future<void>.value();
  final Set<ExamEngine> _live = {};
  bool _disposed = false;

  /// The open runtime, or null (signed out, or the student is not known yet).
  ExamRuntime? get runtime {
    final rt = _rt;
    return rt == null || rt.closed ? null : rt;
  }

  /// Engines whose screens are open (tests, diagnostics).
  Set<ExamEngine> get liveEngines => Set.unmodifiable(_live);

  static Future<void> _twoFrames() async {
    final binding = SchedulerBinding.instance;
    await binding.endOfFrame;
    await binding.endOfFrame;
  }

  Future<T> _serial<T>(Future<T> Function() op) {
    final done = _queue.then((_) => op());
    _queue = done.then((_) {}, onError: (Object _) {});
    return done;
  }

  /// The runtime for [userId], opened once (a different student's is closed first).
  Future<ExamRuntime> openFor(int userId) => _serial(() async {
        final current = runtime;
        if (current != null && current.userId == userId) return current;
        if (current != null) await _close(current);
        final rt = opener(userId);
        _rt = rt;
        _unregister = unsentWork.register(examOutboxSource, () => rt.closed ? 0 : rt.unsentCount());
        log?.add('exam', 'runtime open for user $userId');
        unawaited(rt.resumePendingSends().then((n) {
          if (n > 0) log?.add('exam', 'resending $n unfinished sitting(s)');
        }, onError: (Object e) => log?.add('exam', 'resume sends failed: $e')));
        _notify();
        return rt;
      });

  /// An engine's screen opened.
  T track<T extends ExamEngine>(T engine) {
    _live.add(engine);
    return engine;
  }

  /// An engine's screen closed (it disposes the engine itself).
  void untrack(ExamEngine engine) => _live.remove(engine);

  /// The network is back (Home answered again after being offline): send what waits now
  /// instead of at the next backoff step.
  Future<void> connectivityRestored() async {
    for (final e in _live.toList()) {
      if (!e.disposed) e.connectivityHint();
    }
    final rt = runtime;
    if (rt == null) return;
    try {
      for (final (id, kind) in await rt.store.attemptsWithUnsent()) {
        // Midterm items wait for their sitting to be re-bound (the lockdown token is memory-only).
        if (kind != AttemptKind.pastpaper) continue;
        if (_live.any((e) => e.attemptId == id)) continue;
        unawaited(rt.hub.senderFor(id, kind).connectivityRestored());
      }
    } on Object catch (e) {
      log?.add('exam', 'connectivity resend failed: $e');
    }
  }

  /// The window is closing (or Windows is shutting down): the journal is already on disk; give
  /// every open sitting one last sync, then close the database. Never throws.
  Future<void> closeGracefully() async {
    for (final e in _live.toList()) {
      if (e.disposed) continue;
      try {
        await e.closeGracefully();
      } on Object catch (err) {
        log?.add('exam', 'close: last sync failed: $err');
      }
    }
    final rt = runtime;
    if (rt == null) return;
    try {
      await rt.close().timeout(closeCap);
    } on Object {
      // Whatever did not finish is in the outbox; the next launch sends it.
    }
  }

  /// Sign-out: the sittings' screens unmount, any engine still alive is disposed, then the
  /// runtime closes (its queued writes commit first).
  Future<void> close() => _serial(() async {
        final rt = _rt;
        if (rt == null) return;
        if (_live.isNotEmpty) await _settleWidgets();
        await _close(rt);
      });

  Future<void> _close(ExamRuntime rt) async {
    for (final e in _live.toList()) {
      if (!e.disposed) e.dispose();
    }
    _live.clear();
    _unregister?.call();
    _unregister = null;
    if (identical(_rt, rt)) _rt = null;
    try {
      await rt.close();
    } on Object catch (e) {
      log?.add('exam', 'runtime close failed: $e');
    }
    log?.add('exam', 'runtime closed for user ${rt.userId}');
    _notify();
  }

  /// "Delete data on this computer": the student's exam database (journal, outbox, cached
  /// papers). Call after [close]; images live in the shared media folder, removed with it.
  static Future<void> removeFiles(Directory dataDir, int userId) async {
    final base = '${dataDir.path}${Platform.pathSeparator}${ExamStore.fileNameFor(userId)}';
    for (final path in [base, '$base-wal', '$base-shm', '$base-journal']) {
      final f = File(path);
      if (await f.exists()) await f.delete();
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
