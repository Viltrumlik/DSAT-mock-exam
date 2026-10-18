// App updates (architecture §6 "Installer and updates: Velopack"):
//  * checked at launch and every 6 h while Home is showing, downloaded in the background;
//  * "Restart to update" appears on Home only — never during a test or lockdown;
//  * `home.app.update == "required"` or any 426 shows a blocking card with real progress and
//    a "Download from the website" fallback.
// The Velopack work is the native library's (ms_update_*); this is only its state. The MacBook
// app checks the same feed on its own channels (`osx`, `osx-beta`).
import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';

import '../../core/api/v1_api.dart';
import '../../core/diagnostics/diagnostics.dart';
import '../../core/http/api_config.dart';
import '../../core/store/settings_store.dart';
import '../../native/native_bridge.dart';

enum UpdatePhase { idle, checking, upToDate, downloading, ready, failed }

class UpdateController extends ChangeNotifier {
  UpdateController({
    required this._native,
    required this._config,
    required this._channel,
    this._log,
    this.period = const Duration(hours: 6),
    bool? macOS,
  }) : _macOS = macOS ?? Platform.isMacOS;

  final NativeBridge _native;
  final ApiConfig _config;
  final UpdateChannel Function() _channel;
  final EventLog? _log;
  final Duration period;

  /// Which packages to ask for: the MacBook app's (`osx` channels) or the Windows app's.
  final bool _macOS;

  UpdatePhase _phase = UpdatePhase.idle;
  int _percent = 0;
  String? _version;
  String? _error;
  Timer? _timer;
  Future<void>? _running;
  bool _disposed = false;

  /// This copy has no updater (not installed from a MasterSAT package — a development build, or a
  /// MacBook app from before 0.3.2): never a failure, and no more checks.
  bool _unsupported = false;

  /// A 426 seen on any request (the blocking card shows while set).
  final ValueNotifier<UpdateRequired?> required = ValueNotifier<UpdateRequired?>(null);

  UpdatePhase get phase => _phase;
  int get percent => _percent;
  String? get version => _version;
  String? get error => _error;
  bool get isReady => _phase == UpdatePhase.ready;
  bool get isBusy => _phase == UpdatePhase.checking || _phase == UpdatePhase.downloading;

  String get stateLabel => switch (_phase) {
        UpdatePhase.idle => 'not checked',
        UpdatePhase.checking => 'checking',
        UpdatePhase.upToDate => 'up to date',
        UpdatePhase.downloading => 'downloading $_percent%',
        UpdatePhase.ready => 'ready ${_version ?? ''}'.trim(),
        UpdatePhase.failed => 'failed',
      };

  /// Checks the feed and, when there is a new version, downloads it.
  Future<void> checkAndDownload() => _running ??= _run().whenComplete(() => _running = null);

  Future<void> _run() async {
    if (_phase == UpdatePhase.ready || _unsupported) return;
    _error = null;
    _set(UpdatePhase.checking);
    try {
      final info = await _native.updateCheck(feedUrl: _config.updateFeed.toString(), channel: _channel().feedChannel(macOS: _macOS));
      if (!info.available) {
        _set(UpdatePhase.upToDate);
        return;
      }
      _version = info.version;
      _percent = 0;
      _set(UpdatePhase.downloading);
      await _native.updateDownload(onProgress: (p) {
        _percent = p.clamp(0, 100);
        _notify();
      });
      _set(UpdatePhase.ready);
    } on NativeBridgeException catch (e) {
      if (e.code == NativeStatus.errUnsupported) {
        _unsupported = true;
        stopPeriodic();
        _set(UpdatePhase.idle);
        return;
      }
      _error = e.message ?? 'The update could not be downloaded.';
      _log?.add('update', 'failed: ${e.function} ${e.code}');
      _set(UpdatePhase.failed);
    }
  }

  /// Applies the downloaded update and restarts (Home only).
  void restartToUpdate() {
    if (_phase != UpdatePhase.ready) return;
    try {
      _native.updateApplyRestart();
    } on NativeBridgeException catch (e) {
      _error = e.message ?? 'The update could not be applied.';
      _set(UpdatePhase.failed);
    }
  }

  /// Home is showing: check now and then every [period].
  void startPeriodic() {
    if (_timer != null) return;
    unawaited(checkAndDownload());
    _timer = Timer.periodic(period, (_) => unawaited(checkAndDownload()));
  }

  void stopPeriodic() {
    _timer?.cancel();
    _timer = null;
  }

  void _set(UpdatePhase p) {
    _phase = p;
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    required.dispose();
    super.dispose();
  }
}
