// The midterm machine lockdown in Dart terms (architecture §5 "Liveness"; ported from
// desktop/app/src/exam/lockdown/useLockdown.ts).
//
//  * enter(): `ms_lock_enter` — refused (PrecheckFailed) unless the pre-check passes; the DLL
//    records the precheck it will sign.
//  * a heartbeat every 3 s (`ms_heartbeat`). The DLL's watchdog releases the machine after 10 s
//    of silence (a frozen UI); when a beat answers 0 the controller locks again AT ONCE —
//    silently, no network needed (the server token stays good). Only if that fails is the lock
//    [lost], and the paper must be covered until the student locks again.
//  * exit(): `ms_lock_exit`; safe to call twice. A lockdown never outlives the exam.
//  * [strict] (a midterm): the DLL's strict lock — one window, one app (`MS_LOCK_STRICT`). The
//    re-lock after a watchdog release is strict too. While any strict lock is engaged,
//    [strictEngaged] is true and the app refuses a polite close (app.dart).
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../native/native_bridge.dart';

/// The machine failed the pre-check, so nothing was locked.
class PrecheckFailed implements Exception {
  const PrecheckFailed(this.report);
  final PrecheckReport report;

  @override
  String toString() => 'PrecheckFailed(${report.raw})';
}

/// The DLL refused to sign the challenge (not locked, or no proof key in this build).
class ProofRefused implements Exception {
  const ProofRefused(this.message);
  final String message;

  @override
  String toString() => 'ProofRefused($message)';
}

class LockdownController extends ChangeNotifier {
  LockdownController({
    required this.native,
    this.heartbeatPeriod = const Duration(seconds: 3),
    this.strict = false,
  });

  final NativeBridge native;
  final Duration heartbeatPeriod;

  /// A midterm's lock: one window, one app.
  final bool strict;

  static final Set<LockdownController> _strictHolders = {};

  /// A strict (midterm) lock is engaged somewhere in the app right now.
  static bool get strictEngaged => _strictHolders.isNotEmpty;

  void _holdStrict(bool held) {
    if (!strict) return;
    if (held) {
      _strictHolders.add(this);
    } else {
      _strictHolders.remove(this);
    }
  }

  bool _locked = false;
  bool _lost = false;
  bool _disposed = false;
  Timer? _beat;
  int relocks = 0;

  /// The machine is locked down now.
  bool get locked => _locked;

  /// The watchdog let go and locking again failed: the paper must be covered.
  bool get lost => _lost;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  /// Lock the machine. Throws [PrecheckFailed] when it is not ready, or the native error.
  PrecheckReport enter() {
    try {
      final report = native.lockEnter(strict: strict);
      _locked = true;
      _lost = false;
      _holdStrict(true);
      _startBeat();
      _notify();
      return report;
    } on NativeBridgeException catch (e) {
      if (e.code == NativeStatus.errPrecheck && e.message != null) {
        PrecheckReport? report;
        try {
          report = PrecheckReport.parse(e.message!);
        } on Object {
          report = null;
        }
        if (report != null) throw PrecheckFailed(report);
      }
      rethrow;
    }
  }

  /// Sign the server's challenge with the precheck captured at lock time.
  LockdownProof prove({required int attemptId, required String nonce}) {
    try {
      return native.prove(attemptId: attemptId, nonce: nonce);
    } on NativeBridgeException catch (e) {
      throw ProofRefused(e.message ?? 'The app could not prove it is locked down.');
    }
  }

  void _startBeat() {
    _beat ??= Timer.periodic(heartbeatPeriod, (_) => beat());
  }

  /// One heartbeat (public for tests). Returns whether the machine is (still or again) locked.
  bool beat() {
    if (!_locked || _disposed) return _locked;
    bool still;
    try {
      still = native.heartbeat();
    } on Object {
      return _locked; // a failed read is not a release
    }
    if (still) return true;
    // The watchdog let go (the UI stalled > 10 s). Lock again now — no network involved.
    try {
      native.lockEnter(strict: strict);
      relocks++;
      return true;
    } on Object {
      _locked = false;
      _lost = true;
      _holdStrict(false);
      _beat?.cancel();
      _beat = null;
      _notify();
      return false;
    }
  }

  /// Release the machine (every exit path). Safe to call when not locked.
  void exit() {
    _beat?.cancel();
    _beat = null;
    final was = _locked;
    _locked = false;
    _lost = false;
    _holdStrict(false);
    try {
      native.lockExit();
    } on Object {
      // Releasing must never throw at the student; the DLL's watchdog lets go regardless.
    }
    if (was) _notify();
  }

  @override
  void dispose() {
    if (_disposed) return;
    exit();
    _disposed = true;
    super.dispose();
  }
}
