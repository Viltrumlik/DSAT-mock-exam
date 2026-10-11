// The content island a sitting runs on, created and opened by the launcher (windows-host's
// request #4):
//
//  * it is opened at once, so WebView2 starts while the engine's `open` request is in flight
//    (architecture §2.4 "Lifetime");
//  * if it cannot start at all (open() throws: no WebView2 runtime, a broken install) or stays
//    crashed after its automatic recoveries, [unavailable] turns true and the sitting shows the
//    student a plain message instead of an empty card;
//  * every host problem lands in [IslandDiagnostics] for "Copy diagnostics"
//    (WebviewIslandHost.problem, TextureIslandHost.runtimeVersion()).
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../island/island_host.dart';
import '../../island/texture_island_host.dart';

/// What diagnostics report about the islands (one per app).
class IslandDiagnostics {
  IslandDiagnostics({Future<String?> Function()? runtimeVersion})
      : _runtimeVersion = runtimeVersion ?? TextureIslandHost.runtimeVersion;

  final Future<String?> Function() _runtimeVersion;

  /// The last problem a content host reported, and when.
  String? lastProblem;
  DateTime? lastProblemAt;

  /// Content islands that could not be used at all this session.
  int unavailableCount = 0;
  int crashes = 0;

  void record(String problem) {
    lastProblem = problem;
    lastProblemAt = DateTime.now().toUtc();
  }

  Future<Map<String, Object?>> snapshot() async {
    String? version;
    try {
      version = await _runtimeVersion().timeout(const Duration(seconds: 2));
    } on Object {
      version = null;
    }
    return {
      'webview2_runtime': version ?? 'unavailable',
      'last_problem': lastProblem,
      'last_problem_at': lastProblemAt?.toIso8601String(),
      'crashes': crashes,
      'unavailable': unavailableCount,
    };
  }
}

/// The student-facing words when the question viewer cannot run on this computer.
abstract final class IslandUnavailableCopy {
  static const title = 'Questions can’t be shown on this computer';
  static const body = 'MasterSAT shows questions with Microsoft Edge WebView2, and it isn’t available here. '
      'Your answers are saved on this computer. Install MasterSAT again from mastersat.uz, then '
      'open this test again.';
}

class ContentIslandGuard {
  ContentIslandGuard({
    required IslandHostFactory factory,
    this.diagnostics,
    this.crashedGrace = const Duration(seconds: 5),
  }) : host = factory(IslandKind.content);

  /// The content host the runner is given (`contentHost:`); this guard disposes it.
  final IslandHost host;
  final IslandDiagnostics? diagnostics;

  /// How long a crashed island may take to come back before the student is told.
  final Duration crashedGrace;

  final ValueNotifier<bool> _unavailable = ValueNotifier(false);
  StreamSubscription<IslandEvent>? _events;
  Timer? _crashTimer;
  bool _disposed = false;

  ValueListenable<bool> get unavailable => _unavailable;

  /// Opens the island now (call once, before the runner mounts).
  void start() {
    host.stateListenable.addListener(_onState);
    _events = host.events.listen((e) {
      if (e is IslandCrashedEvent) {
        diagnostics?.crashes++;
        diagnostics?.record('content island crashed: ${e.reason}');
      }
    });
    final h = host;
    if (h is WebviewIslandHost) h.problem.addListener(_onProblem);
    if (host.state == IslandHostState.idle) {
      unawaited(host.open().catchError((Object e) => _markUnavailable('the content island could not start: $e')));
    }
  }

  void _onProblem() {
    final h = host;
    final p = h is WebviewIslandHost ? h.problem.value : null;
    if (p != null) diagnostics?.record(p);
  }

  void _onState() {
    if (_disposed) return;
    if (host.state == IslandHostState.crashed) {
      _crashTimer ??= Timer(crashedGrace, () {
        _crashTimer = null;
        if (host.state == IslandHostState.crashed) _markUnavailable('the content island stayed crashed');
      });
    } else {
      _crashTimer?.cancel();
      _crashTimer = null;
    }
  }

  void _markUnavailable(String why) {
    if (_disposed || _unavailable.value) return;
    diagnostics
      ?..unavailableCount += 1
      ..record(why);
    _unavailable.value = true;
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _crashTimer?.cancel();
    host.stateListenable.removeListener(_onState);
    final h = host;
    if (h is WebviewIslandHost) h.problem.removeListener(_onProblem);
    await _events?.cancel();
    _unavailable.dispose();
    await host.dispose();
  }
}
