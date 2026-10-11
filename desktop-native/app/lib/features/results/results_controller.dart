// Results screens' data: `GET …/result`, polled while the attempt is still SCORING (the server
// says when to ask again with `poll_after_ms`), with an offline state whose Retry asks again.
import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart';

import '../../core/api/v1_api.dart';
import '../../core/models/models.dart';

enum ResultPhase { loading, scoring, ready, offline, failed }

/// Shared polling/state for both result kinds.
abstract class _ResultController<T> extends ChangeNotifier {
  _ResultController({this.minPoll = const Duration(seconds: 1), this.maxPoll = const Duration(seconds: 10)});

  final Duration minPoll;
  final Duration maxPoll;

  ResultPhase _phase = ResultPhase.loading;
  T? _result;
  String? _error;
  Timer? _timer;
  bool _disposed = false;
  Future<void>? _inFlight;

  ResultPhase get phase => _phase;
  T? get result => _result;
  String? get error => _error;

  Future<T> fetch();
  bool isScoring(T r);
  int? pollAfterMs(T r);

  /// Loads (or re-loads after Retry).
  Future<void> load() => _inFlight ??= _load().whenComplete(() => _inFlight = null);

  Future<void> _load() async {
    _timer?.cancel();
    if (_result == null || _phase == ResultPhase.offline || _phase == ResultPhase.failed) {
      _set(ResultPhase.loading);
    }
    try {
      final r = await fetch();
      if (_disposed) return;
      _result = r;
      _error = null;
      if (isScoring(r)) {
        _set(ResultPhase.scoring);
        final ms = pollAfterMs(r) ?? 2000;
        final wait = Duration(milliseconds: ms).clamp(minPoll, maxPoll);
        _timer = Timer(wait, () => unawaited(load()));
      } else {
        _set(ResultPhase.ready);
      }
    } on NetworkError {
      if (_disposed) return;
      _error = null;
      _set(ResultPhase.offline);
    } on ApiError catch (e) {
      if (_disposed) return;
      _error = e.status == 404
          ? "This result isn't available to you."
          : (e.body.detail?.trim().isNotEmpty ?? false)
              ? e.body.detail!.trim()
              : "Couldn't load this result.";
      _set(ResultPhase.failed);
    } on UpdateRequired {
      if (_disposed) return;
      _error = 'Update the MasterSAT app to continue.';
      _set(ResultPhase.failed);
    }
  }

  void _set(ResultPhase p) {
    _phase = p;
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    super.dispose();
  }
}

extension on Duration {
  Duration clamp(Duration lo, Duration hi) => this < lo ? lo : (this > hi ? hi : this);
}

class PastpaperResultController extends _ResultController<PastpaperResult> {
  PastpaperResultController({required this._api, required this.attemptId, super.minPoll, super.maxPoll});

  final V1Api _api;
  final int attemptId;

  @override
  Future<PastpaperResult> fetch() => _api.pastpaperResult(attemptId);

  @override
  bool isScoring(PastpaperResult r) => r.isScoring;

  @override
  int? pollAfterMs(PastpaperResult r) => r.pollAfterMs;
}

class MidtermResultController extends _ResultController<MidtermResult> {
  MidtermResultController({required this._api, required this.attemptId, super.minPoll, super.maxPoll});

  final V1Api _api;
  final int attemptId;

  @override
  Future<MidtermResult> fetch() => _api.midtermResult(attemptId);

  @override
  bool isScoring(MidtermResult r) => !r.isCompleted;

  @override
  int? pollAfterMs(MidtermResult r) => r.pollAfterMs;
}

/// Asks where to save a file; null when the student cancels.
typedef SaveLocationPicker = Future<String?> Function(String suggestedName);

Future<String?> _pickWithFileSelector(String suggestedName) async {
  final loc = await getSaveLocation(
    suggestedName: suggestedName,
    acceptedTypeGroups: const [
      XTypeGroup(label: 'PDF', extensions: ['pdf'], uniformTypeIdentifiers: ['com.adobe.pdf'], mimeTypes: ['application/pdf']),
    ],
  );
  return loc?.path;
}

/// Writes a file the student asked for.
typedef FileWriter = Future<void> Function(String path, Uint8List bytes);

/// Downloads a PDF (report, certificate, error report) to a path the student picks with the
/// native Save dialog (file_selector). The dialog comes first, then the download.
class DocumentSaver {
  DocumentSaver({SaveLocationPicker? pick, required this._write}) : _pick = pick ?? _pickWithFileSelector;

  final SaveLocationPicker _pick;
  final FileWriter _write;

  /// The saved path, or null when cancelled. Throws [ApiException] when the download fails.
  Future<String?> save({required String suggestedName, required Future<Uint8List> Function() fetch}) async {
    var path = await _pick(suggestedName);
    if (path == null || path.trim().isEmpty) return null;
    if (!path.toLowerCase().endsWith('.pdf')) path = '$path.pdf';
    final bytes = await fetch();
    await _write(path, bytes);
    return path;
  }
}
