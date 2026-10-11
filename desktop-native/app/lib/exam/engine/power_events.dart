// System power and clock events from the Windows runner (architecture §4.1 "Clock").
//
// The runner (windows-host) forwards, on MethodChannel('mastersat/power'):
//   * `resumed`     — WM_POWERBROADCAST / PBT_APMRESUMEAUTOMATIC or PBT_APMRESUMESUSPEND;
//   * `suspending`  — WM_POWERBROADCAST / PBT_APMSUSPEND;
//   * `timeChanged` — WM_TIMECHANGE (the user or Windows time sync moved the wall clock).
// Arguments are ignored. Engines re-anchor on `resumed` and re-baseline the wall clock on
// `timeChanged` (so a time change is never mistaken for sleep). The runner also sends
// `resumedByUser`, `powerStatus` and `displayChanged` (diagnostics); any method this class does
// not know is accepted and ignored (null), never answered with MissingPluginException — the
// runner may grow new events without breaking older Dart code (windows-host request #3).
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

enum PowerEvent { resumed, suspending, timeChanged }

class PowerEvents {
  PowerEvents({MethodChannel? channel}) : _channel = channel ?? const MethodChannel(channelName) {
    _channel!.setMethodCallHandler(_onCall);
  }

  /// No platform channel (tests, tools): events come only from [debugEmit].
  PowerEvents.detached() : _channel = null;

  static const channelName = 'mastersat/power';

  final MethodChannel? _channel;
  final StreamController<PowerEvent> _events = StreamController.broadcast();

  Stream<PowerEvent> get events => _events.stream;

  /// Exposed for channel tests; the platform calls it through the MethodChannel.
  @visibleForTesting
  Future<Object?> handleCall(MethodCall call) => _onCall(call);

  Future<Object?> _onCall(MethodCall call) async {
    final e = switch (call.method) {
      'resumed' => PowerEvent.resumed,
      'suspending' => PowerEvent.suspending,
      'timeChanged' => PowerEvent.timeChanged,
      _ => null,
    };
    if (e == null) return null;
    _events.add(e);
    return null;
  }

  /// Test/dev hook: deliver an event as the runner would.
  void debugEmit(PowerEvent e) => _events.add(e);

  Future<void> dispose() async {
    _channel?.setMethodCallHandler(null);
    await _events.close();
  }
}
