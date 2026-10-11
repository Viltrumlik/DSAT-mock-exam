// DesmosController — owns the Desmos island (architecture §2.4 "Desmos island", §2.7 table
// "Desmos island", §2.8 "Desmos"). Created on the first Calculator click and kept until the
// runner closes, so switching questions or closing the panel never loses the graph.
//
//   open → host.open() → `desmos.ready` → desmos.init{mode, state: session.desmosState}
//   tab   → desmos.mode
//   `desmos.changed` → desmos.getState{req} → `desmos.state` → session.saveDesmosState
//   `desmos.failed` (offline/script/timeout) or no `ready` within [readyTimeout] → failed:
//   the panel shows the native scientific calculator (DesmosCalculator.tsx:103-104).
//   A crashed island is recreated by its host; on the next `ready` it is re-initialised from
//   the last saved state.
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../island/island_host.dart';
import '../../../island/protocol.dart';
import '../../runner/runner_tools.dart';
import '../../session_contract.dart';

enum DesmosStatus { idle, loading, ready, failed }

class DesmosController extends ChangeNotifier {
  DesmosController({
    required this.session,
    required this.factory,
    this.readyTimeout = const Duration(seconds: 8),
    this.onDiagnostic,
    this.onKey,
  });

  final ExamSession session;
  final IslandHostFactory factory;

  /// The island gives up on its own after 6 s (`desmos.failed{timeout}`); this guards a page
  /// that never loads at all.
  final Duration readyTimeout;
  final void Function(String where, String message)? onDiagnostic;

  /// `key` from the Desmos island — Escape only (shortcuts are off while Desmos has focus).
  final void Function(String key)? onKey;

  IslandHost? _host;
  StreamSubscription<IslandEvent>? _sub;
  Timer? _timeout;
  DesmosStatus _status = DesmosStatus.idle;
  String _mode = 'graphing';
  String? failureReason;
  int _req = 0;
  final Set<int> _stateRequests = {};
  bool _disposed = false;

  DesmosStatus get status => _status;

  /// The island host once [ensureOpen] ran (null before the first Calculator click).
  IslandHost? get host => _host;

  /// The mode the island was told to show.
  String get mode => _mode;

  void _setStatus(DesmosStatus s) {
    if (_status == s || _disposed) return;
    _status = s;
    notifyListeners();
  }

  /// Creates and opens the island the first time; later calls only switch the mode.
  Future<void> ensureOpen(CalculatorTab tab) async {
    if (_disposed) return;
    final mode = tab == CalculatorTab.scientific ? 'scientific' : 'graphing';
    if (_host != null) {
      setMode(tab);
      return;
    }
    _mode = mode;
    final host = factory(IslandKind.desmos);
    _host = host;
    _sub = host.events.listen(_onEvent);
    _setStatus(DesmosStatus.loading);
    _armTimeout();
    try {
      await host.open();
    } on Object catch (e) {
      onDiagnostic?.call('desmos', 'open failed: $e');
      _fail('script');
    }
  }

  void _armTimeout() {
    _timeout?.cancel();
    _timeout = Timer(readyTimeout, () {
      if (_status == DesmosStatus.loading) _fail('timeout');
    });
  }

  void _fail(String reason) {
    _timeout?.cancel();
    failureReason = reason;
    _setStatus(DesmosStatus.failed);
  }

  /// Graphing/Scientific tab.
  void setMode(CalculatorTab tab) {
    final mode = tab == CalculatorTab.scientific ? 'scientific' : 'graphing';
    if (mode == _mode) return;
    _mode = mode;
    if (_status == DesmosStatus.ready) _host?.post(DesmosModeMessage(mode: mode));
  }

  /// Shown/hidden with the panel (hidden islands drop to low memory).
  Future<void> setVisible(bool visible) async => _host?.setVisible(visible);

  /// Handled in a microtask (see ContentIslandBridge._onEvent): replying from inside a
  /// synchronous delivery would re-enter the host.
  void _onEvent(IslandEvent e) => scheduleMicrotask(() {
        if (!_disposed) _handle(e);
      });

  void _handle(IslandEvent e) {
    switch (e) {
      case IslandCrashedEvent(:final reason):
        onDiagnostic?.call('desmos', 'crashed: $reason');
        if (_status != DesmosStatus.failed) {
          _setStatus(DesmosStatus.loading);
          _armTimeout();
        }
      case IslandDroppedEvent(:final reason):
        onDiagnostic?.call('desmos', 'dropped message: $reason');
      case IslandMessageEvent(:final message):
        switch (message) {
          case DesmosReadyMessage():
            _timeout?.cancel();
            _host?.post(DesmosInitMessage(mode: _mode, state: session.desmosState));
            _setStatus(DesmosStatus.ready);
          case DesmosFailedMessage(:final reason):
            _fail(reason);
          case DesmosChangedMessage():
            final req = ++_req;
            _stateRequests.add(req);
            _host?.post(DesmosGetStateMessage(req: req));
          case DesmosStateMessage(:final req, :final state):
            if (_stateRequests.remove(req)) session.saveDesmosState(state);
          case ErrorMessage(:final where, :final message):
            onDiagnostic?.call('desmos:$where', message);
          case KeyMessage(:final key):
            onKey?.call(key);
          default:
            break;
        }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _timeout?.cancel();
    unawaited(_sub?.cancel());
    unawaited(_host?.dispose());
    super.dispose();
  }
}
